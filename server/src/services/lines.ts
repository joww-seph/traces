import { categorize, formatPeso, type lineInput, type linePatch } from '@traces/shared'
import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { documents, linePdfRegions, lines, movements, properties, propertyTypes, qrTokens } from '../db/schema.js'
import { AppError, pgErrorOf } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'
import { assertNotSigned } from './documentFiles.js'
import { newToken } from './qr.js'
import { getSettings } from './settings.js'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type LineInput = z.infer<typeof lineInput>
type PropertyInput = LineInput['properties'][number]
type Region = NonNullable<LineInput['region']>
export type Doc = typeof documents.$inferSelect

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

function rethrowDuplicateProperty(e: unknown, submitted: PropertyInput[]): never {
  const pg = pgErrorOf(e)
  if (pg?.code === '23505' && pg.constraint === 'properties_property_no_uq') {
    const key = /=\((.*)\) already exists/.exec(pg.detail ?? '')?.[1]
    const propertyNo = submitted.find((p) => p.propertyNo.toUpperCase() === key?.toUpperCase())?.propertyNo ?? key ?? ''
    throw duplicateError([{ rowIndex: 0, propertyNo }])
  }
  throw e
}

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

export const regionOut = (r: typeof linePdfRegions.$inferSelect | undefined | null) =>
  r ? { page: r.page, x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) } : null

