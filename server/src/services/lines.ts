import { categorize, formatPeso, type lineInput, type linePatch } from '@traces/shared'
import { and, asc, eq, isNull, max, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { documents, linePdfRegions, lines, movements, properties, qrTokens } from '../db/schema.js'
import { AppError, pgErrorOf } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'
import { newToken } from './qr.js'
import { getSettings } from './settings.js'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type LineInput = z.infer<typeof lineInput>
type PropertyInput = LineInput['properties'][number]
type Region = NonNullable<LineInput['region']>
type Doc = typeof documents.$inferSelect

// BR-11: a token primary-key collision retries the whole transaction (max 3 attempts).
export async function withTokenRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await fn() } catch (e) {
      const pg = pgErrorOf(e)
      if (!(pg?.code === '23505' && pg.constraint === 'qr_tokens_pkey' && attempt < 3)) throw e
    }
  }
}

// 409 naming the number as the user typed it (the DB reports it upper-cased).
function rethrowDuplicateProperty(e: unknown, submitted: PropertyInput[]): never {
  const pg = pgErrorOf(e)
  if (pg?.code === '23505' && pg.constraint === 'properties_property_no_uq') {
    const key = /=\((.*)\) already exists/.exec(pg.detail ?? '')?.[1]
    const propertyNo = submitted.find((p) => p.propertyNo.toUpperCase() === key?.toUpperCase())?.propertyNo ?? key
    throw new AppError('DUPLICATE_PROPERTY_NO', 409, `Property number ${propertyNo} already exists`, { propertyNo })
  }
  throw e
}

const warn = (code: string, message: string) => ({ code, message })

// BR-01: ICS is for semi-expendable, PAR for PPE. A mismatch is a warning, never a block.
function mismatchWarning(docType: Doc['type'], category: 'semi' | 'ppe', thresholdCentavos: number) {
  if ((docType === 'ICS') === (category === 'semi')) return undefined
  return warn('CATEGORY_MISMATCH', docType === 'ICS'
    ? `This ICS line costs ${formatPeso(thresholdCentavos)} or more, so it is PPE (normally a PAR).`
    : `This PAR line costs less than ${formatPeso(thresholdCentavos)}, so it is semi-expendable (normally an ICS).`)
}

const lockLiveDocument = async (tx: Tx, id: string) => {
  const doc = (await tx.select().from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt))).for('update'))[0]
  if (!doc) throw new AppError('DOCUMENT_NOT_FOUND', 404, 'Document not found')
  return doc
}

const lockLiveLine = async (tx: Tx, id: string) => {
  const line = (await tx.select().from(lines).where(and(eq(lines.id, id), isNull(lines.deletedAt))).for('update'))[0]
  if (!line) throw new AppError('LINE_NOT_FOUND', 404, 'Line not found')
  return line
}

// numeric columns come back as strings; the API exposes fractions as numbers
export const regionOut = (r: typeof linePdfRegions.$inferSelect | undefined | null) =>
  r ? { page: r.page, x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) } : null

export async function getLine(lineId: string) {
  const line = (await db.select().from(lines).where(and(eq(lines.id, lineId), isNull(lines.deletedAt))))[0]
  if (!line) throw new AppError('LINE_NOT_FOUND', 404, 'Line not found')
  const doc = (await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, line.documentId), isNull(documents.deletedAt))))[0]
  if (!doc) throw new AppError('DOCUMENT_NOT_FOUND', 404, 'Document not found')
  const region = (await db.select().from(linePdfRegions).where(eq(linePdfRegions.lineId, lineId)))[0]
  const props = await db.select().from(properties)
    .where(and(eq(properties.lineId, lineId), isNull(properties.voidedAt))).orderBy(asc(properties.propertyNo))
  return { ...line, region: regionOut(region), properties: props }
}

const regionValues = (lineId: string, r: Region) =>
  ({ lineId, page: r.page, x: String(r.x), y: String(r.y), w: String(r.w), h: String(r.h) })

// One token + RECEIPT and ISSUE movements per property (BR-04).
async function insertProperties(tx: Tx, line: typeof lines.$inferSelect, doc: Doc, props: PropertyInput[]) {
  const rows = await tx.insert(properties).values(props.map((p) => ({
    propertyNo: p.propertyNo, lineId: line.id, serialNo: p.serialNo, oldPropertyNo: p.oldPropertyNo, componentLabel: p.componentLabel, condition: p.condition,
  }))).returning()
  await tx.insert(qrTokens).values(rows.map((p) => ({ token: newToken(), propertyId: p.id })))
  const receiptDate = line.iarDate ?? line.dateAcquired ?? doc.issuedDate
  await tx.insert(movements).values(rows.flatMap((p) => [
    {
      propertyId: p.id, type: 'RECEIPT' as const, date: receiptDate,
      referenceDocumentId: line.iarNo ? null : doc.id, referenceText: line.iarNo ?? null,
    },
    {
      propertyId: p.id, type: 'ISSUE' as const, date: doc.issuedDate,
      officerId: doc.receivedByOfficerId, referenceDocumentId: doc.id,
    },
  ]))
  return rows
}

