import { categorize, formatPeso, type lineInput, type linePatch } from '@traces/shared'
import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { documents, items, linePdfRegions, lines, movements, properties, propertyTypes, qrTokens } from '../db/schema.js'
import { AppError, pgErrorOf } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'
import { assertNotSigned } from './documentFiles.js'
import { insertItem } from './items.js'
import { newToken } from './qr.js'
import { getSettings } from './settings.js'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type LineInput = z.infer<typeof lineInput>
type PropertyInput = LineInput['properties'][number]
type Region = NonNullable<LineInput['region']>
export type Doc = typeof documents.$inferSelect

// BR-11: a token primary-key collision retries the whole transaction (max 3 attempts).
export async function withTokenRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await fn() } catch (e) {
      const pg = pgErrorOf(e)
      if (!(pg?.code === '23505' && pg.constraint === 'qr_tokens_pkey' && attempt < 3)) throw e
    }
  }
}

export type DuplicateNo = { rowIndex: number; propertyNo: string }

const duplicateError = (duplicates: DuplicateNo[]) =>
  new AppError('DUPLICATE_PROPERTY_NO', 409,
    duplicates.length === 1 ? `Property number ${duplicates[0].propertyNo} already exists` : `${duplicates.length} property numbers already exist or repeat`,
    { propertyNo: duplicates[0].propertyNo, duplicates })

// Backstop for a race: 409 naming the number as the user typed it (the DB reports it upper-cased).
function rethrowDuplicateProperty(e: unknown, submitted: PropertyInput[]): never {
  const pg = pgErrorOf(e)
  if (pg?.code === '23505' && pg.constraint === 'properties_property_no_uq') {
    const key = /=\((.*)\) already exists/.exec(pg.detail ?? '')?.[1]
    const propertyNo = submitted.find((p) => p.propertyNo.toUpperCase() === key?.toUpperCase())?.propertyNo ?? key ?? ''
    throw duplicateError([{ rowIndex: 0, propertyNo }])
  }
  throw e
}

// BR-14: before anything is written, find every property number that repeats inside the submission
// or already exists. `rows[i]` is the list of numbers of row i. Throws one 409 listing all of them.
export async function assertNoDuplicateNumbers(tx: Tx, rows: PropertyInput[][]) {
  const all = rows.flatMap((props, rowIndex) => props.map((p) => ({ rowIndex, propertyNo: p.propertyNo, key: p.propertyNo.toUpperCase() })))
  const seen = new Map<string, number>()
  for (const n of all) seen.set(n.key, (seen.get(n.key) ?? 0) + 1)
  const dup = new Set([...seen].filter(([, c]) => c > 1).map(([k]) => k))
  if (all.length) {
    const rows = await tx.select({ no: properties.propertyNo }).from(properties)
      .where(inArray(sql<string>`upper(${properties.propertyNo})`, [...new Set(all.map((n) => n.key))]))
    for (const r of rows) dup.add(r.no.toUpperCase())
  }
  const duplicates = all.filter((n) => dup.has(n.key)).map(({ rowIndex, propertyNo }) => ({ rowIndex, propertyNo }))
  if (duplicates.length) throw duplicateError(duplicates)
}

const warn = (code: string, message: string) => ({ code, message })

// BR-01: ICS is for semi-expendable, PAR for PPE. A mismatch is a warning, never a block.
function mismatchWarning(docType: Doc['type'], category: 'semi' | 'ppe', thresholdCentavos: number) {
  if ((docType === 'ICS') === (category === 'semi')) return undefined
  return warn('DOC_TYPE_MISMATCH', docType === 'ICS'
    ? `This ICS line costs ${formatPeso(thresholdCentavos)} or more, so it is PPE (normally a PAR).`
    : `This PAR line costs less than ${formatPeso(thresholdCentavos)}, so it is semi-expendable (normally an ICS).`)
}

export const lockLiveDocument = async (tx: Tx, id: string) => {
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

// A line carries its card's article, unit and model; they are not stored on the line (3NF).
export async function getLine(lineId: string) {
  const row = (await db.select({ line: lines, article: items.article, unit: items.unit, itemDescription: items.description, propertyTypeCode: propertyTypes.code })
    .from(lines).innerJoin(items, eq(items.id, lines.itemId)).innerJoin(propertyTypes, eq(propertyTypes.id, items.propertyTypeId))
    .where(and(eq(lines.id, lineId), isNull(lines.deletedAt))))[0]
  if (!row) throw new AppError('LINE_NOT_FOUND', 404, 'Line not found')
  const doc = (await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, row.line.documentId), isNull(documents.deletedAt))))[0]
  if (!doc) throw new AppError('DOCUMENT_NOT_FOUND', 404, 'Document not found')
  const regions = await db.select().from(linePdfRegions).where(eq(linePdfRegions.lineId, lineId))
  const props = await db.select().from(properties)
    .where(and(eq(properties.lineId, lineId), isNull(properties.voidedAt))).orderBy(asc(properties.propertyNo))
  const { line, ...card } = row
  return {
    ...line, ...card, properties: props,
    region: regionOut(regions.find((r) => r.kind === 'uploaded')), generatedRegion: regionOut(regions.find((r) => r.kind === 'generated')),
  }
}