export async function getLine(lineId: string) {
  const row = (await db.select({ line: lines, propertyTypeCode: propertyTypes.code })
    .from(lines).innerJoin(propertyTypes, eq(propertyTypes.id, lines.propertyTypeId))
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

export const regionValues = (lineId: string, r: Region, kind: 'generated' | 'uploaded' = 'uploaded') =>
  ({ lineId, kind, page: r.page, x: String(r.x), y: String(r.y), w: String(r.w), h: String(r.h) })

async function insertProperties(tx: Tx, line: typeof lines.$inferSelect, doc: Doc, props: PropertyInput[]) {
  const rows = await tx.insert(properties).values(props.map((p) => ({
    propertyNo: p.propertyNo, lineId: line.id, serialNo: p.serialNo, oldPropertyNo: p.oldPropertyNo, componentLabel: p.componentLabel, condition: p.condition,
  }))).returning()
  await tx.insert(qrTokens).values(rows.map((p) => ({ token: newToken(), propertyId: p.id })))
  await tx.insert(movements).values(rows.flatMap((p) => [
    {
      propertyId: p.id, type: 'RECEIPT' as const, date: doc.issuedDate,
      referenceDocumentId: line.iarNo ? null : doc.id, referenceText: line.iarNo ?? null,
    },
    {
      propertyId: p.id, type: 'ISSUE' as const, date: doc.issuedDate,
      officerId: doc.receivedByOfficerId, referenceDocumentId: doc.id,
    },
  ]))
  return rows
}

async function assertUnits(tx: Tx, doc: Doc, lineId: string) {
  const onLine = await tx.select({ c: properties.componentLabel }).from(properties).where(and(eq(properties.lineId, lineId), isNull(properties.voidedAt)))
  if (onLine.some((p) => p.c) && onLine.filter((p) => !p.c).length !== 1) {
    throw new AppError('PARTS_NEED_ONE_UNIT', 400, 'A row with parts must have exactly one main unit')
  }
  if (doc.type !== 'PAR') return
  const mains = (await tx.select({ n: sql<number>`count(*)::int` }).from(properties)
    .innerJoin(lines, and(eq(lines.id, properties.lineId), isNull(lines.deletedAt)))
    .where(and(eq(lines.documentId, doc.id), isNull(properties.voidedAt), isNull(properties.componentLabel))))[0].n
  if (mains > 1) throw new AppError('PAR_ONE_PROPERTY', 400, 'A PAR holds one property (with its parts); give each unit its own PAR')
}

export async function insertLineTx(
  tx: Tx, doc: Doc, input: LineInput, o: { lineNo: number; thresholdCentavos: number; ctx: Ctx },
) {
  const category = categorize(input.line.unitCostCentavos, o.thresholdCentavos)
  const { lineNo: _ignored, ...fields } = input.line
  const [line] = await tx.insert(lines).values({ ...fields, category, lineNo: o.lineNo, documentId: doc.id }).returning()
  if (input.region) await tx.insert(linePdfRegions).values(regionValues(line.id, input.region, 'uploaded'))
  await insertProperties(tx, line, doc, input.properties)
  await assertUnits(tx, doc, line.id)
  await audit(tx, o.ctx, 'line.create', 'lines', line.id, null, input)
  return { lineId: line.id, category, warning: mismatchWarning(doc.type, category, o.thresholdCentavos) }
}

const nextLineNo = async (tx: Tx, docId: string) =>
  ((await tx.select({ m: max(lines.lineNo) }).from(lines).where(eq(lines.documentId, docId)))[0].m ?? 0) + 1

export async function createLine(docId: string, input: LineInput, ctx: Ctx) {
  try {
    return await withTokenRetry(() => db.transaction(async (tx) => {
      const doc = await lockLiveDocument(tx, docId)
      await assertNotSigned(tx, docId)
      const s = await getSettings(tx)
      await assertNoDuplicateNumbers(tx, [input.properties])
      const lineNo = input.line.lineNo ?? await nextLineNo(tx, docId)
      return insertLineTx(tx, doc, input, { lineNo, thresholdCentavos: s.ppeThresholdCentavos, ctx })
    }))
  } catch (e) { rethrowDuplicateProperty(e, input.properties) }
}

export async function createLinesBatch(docId: string, rows: LineInput[], ctx: Ctx) {
  try {
    return await withTokenRetry(() => db.transaction(async (tx) => {
      const doc = await lockLiveDocument(tx, docId)
      await assertNotSigned(tx, docId)
      const s = await getSettings(tx)
      await assertNoDuplicateNumbers(tx, rows.map((r) => r.properties))
      let lineNo = await nextLineNo(tx, docId)
      const out = []
      for (const [rowIndex, row] of rows.entries()) {
        try {
          out.push(await insertLineTx(tx, doc, row, { lineNo: lineNo++, thresholdCentavos: s.ppeThresholdCentavos, ctx }))
        } catch (e) {
          if (e instanceof AppError) throw new AppError(e.code, e.status, e.message, { ...(e.details as object | undefined), rowIndex })
          throw e
        }
      }
      return out
    }))
  } catch (e) { rethrowDuplicateProperty(e, rows.flatMap((r) => r.properties)) }
}

async function reorder(tx: Tx, docId: string, lineId: string, target: number) {
  const ids = (await tx.select({ id: lines.id }).from(lines).where(eq(lines.documentId, docId)).orderBy(asc(lines.lineNo)))
    .map((l) => l.id).filter((id) => id !== lineId)
  ids.splice(Math.min(Math.max(target, 1), ids.length + 1) - 1, 0, lineId)
  await tx.update(lines).set({ lineNo: sql`${lines.lineNo} + 1000000` }).where(eq(lines.documentId, docId))
  for (const [i, id] of ids.entries()) await tx.update(lines).set({ lineNo: i + 1 }).where(eq(lines.id, id))
}

export async function updateLine(lineId: string, patch: z.infer<typeof linePatch>, ctx: Ctx) {
  const added = patch.addProperties ?? []
  try {
    return await withTokenRetry(() => db.transaction(async (tx) => {
      const before = await lockLiveLine(tx, lineId)
      const doc = await lockLiveDocument(tx, before.documentId)
      if (patch.line || patch.addProperties?.length || patch.removePropertyNos?.length) await assertNotSigned(tx, doc.id)
      const s = await getSettings(tx)
      const { lineNo, ...fields } = patch.line ?? {}
      const category = before.category

      let warning
      if (fields.unitCostCentavos !== undefined && categorize(fields.unitCostCentavos, s.ppeThresholdCentavos) !== category) {
        warning = warn('CATEGORY_UNCHANGED',
          `The new cost is on the other side of the ${formatPeso(s.ppeThresholdCentavos)} threshold, but the category stays ${category.toUpperCase()}.`)
      }
      if (Object.keys(fields).length) await tx.update(lines).set(fields).where(eq(lines.id, lineId))
      if ('iarNo' in fields) {
        const cur = (await tx.select().from(lines).where(eq(lines.id, lineId)))[0]
        await tx.update(movements).set({
          referenceText: cur.iarNo ?? null, referenceDocumentId: cur.iarNo ? null : doc.id,
        }).where(and(eq(movements.type, 'RECEIPT'), inArray(movements.propertyId, tx.select({ id: properties.id }).from(properties).where(eq(properties.lineId, lineId)))))
      }
      if (lineNo !== undefined && lineNo !== before.lineNo) await reorder(tx, doc.id, lineId, lineNo)

      if (patch.region === null) await tx.delete(linePdfRegions).where(and(eq(linePdfRegions.lineId, lineId), eq(linePdfRegions.kind, 'uploaded')))
      else if (patch.region) await upsertRegion(tx, lineId, patch.region, 'uploaded')

      for (const no of patch.removePropertyNos ?? []) {
        const p = (await tx.select().from(properties).where(and(
          eq(properties.lineId, lineId), isNull(properties.voidedAt), sql`upper(${properties.propertyNo}) = ${no.toUpperCase()}`,
        )))[0]
        if (!p) throw new AppError('PROPERTY_NOT_FOUND', 404, `Property ${no} is not on this line`, { propertyNo: no })
        await tx.update(properties).set({ voidedAt: new Date() }).where(eq(properties.id, p.id))
        await tx.update(qrTokens).set({ revokedAt: new Date() }).where(and(eq(qrTokens.propertyId, p.id), isNull(qrTokens.revokedAt)))
      }
      if (added.length) {
        const current = (await tx.select().from(lines).where(eq(lines.id, lineId)))[0]
        await insertProperties(tx, current, doc, added)
      }
      if (added.length || patch.removePropertyNos?.length) await assertUnits(tx, doc, lineId)

      await audit(tx, ctx, 'line.update', 'lines', lineId, before, patch)
      return { lineId, category, warning }
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

export async function setRegion(lineId: string, kind: 'generated' | 'uploaded', r: Region, ctx: Ctx) {
  await db.transaction(async (tx) => {
    await lockLiveLine(tx, lineId)
    await upsertRegion(tx, lineId, r, kind)
    await audit(tx, ctx, 'line.region', 'lines', lineId, null, { kind, ...r })
  })
  return regionOut((await db.select().from(linePdfRegions).where(and(eq(linePdfRegions.lineId, lineId), eq(linePdfRegions.kind, kind))))[0])
}
