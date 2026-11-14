import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { db } from '../db/client.js'
import { documentFiles, documents, linePdfRegions, lines } from '../db/schema.js'
import { AppError } from '../middleware/error.js'
import { archivePdf, pdfDir } from '../middleware/upload.js'
import { audit, type Ctx } from './audit.js'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Reader = Pick<typeof db, 'select'>
export type PdfKind = 'generated' | 'uploaded'
export type DocFile = { storedName: string; originalName: string; size: number; pageCount: number }
export type FileRow = typeof documentFiles.$inferSelect
export type DocStatus = 'none' | 'generated' | 'signed'

// SEC-09 happens in the upload middleware (type, size, %PDF- header); this reads the page count and refuses unreadable files.
export async function readPdfMeta(file: Express.Multer.File): Promise<DocFile> {
  let pageCount = 0
  try { pageCount = (await PDFDocument.load(await readFile(file.path))).getPageCount() } catch { /* handled below */ }
  if (pageCount < 1) throw new AppError('INVALID_PDF', 400, 'Could not read the PDF')
  return { storedName: file.filename, originalName: file.originalname, size: file.size, pageCount }
}

export const statusOf = (files: { generated?: unknown; uploaded?: unknown }): DocStatus =>
  files.uploaded ? 'signed' : files.generated ? 'generated' : 'none'

// Both files of each document: { [documentId]: { generated?, uploaded? } }
export async function filesOf(documentIds: string[], d: Reader = db) {
  const out = new Map<string, { generated?: FileRow; uploaded?: FileRow }>(documentIds.map((id) => [id, {}]))
  if (!documentIds.length) return out
  for (const f of await d.select().from(documentFiles).where(inArray(documentFiles.documentId, documentIds))) out.get(f.documentId)![f.kind] = f
  return out
}

export const filesSummary = (f: { generated?: FileRow; uploaded?: FileRow }) => ({
  hasPdf: !!(f.generated || f.uploaded),
  status: statusOf(f),
  files: {
    generated: f.generated ? { pageCount: f.generated.pageCount, createdAt: f.generated.createdAt } : null,
    uploaded: f.uploaded ? { originalName: f.uploaded.originalName, pageCount: f.uploaded.pageCount, createdAt: f.uploaded.createdAt } : null,
  },
})

export async function isSigned(tx: Reader, documentId: string) {
  return (await tx.select({ k: documentFiles.kind }).from(documentFiles)
    .where(and(eq(documentFiles.documentId, documentId), eq(documentFiles.kind, 'uploaded'))))[0] !== undefined
}

// V-06: once the signed copy is uploaded the entries are locked. Remove the signed copy (with a reason) to correct them.
export async function assertNotSigned(tx: Reader, documentId: string) {
  if (await isSigned(tx, documentId)) {
    throw new AppError('DOCUMENT_SIGNED', 409, 'This form has a signed copy, so its entries are locked. Remove the signed copy first to correct them.')
  }
}

async function liveDocument(tx: Tx, id: string) {
  const doc = (await tx.select().from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt))).for('update'))[0]
  if (!doc) throw new AppError('DOCUMENT_NOT_FOUND', 404, 'Document not found')
  return doc
}

// PUT /pdf: store the uploaded copy (signed scan or an existing PDF). The old uploaded copy is archived, never deleted.
export async function attachUploaded(documentId: string, file: DocFile, userId: string, ctx: Ctx) {
  const { replaced, copied } = await db.transaction(async (tx) => {
    await liveDocument(tx, documentId)
    const files = (await filesOf([documentId], tx)).get(documentId)!
    await tx.delete(documentFiles).where(and(eq(documentFiles.documentId, documentId), eq(documentFiles.kind, 'uploaded')))
    await tx.insert(documentFiles).values({
      documentId, kind: 'uploaded', storedName: file.storedName, originalName: file.originalName, sizeBytes: file.size, pageCount: file.pageCount, createdBy: userId,
    })
    // print -> sign -> scan keeps the layout: when the page counts match, the generated boxes are the starting boxes
    let copied = 0
    if (files.generated && files.generated.pageCount === file.pageCount) {
      const r = await tx.execute(sql`
        INSERT INTO line_pdf_regions (line_id, kind, page, x, y, w, h)
        SELECT g.line_id, 'uploaded', g.page, g.x, g.y, g.w, g.h
        FROM line_pdf_regions g JOIN lines l ON l.id = g.line_id
        WHERE l.document_id = ${documentId} AND l.deleted_at IS NULL AND g.kind = 'generated'
        ON CONFLICT (line_id, kind) DO NOTHING`)
      copied = r.rowCount ?? 0
    }
    await audit(tx, ctx, 'document.upload', 'documents', documentId, null,
      { originalName: file.originalName, pageCount: file.pageCount, replaced: files.uploaded?.storedName ?? null, regionsCopied: copied })
    return { replaced: files.uploaded?.storedName ?? null, copied }
  })
  if (replaced) await archivePdf(replaced) // only after commit
  return { ...filesSummary((await filesOf([documentId])).get(documentId)!), regionsCopied: copied }
}

// DELETE /pdf: the signed copy is moved to archive/ (never deleted), its boxes dropped, the entries unlocked.
export async function removeUploaded(documentId: string, reason: string, ctx: Ctx) {
  const stored = await db.transaction(async (tx) => {
    await liveDocument(tx, documentId)
    const f = (await tx.select().from(documentFiles).where(and(eq(documentFiles.documentId, documentId), eq(documentFiles.kind, 'uploaded'))))[0]
    if (!f) throw new AppError('NO_SIGNED_COPY', 404, 'This document has no signed copy')
    await tx.delete(documentFiles).where(and(eq(documentFiles.documentId, documentId), eq(documentFiles.kind, 'uploaded')))
    await tx.delete(linePdfRegions).where(and(
      eq(linePdfRegions.kind, 'uploaded'),
      inArray(linePdfRegions.lineId, tx.select({ id: lines.id }).from(lines).where(eq(lines.documentId, documentId))),
    ))
    await audit(tx, ctx, 'document.unsign', 'documents', documentId, { originalName: f.originalName, pageCount: f.pageCount }, { reason })
    return f.storedName
  })
  await archivePdf(stored)
  return filesSummary((await filesOf([documentId])).get(documentId)!)
}

// Which file to show: an explicit kind, else the signed copy, else the generated one.
export async function getPdfFile(documentId: string, kind?: PdfKind) {
  const doc = (await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), isNull(documents.deletedAt))))[0]
  if (!doc) throw new AppError('DOCUMENT_NOT_FOUND', 404, 'Document not found')
  const files = (await filesOf([documentId])).get(documentId)!
  const f = kind ? files[kind] : (files.uploaded ?? files.generated)
  const file = f ? path.join(pdfDir(), f.storedName) : null
  if (!f || !file || !existsSync(file)) throw new AppError('PDF_NOT_FOUND', 404, 'No PDF for this document')
  return { file, originalName: f.originalName ?? `${f.kind}.pdf`, kind: f.kind }
}
