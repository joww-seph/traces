import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { documentMeta, documentPatch } from '@traces/shared'
import { and, count, desc, eq, gte, ilike, inArray, isNull, lte, asc } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { documents, items, linePdfRegions, lines, officers, properties, propertyTypes } from '../db/schema.js'
import { AppError, pgErrorOf } from '../middleware/error.js'
import { archivePdf, pdfDir } from '../middleware/upload.js'
import { audit, type Ctx } from './audit.js'
import { regionOut } from './lines.js'
import { assertCanReceive } from './officers.js'

type Tx = Pick<typeof db, 'select' | 'insert' | 'update'>
type Doc = typeof documents.$inferSelect
export type DocFile = { storedName: string; originalName: string; size: number; pageCount: number }

// The stored file name is internal; clients get hasPdf instead.
export function present({ pdfStoredName, ...doc }: Doc) {
  return { ...doc, hasPdf: pdfStoredName !== null }
}

export async function readPdfMeta(file: Express.Multer.File): Promise<DocFile> {
  let pageCount = 0
  try { pageCount = (await PDFDocument.load(await readFile(file.path))).getPageCount() } catch { /* handled below */ }
  if (pageCount < 1) throw new AppError('INVALID_PDF', 400, 'Could not read the PDF')
  return { storedName: file.filename, originalName: file.originalname, size: file.size, pageCount }
}

async function positionOf(tx: Tx, officerId: string) {
  const o = (await tx.select().from(officers).where(eq(officers.id, officerId)))[0]
  if (!o) throw new AppError('OFFICER_NOT_FOUND', 400, 'Officer not found')
  return o.position
}

const pdfColumns = (f: DocFile) =>
  ({ pdfStoredName: f.storedName, pdfOriginalName: f.originalName, pdfSizeBytes: f.size, pdfPageCount: f.pageCount })

// The unique index also covers soft-deleted rows, so a deleted number stays reserved.
function duplicateNo(e: unknown, type: string, docNo: string): never {
  if (pgErrorOf(e)?.constraint === 'documents_type_doc_no_uq') {
    throw new AppError('DUPLICATE_DOCUMENT_NO', 409, `${type} ${docNo} already exists (numbers of deleted documents stay reserved)`, { type, docNo })
  }
  throw e
}

export async function createDocument(meta: z.infer<typeof documentMeta>, file: DocFile, userId: string, ctx: Ctx) {
  try {
    return await db.transaction(async (tx) => {
      await assertCanReceive(tx, meta.receivedByOfficerId)
      const [doc] = await tx.insert(documents).values({
        ...meta,
        ...pdfColumns(file),
        issuedByPosition: meta.issuedByPosition ?? (await positionOf(tx, meta.issuedByOfficerId)),
        receivedByPosition: meta.receivedByPosition ?? (await positionOf(tx, meta.receivedByOfficerId)),
        createdBy: userId,
      }).returning()
      await audit(tx, ctx, 'document.create', 'documents', doc.id, null, present(doc))
      return present(doc)
    })
  } catch (e) { duplicateNo(e, meta.type, meta.docNo) }
}

export type ListFilter = { type?: 'ICS' | 'PAR'; from?: string; to?: string; officerId?: string; q?: string; page: number }
const PAGE_SIZE = 25