export async function createLine(docId: string, input: LineInput, ctx: Ctx) {
  try {
    return await withTokenRetry(() => db.transaction(async (tx) => {
      const doc = await lockLiveDocument(tx, docId) // also serialises line_no allocation
      const s = await getSettings(tx)
      const category = categorize(input.line.unitCostCentavos, s.ppeThresholdCentavos)
      const lineNo = input.line.lineNo
        ?? ((await tx.select({ m: max(lines.lineNo) }).from(lines).where(eq(lines.documentId, docId)))[0].m ?? 0) + 1
      const [line] = await tx.insert(lines).values({ ...input.line, lineNo, documentId: docId, category }).returning()
      if (input.region) await tx.insert(linePdfRegions).values(regionValues(line.id, input.region))
      await insertProperties(tx, line, doc, input.properties)
      await audit(tx, ctx, 'line.create', 'lines', line.id, null, input)
      return { lineId: line.id, category, warning: mismatchWarning(doc.type, category, s.ppeThresholdCentavos) }
    }))
  } catch (e) { rethrowDuplicateProperty(e, input.properties) }
}

// Moves a line to position `target`, renumbering the document's lines (soft-deleted ones keep a slot).
async function reorder(tx: Tx, docId: string, lineId: string, target: number) {
  const ids = (await tx.select({ id: lines.id }).from(lines).where(eq(lines.documentId, docId)).orderBy(asc(lines.lineNo)))
    .map((l) => l.id).filter((id) => id !== lineId)
  ids.splice(Math.min(Math.max(target, 1), ids.length + 1) - 1, 0, lineId)
  // park everything above the old range first: (document_id, line_no) is unique and not deferrable
  await tx.update(lines).set({ lineNo: sql`${lines.lineNo} + 1000000` }).where(eq(lines.documentId, docId))
  for (const [i, id] of ids.entries()) await tx.update(lines).set({ lineNo: i + 1 }).where(eq(lines.id, id))
}

export async function updateLine(lineId: string, patch: z.infer<typeof linePatch>, ctx: Ctx) {
  const added = patch.addProperties ?? []
  try {
    return await withTokenRetry(() => db.transaction(async (tx) => {
      const before = await lockLiveLine(tx, lineId)
      const doc = await lockLiveDocument(tx, before.documentId)
      const s = await getSettings(tx)
      const { lineNo, ...fields } = patch.line ?? {}

      // category is frozen at creation (BR-01); a cost edit across the threshold only warns
      let warning
      if (fields.unitCostCentavos !== undefined && categorize(fields.unitCostCentavos, s.ppeThresholdCentavos) !== before.category) {
        warning = warn('CATEGORY_UNCHANGED',
          `The new cost is on the other side of the ${formatPeso(s.ppeThresholdCentavos)} threshold, but the category stays ${before.category.toUpperCase()}.`)
      }
      if (Object.keys(fields).length) await tx.update(lines).set(fields).where(eq(lines.id, lineId))
      if (lineNo !== undefined && lineNo !== before.lineNo) await reorder(tx, doc.id, lineId, lineNo)

      if (patch.region === null) await tx.delete(linePdfRegions).where(eq(linePdfRegions.lineId, lineId))
      else if (patch.region) {
        const v = regionValues(lineId, patch.region)
        await tx.insert(linePdfRegions).values(v).onConflictDoUpdate({ target: linePdfRegions.lineId, set: v })
      }

      // removal voids the property and revokes its token; nothing is hard-deleted (BR-05)
      for (const no of patch.removePropertyNos ?? []) {
        const p = (await tx.select().from(properties).where(and(
          eq(properties.lineId, lineId), isNull(properties.voidedAt), sql`upper(${properties.propertyNo}) = ${no.toUpperCase()}`,
        )))[0]
        if (!p) throw new AppError('PROPERTY_NOT_FOUND', 404, `Property ${no} is not on this line`, { propertyNo: no })
        await tx.update(properties).set({ voidedAt: new Date() }).where(eq(properties.id, p.id))
        await tx.update(qrTokens).set({ revokedAt: new Date() }).where(and(eq(qrTokens.propertyId, p.id), isNull(qrTokens.revokedAt)))
      }
      if (added.length) {
        const current = (await tx.select().from(lines).where(eq(lines.id, lineId)))[0] // receipt date uses the edited iar/date fields
        await insertProperties(tx, current, doc, added)
      }

      await audit(tx, ctx, 'line.update', 'lines', lineId, before, patch)
      return { lineId, category: before.category, warning }
    }))
  } catch (e) { rethrowDuplicateProperty(e, added) }
}

export async function deleteLine(lineId: string, ctx: Ctx) {
  await db.transaction(async (tx) => {
    const before = await lockLiveLine(tx, lineId)
    await tx.update(lines).set({ deletedAt: new Date() }).where(eq(lines.id, lineId))
    await audit(tx, ctx, 'line.delete', 'lines', lineId, before, null)
  })
}
