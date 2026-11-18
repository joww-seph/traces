import type { documentMeta, documentPatch } from '@traces/shared'
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { auditLogs, documentFiles, documents, linePdfRegions, lines, movements, officers, properties, propertyTypes, users } from '../db/schema.js'
import { AppError, pgErrorOf } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'
import { assertNotSigned, filesOf, filesSummary, type DocFile, type DocStatus } from './documentFiles.js'
import { regionOut } from './lines.js'
import { assertCanReceive } from './officers.js'

type Tx = Pick<typeof db, 'select' | 'insert' | 'update'>
type Doc = typeof documents.$inferSelect

// Clients get the file summary (status, page counts), never the stored names.
export const present = (doc: Doc, files: { generated?: typeof documentFiles.$inferSelect; uploaded?: typeof documentFiles.$inferSelect } = {}) =>
  ({ ...doc, ...filesSummary(files) })

async function positionOf(tx: Tx, officerId: string) {
  const o = (await tx.select().from(officers).where(eq(officers.id, officerId)))[0]
  if (!o) throw new AppError('OFFICER_NOT_FOUND', 400, 'Officer not found')
  return o.position
}

// The unique index also covers soft-deleted rows, so a deleted number stays reserved.
export function duplicateNo(e: unknown, type: string, docNo: string): never {
  if (pgErrorOf(e)?.constraint === 'documents_type_doc_no_uq') {
    throw new AppError('DUPLICATE_DOCUMENT_NO', 409, `${type} ${docNo} already exists (numbers of deleted documents stay reserved)`, { type, docNo })
  }
  throw e
}

// `file` is an existing PDF to store as the uploaded copy; without it the document starts with no PDF (it can be generated or attached later).
export async function createDocument(meta: z.infer<typeof documentMeta>, file: DocFile | null, userId: string, ctx: Ctx) {
  try {
    return await db.transaction(async (tx) => {
      await assertCanReceive(tx, meta.receivedByOfficerId)
      const [doc] = await tx.insert(documents).values({
        ...meta,
        issuedByPosition: meta.issuedByPosition ?? (await positionOf(tx, meta.issuedByOfficerId)),
        receivedByPosition: meta.receivedByPosition ?? (await positionOf(tx, meta.receivedByOfficerId)),
        createdBy: userId,
      }).returning()
      if (file) {
        await tx.insert(documentFiles).values({
          documentId: doc.id, kind: 'uploaded', storedName: file.storedName, originalName: file.originalName, sizeBytes: file.size, pageCount: file.pageCount, createdBy: userId,
        })
      }
      const out = present(doc, (await filesOf([doc.id], tx)).get(doc.id))
      await audit(tx, ctx, 'document.create', 'documents', doc.id, null, out)
      return out
    })
  } catch (e) { duplicateNo(e, meta.type, meta.docNo) }
}

export type ListFilter = { type?: 'ICS' | 'PAR'; from?: string; to?: string; officerId?: string; q?: string; status?: DocStatus | 'unsigned'; page: number }
const PAGE_SIZE = 20 // rows per page on screen and per printed sheet (decision 2026-11-18)

// none = no PDF · generated = only the TRACES copy · signed = an uploaded copy exists · unsigned = none + generated
const hasFile = (kind: 'generated' | 'uploaded') =>
  sql`exists (select 1 from ${documentFiles} f where f.document_id = ${documents.id} and f.kind = ${kind})`