export async function listDocuments(f: ListFilter) {
  const where = and(
    isNull(documents.deletedAt),
    f.type ? eq(documents.type, f.type) : undefined,
    f.from ? gte(documents.issuedDate, f.from) : undefined,
    f.to ? lte(documents.issuedDate, f.to) : undefined,
    f.officerId ? eq(documents.receivedByOfficerId, f.officerId) : undefined,
    f.q ? ilike(documents.docNo, `%${f.q.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
  )
  const [{ total }] = await db.select({ total: count() }).from(documents).where(where)
  const rows = await db.select({ doc: documents, receivedByShort: officers.shortName })
    .from(documents).innerJoin(officers, eq(officers.id, documents.receivedByOfficerId))
    .where(where).orderBy(desc(documents.issuedDate), desc(documents.createdAt))
    .limit(PAGE_SIZE).offset((f.page - 1) * PAGE_SIZE)
  return { rows: rows.map((r) => ({ ...present(r.doc), receivedByShort: r.receivedByShort })), total, page: f.page, pageSize: PAGE_SIZE }
}

async function findLive(tx: Tx, id: string) {
  const doc = (await tx.select().from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt))))[0]
  if (!doc) throw new AppError('DOCUMENT_NOT_FOUND', 404, 'Document not found')
  return doc
}

export async function getDocument(id: string) {
  const doc = await findLive(db, id)
  const lineRows = await db.select().from(lines).where(and(eq(lines.documentId, id), isNull(lines.deletedAt))).orderBy(asc(lines.lineNo))
  const ids = lineRows.map((l) => l.id)
  const regions = ids.length ? await db.select().from(linePdfRegions).where(inArray(linePdfRegions.lineId, ids)) : []
  const props = ids.length
    ? await db.select().from(properties).where(and(inArray(properties.lineId, ids), isNull(properties.voidedAt))).orderBy(asc(properties.propertyNo))
    : []
  const itemIds = [...new Set(lineRows.map((l) => l.itemId))]
  const cards = itemIds.length
    ? await db.select({ id: items.id, article: items.article, unit: items.unit, itemDescription: items.description, propertyTypeCode: propertyTypes.code })
      .from(items).innerJoin(propertyTypes, eq(propertyTypes.id, items.propertyTypeId)).where(inArray(items.id, itemIds))
    : []
  return {
    ...present(doc),
    lines: lineRows.map((l) => ({
      ...l,
      ...cards.find((c) => c.id === l.itemId),
      id: l.id,
      region: regionOut(regions.find((r) => r.lineId === l.id)),
      properties: props.filter((p) => p.lineId === l.id),
    })),
  }
}

export async function patchDocument(id: string, patch: z.infer<typeof documentPatch>, file: DocFile | null, ctx: Ctx) {
  try {
    const { after, replaced } = await db.transaction(async (tx) => {
      const before = (await tx.select().from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt))).for('update'))[0]
      if (!before) throw new AppError('DOCUMENT_NOT_FOUND', 404, 'Document not found')
      const set: Partial<typeof documents.$inferInsert> = { ...patch, ...(file ? pdfColumns(file) : {}) }
      if (patch.receivedByOfficerId) await assertCanReceive(tx, patch.receivedByOfficerId)
      // new officer without an explicit position -> snapshot that officer's current position
      if (patch.issuedByOfficerId && !patch.issuedByPosition) set.issuedByPosition = await positionOf(tx, patch.issuedByOfficerId)
      if (patch.receivedByOfficerId && !patch.receivedByPosition) set.receivedByPosition = await positionOf(tx, patch.receivedByOfficerId)
      const after = Object.keys(set).length
        ? (await tx.update(documents).set(set).where(eq(documents.id, id)).returning())[0]
        : before
      await audit(tx, ctx, 'document.update', 'documents', id, present(before),
        file ? { ...present(after), replacedPdf: before.pdfStoredName } : present(after))
      return { after, replaced: file ? before.pdfStoredName : null }
    })
    if (replaced) await archivePdf(replaced) // only after commit
    return present(after)
  } catch (e) {
    if (patch.type || patch.docNo) {
      const cur = await db.select().from(documents).where(eq(documents.id, id))
      duplicateNo(e, patch.type ?? cur[0]?.type ?? '', patch.docNo ?? cur[0]?.docNo ?? '')
    }
    throw e
  }
}

export async function softDeleteDocument(id: string, ctx: Ctx) {
  await db.transaction(async (tx) => {
    const doc = await findLive(tx, id)
    await tx.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, id))
    await audit(tx, ctx, 'document.delete', 'documents', id, present(doc), null)
  })
}

export async function getPdfFile(id: string) {
  const doc = await findLive(db, id)
  const file = doc.pdfStoredName ? path.join(pdfDir(), doc.pdfStoredName) : null
  if (!file || !existsSync(file)) throw new AppError('PDF_NOT_FOUND', 404, 'No PDF for this document')
  return { file, originalName: doc.pdfOriginalName ?? 'document.pdf' }
}