// a box drawn by hand sits on the uploaded (signed) copy; boxes of the generated copy come from the layout
export const regionValues = (lineId: string, r: Region, kind: 'generated' | 'uploaded' = 'uploaded') =>
  ({ lineId, kind, page: r.page, x: String(r.x), y: String(r.y), w: String(r.w), h: String(r.h) })

// One token + RECEIPT (date acquired) and ISSUE (document date) movements per property (BR-04).
async function insertProperties(tx: Tx, line: typeof lines.$inferSelect, doc: Doc, props: PropertyInput[]) {
  const rows = await tx.insert(properties).values(props.map((p) => ({
    propertyNo: p.propertyNo, lineId: line.id, serialNo: p.serialNo, oldPropertyNo: p.oldPropertyNo, componentLabel: p.componentLabel, condition: p.condition,
  }))).returning()
  await tx.insert(qrTokens).values(rows.map((p) => ({ token: newToken(), propertyId: p.id })))
  const receiptDate = line.dateAcquired ?? doc.issuedDate // legacy lines may have no date acquired
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

// Cards created inside one save are keyed so identical new cards are created once.
export type ItemCache = Map<string, string>
const itemKey = (category: string, v: { propertyTypeId: number; article: string; description: string }) =>
  `${category}|${v.propertyTypeId}|${v.article.toLowerCase()}|${v.description.toLowerCase()}`

async function resolveItem(tx: Tx, ref: LineInput['item'], category: 'semi' | 'ppe', cache: ItemCache) {
  if ('itemId' in ref) {
    const item = (await tx.select().from(items).where(eq(items.id, ref.itemId)))[0]
    if (!item) throw new AppError('ITEM_NOT_FOUND', 404, 'Card not found')
    if (!item.active) throw new AppError('ITEM_INACTIVE', 409, 'This card is inactive')
    if (item.category !== category) {
      throw new AppError('CATEGORY_MISMATCH', 409,
        `This line is ${category.toUpperCase()} by cost, but the card is ${item.category.toUpperCase()}. Pick or create a ${category === 'ppe' ? 'PC' : 'SPC'} card.`,
        { lineCategory: category, itemCategory: item.category, itemId: item.id })
    }
    return item.id
  }
  const key = itemKey(category, ref.new)
  const hit = cache.get(key)
  if (hit) return hit
  const row = await insertItem(tx, { ...ref.new, category })
  cache.set(key, row.id)
  return row.id
}

// The shared core of createLine and createLinesBatch. The caller holds the document lock and the transaction.
export async function insertLineTx(
  tx: Tx, doc: Doc, input: LineInput, o: { lineNo: number; cache: ItemCache; thresholdCentavos: number; ctx: Ctx },
) {
  const category = categorize(input.line.unitCostCentavos, o.thresholdCentavos)
  const itemId = await resolveItem(tx, input.item, category, o.cache)
  const { lineNo: _ignored, ...fields } = input.line
  const [line] = await tx.insert(lines).values({ ...fields, lineNo: o.lineNo, documentId: doc.id, itemId, category }).returning()
  if (input.region) await tx.insert(linePdfRegions).values(regionValues(line.id, input.region, 'uploaded'))
  await insertProperties(tx, line, doc, input.properties)
  await audit(tx, o.ctx, 'line.create', 'lines', line.id, null, input)
  return { lineId: line.id, category, itemId, warning: mismatchWarning(doc.type, category, o.thresholdCentavos) }
}

const nextLineNo = async (tx: Tx, docId: string) =>
  ((await tx.select({ m: max(lines.lineNo) }).from(lines).where(eq(lines.documentId, docId)))[0].m ?? 0) + 1

export async function createLine(docId: string, input: LineInput, ctx: Ctx) {
  try {
    return await withTokenRetry(() => db.transaction(async (tx) => {
      const doc = await lockLiveDocument(tx, docId) // also serialises line_no allocation
      await assertNotSigned(tx, docId)
      const s = await getSettings(tx)
      await assertNoDuplicateNumbers(tx, [input.properties])
      const lineNo = input.line.lineNo ?? await nextLineNo(tx, docId)
      return insertLineTx(tx, doc, input, { lineNo, cache: new Map(), thresholdCentavos: s.ppeThresholdCentavos, ctx })
    }))
  } catch (e) { rethrowDuplicateProperty(e, input.properties) }
}

// Adds rows to a document in one transaction: any row's failure rolls back all of them.
// Errors that belong to a row carry its index in details.rowIndex.
export async function createLinesBatch(docId: string, rows: LineInput[], ctx: Ctx) {
  try {
    return await withTokenRetry(() => db.transaction(async (tx) => {
      const doc = await lockLiveDocument(tx, docId)
      await assertNotSigned(tx, docId)
      const s = await getSettings(tx)
      await assertNoDuplicateNumbers(tx, rows.map((r) => r.properties))
      const cache: ItemCache = new Map()
      let lineNo = await nextLineNo(tx, docId)
      const out = []
      for (const [rowIndex, row] of rows.entries()) {
        try {
          out.push(await insertLineTx(tx, doc, row, { lineNo: lineNo++, cache, thresholdCentavos: s.ppeThresholdCentavos, ctx }))
        } catch (e) {
          if (e instanceof AppError) throw new AppError(e.code, e.status, e.message, { ...(e.details as object | undefined), rowIndex })
          throw e
        }
      }
      return out
    }))
  } catch (e) { rethrowDuplicateProperty(e, rows.flatMap((r) => r.properties)) }
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
      if (patch.line || patch.item || patch.addProperties?.length || patch.removePropertyNos?.length) await assertNotSigned(tx, doc.id) // boxes stay editable
      const s = await getSettings(tx)
      const { lineNo, ...fields } = patch.line ?? {}

      // category is frozen at creation (BR-01); a cost edit across the threshold only warns
      let warning
      if (fields.unitCostCentavos !== undefined && categorize(fields.unitCostCentavos, s.ppeThresholdCentavos) !== before.category) {
        warning = warn('CATEGORY_UNCHANGED',
          `The new cost is on the other side of the ${formatPeso(s.ppeThresholdCentavos)} threshold, but the category stays ${before.category.toUpperCase()}.`)
      }
      if (Object.keys(fields).length) await tx.update(lines).set(fields).where(eq(lines.id, lineId))
      // the card can be corrected, but only to one of the line's (frozen) category
      if (patch.item) await tx.update(lines).set({ itemId: await resolveItem(tx, patch.item, before.category, new Map()) }).where(eq(lines.id, lineId))
      // the RECEIPT movements carry the date acquired and the IAR number: keep them in step with the line
      if ('dateAcquired' in fields || 'iarNo' in fields) {
        const cur = (await tx.select().from(lines).where(eq(lines.id, lineId)))[0]
        await tx.update(movements).set({
          date: cur.dateAcquired ?? doc.issuedDate, referenceText: cur.iarNo ?? null, referenceDocumentId: cur.iarNo ? null : doc.id,
        }).where(and(eq(movements.type, 'RECEIPT'), inArray(movements.propertyId, tx.select({ id: properties.id }).from(properties).where(eq(properties.lineId, lineId)))))
      }
      if (lineNo !== undefined && lineNo !== before.lineNo) await reorder(tx, doc.id, lineId, lineNo)

      if (patch.region === null) await tx.delete(linePdfRegions).where(and(eq(linePdfRegions.lineId, lineId), eq(linePdfRegions.kind, 'uploaded')))
      else if (patch.region) await upsertRegion(tx, lineId, patch.region, 'uploaded')

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
        const current = (await tx.select().from(lines).where(eq(lines.id, lineId)))[0] // receipt date uses the edited date acquired
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
    await assertNotSigned(tx, before.documentId)
    await tx.update(lines).set({ deletedAt: new Date() }).where(eq(lines.id, lineId))
    await audit(tx, ctx, 'line.delete', 'lines', lineId, before, null)
  })
}

export async function upsertRegion(tx: Tx, lineId: string, r: Region, kind: 'generated' | 'uploaded') {
  const v = regionValues(lineId, r, kind)
  await tx.insert(linePdfRegions).values(v).onConflictDoUpdate({ target: [linePdfRegions.lineId, linePdfRegions.kind], set: v })
}

// PUT /api/lines/:id/region: a box on one kind of PDF. Allowed on signed documents: it never changes the entries.
export async function setRegion(lineId: string, kind: 'generated' | 'uploaded', r: Region, ctx: Ctx) {
  await db.transaction(async (tx) => {
    await lockLiveLine(tx, lineId)
    await upsertRegion(tx, lineId, r, kind)
    await audit(tx, ctx, 'line.region', 'lines', lineId, null, { kind, ...r })
  })
  return regionOut((await db.select().from(linePdfRegions).where(and(eq(linePdfRegions.lineId, lineId), eq(linePdfRegions.kind, kind))))[0])
}