// all: every matching form (the Excel export), not one page
export async function listDocuments(f: ListFilter, all = false) {
  const status = {
    none: sql`not exists (select 1 from ${documentFiles} f where f.document_id = ${documents.id})`,
    generated: sql`${hasFile('generated')} and not ${hasFile('uploaded')}`,
    signed: hasFile('uploaded'),
    unsigned: sql`not ${hasFile('uploaded')}`,
  }
  const where = and(
    isNull(documents.deletedAt),
    f.type ? eq(documents.type, f.type) : undefined,
    f.from ? gte(documents.issuedDate, f.from) : undefined,
    f.to ? lte(documents.issuedDate, f.to) : undefined,
    f.officerId ? eq(documents.receivedByOfficerId, f.officerId) : undefined,
    f.q ? ilike(documents.docNo, `%${f.q.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
    f.status ? status[f.status] : undefined,
  )
  const [{ total }] = await db.select({ total: count() }).from(documents).where(where)
  // No.: the form's place among all live forms of its type in issue order; filters never renumber it
  const rowNo = sql<number>`(select count(*) from ${documents} d2 where d2.type = ${documents.type} and d2.deleted_at is null
    and (d2.issued_date, d2.created_at, d2.id) <= (${documents.issuedDate}, ${documents.createdAt}, ${documents.id}))::int`
  const rows = await db.select({ doc: documents, receivedByShort: officers.shortName, receivedByName: officers.fullName, rowNo })
    .from(documents).innerJoin(officers, eq(officers.id, documents.receivedByOfficerId))
    .where(where).orderBy(desc(documents.issuedDate), desc(documents.createdAt))
    .limit(all ? 1_000_000 : PAGE_SIZE).offset(all ? 0 : (f.page - 1) * PAGE_SIZE)
  const files = await filesOf(rows.map((r) => r.doc.id))
  return { rows: rows.map((r) => ({ ...present(r.doc, files.get(r.doc.id)), receivedByShort: r.receivedByShort, receivedByName: r.receivedByName, rowNo: r.rowNo })), total, page: f.page, pageSize: PAGE_SIZE }
}

async function findLive(tx: Pick<typeof db, 'select'>, id: string) {
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
  const types = await db.select({ id: propertyTypes.id, code: propertyTypes.code }).from(propertyTypes)
  const region = (lineId: string, kind: 'generated' | 'uploaded') => regionOut(regions.find((r) => r.lineId === lineId && r.kind === kind))
  const files = (await filesOf([id])).get(id)!
  // the generated form no longer matches the entries once a line or the header changed after it was made
  const gen = files.generated
  const generatedOutdated = gen ? Boolean((await db.execute(sql`SELECT EXISTS (
      SELECT 1 FROM audit_logs a WHERE a.at > ${gen.createdAt} AND a.action <> 'line.region' AND (
        (a.entity = 'lines' AND a.entity_id IN (SELECT l.id::text FROM lines l WHERE l.document_id = ${id}))
        OR (a.entity = 'documents' AND a.entity_id = ${id} AND a.action = 'document.update'))) AS x`)).rows[0].x) : false
  return {
    ...present(doc, files), generatedOutdated,
    lines: lineRows.map((l) => ({
      ...l,
      propertyTypeCode: types.find((t) => t.id === l.propertyTypeId)?.code ?? '',
      region: region(l.id, 'uploaded'), // the box drawn on the uploaded (signed) copy
      generatedRegion: region(l.id, 'generated'), // computed from the layout of the TRACES copy
      properties: props.filter((p) => p.lineId === l.id),
    })),
  }
}

export async function patchDocument(id: string, patch: z.infer<typeof documentPatch>, ctx: Ctx) {
  try {
    return await db.transaction(async (tx) => {
      const before = (await tx.select().from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt))).for('update'))[0]
      if (!before) throw new AppError('DOCUMENT_NOT_FOUND', 404, 'Document not found')
      if (Object.keys(patch).length) await assertNotSigned(tx, id) // the printed form says what it says
      const set: Partial<typeof documents.$inferInsert> = { ...patch }
      if (patch.receivedByOfficerId) await assertCanReceive(tx, patch.receivedByOfficerId)
      // new officer without an explicit position -> snapshot that officer's current position
      if (patch.issuedByOfficerId && !patch.issuedByPosition) set.issuedByPosition = await positionOf(tx, patch.issuedByOfficerId)
      if (patch.receivedByOfficerId && !patch.receivedByPosition) set.receivedByPosition = await positionOf(tx, patch.receivedByOfficerId)
      const after = Object.keys(set).length
        ? (await tx.update(documents).set(set).where(eq(documents.id, id)).returning())[0]
        : before
      // the ISSUE movements are this document's facts: a corrected receiver or date moves them too (custody, card, report)
      if (patch.receivedByOfficerId || patch.issuedDate) {
        await tx.update(movements).set({ officerId: after.receivedByOfficerId, date: after.issuedDate })
          .where(and(eq(movements.referenceDocumentId, id), eq(movements.type, 'ISSUE')))
      }
      // the card's date is the date issued (decision 2026-11-18), so the receipts of its properties follow it
      if (patch.issuedDate) {
        await tx.update(movements).set({ date: after.issuedDate }).where(and(eq(movements.type, 'RECEIPT'), inArray(movements.propertyId,
          tx.select({ id: properties.id }).from(properties).innerJoin(lines, eq(lines.id, properties.lineId)).where(eq(lines.documentId, id)))))
      }
      const files = (await filesOf([id], tx)).get(id)
      await audit(tx, ctx, 'document.update', 'documents', id, present(before, files), present(after, files))
      return present(after, files)
    })
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
    await assertNotSigned(tx, id) // V-06: a signed form is a record; remove the signed copy (with a reason) first
    await tx.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, id))
    await audit(tx, ctx, 'document.delete', 'documents', id, present(doc, (await filesOf([id], tx)).get(id)), null)
  })
}

// The ICS/PAR page's History (decision 2026-11-18): every audit entry about the form, its lines, its properties and their card rows.
export async function documentHistory(id: string) {
  await findLive(db, id)
  const rows = await db.select({
    id: auditLogs.id, at: auditLogs.at, action: auditLogs.action, entity: auditLogs.entity, entityId: auditLogs.entityId,
    before: auditLogs.before, after: auditLogs.after, actor: users.displayName,
  }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(sql`(${auditLogs.entity} = 'documents' and ${id} = any(string_to_array(${auditLogs.entityId}, ',')))
      or (${auditLogs.entity} = 'lines' and ${auditLogs.entityId} in (select l.id::text from ${lines} l where l.document_id = ${id}))
      or (${auditLogs.entity} = 'properties' and ${auditLogs.entityId} in (select p.id::text from ${properties} p join ${lines} l on l.id = p.line_id where l.document_id = ${id}))
      or (${auditLogs.entity} = 'movements' and ${auditLogs.entityId} in (select m.id::text from ${movements} m join ${properties} p on p.id = m.property_id join ${lines} l on l.id = p.line_id where l.document_id = ${id}))`)
    .orderBy(desc(auditLogs.at), desc(auditLogs.id))
  return rows.map((r) => ({ ...r, at: r.at.toISOString(), actor: r.actor ?? 'System' }))
}
