import { withSerials } from '@traces/shared'
import { and, asc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { movements, officers, properties, propertyTypes, reportSignatories } from '../db/schema.js'
import { officerReport, vActiveProperties, vPropertyCard, vRegistry } from '../db/views.js'
import { AppError } from '../middleware/error.js'
import { mergeCardRows, type CardEvent } from '../projections/card.js'
import { audit, type Ctx } from './audit.js'
import { getSettings } from './settings.js'

type Category = 'semi' | 'ppe'

// The Card, Registry and RPC "sheets" are SQL views (and a function); these functions only filter them and shape the rows.
export type RegistryRow = Awaited<ReturnType<typeof registry>>[number]

// the serials of a line, one per property in property-number order ('' = none)
const serialsOf = (s: string | null) => (s ?? '').split('\n')

const todayManila = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })

export async function registry(category: Category, f: { typeId?: number; from?: string; to?: string } = {}) {
  const rows = await db.select().from(vRegistry)
    .where(and(
      eq(vRegistry.category, category),
      f.typeId ? eq(vRegistry.propertyTypeId, f.typeId) : undefined,
      f.from ? gte(vRegistry.date, f.from) : undefined,
      f.to ? lte(vRegistry.date, f.to) : undefined,
    ))
    .orderBy(asc(vRegistry.date), asc(vRegistry.docNo), asc(vRegistry.lineNo)) // the order row_no counts in
  return rows.map((r) => ({
    id: r.lineId!, // a line: the row a QR scan highlights
    rowNo: r.rowNo!, // the row's number in its register: the same on screen and on paper
    documentId: r.documentId!,
    date: r.date!,
    docType: r.docType!,
    reference: `${r.docType} ${r.docNo}`,
    propertyNos: (r.propertyNos ?? '').split('\n').filter(Boolean),
    article: r.article!,
    description: withSerials(r.description!, serialsOf(r.serialNos)),
    estUsefulLifeYears: r.estUsefulLifeYears,
    issuedTo: r.issuedTo,
    issuedQty: r.issuedQty ?? 0,
    returnedQty: r.returnedQty ?? 0,
    reissuedQty: r.reissuedQty ?? 0,
    disposedQty: r.disposedQty ?? 0,
    balanceQty: r.balanceQty ?? 0,
    amountCentavos: r.amountCentavos ?? 0,
    remarks: r.remarks,
    fundCluster: r.fundCluster!,
    propertyTypeId: r.propertyTypeId!,
    propertyTypeCode: r.propertyTypeCode!,
  }))
}

export async function findPropertyByNo(no: string) {
  const p = (await db.select().from(properties)
    .where(and(sql`upper(${properties.propertyNo}) = ${no.trim().toUpperCase()}`, isNull(properties.voidedAt))))[0]
  if (!p) throw new AppError('PROPERTY_NOT_FOUND', 404, `Property ${no} not found`, { propertyNo: no })
  return p
}

// ───────────── Cards (one per property, decision 2026-11-18) ─────────────
// A card belongs to a main property; a component's card is its unit's.

export async function cardPropertyId(propertyId: string) {
  const p = (await db.select({ id: properties.id, lineId: properties.lineId, componentLabel: properties.componentLabel }).from(properties)
    .where(and(eq(properties.id, propertyId), isNull(properties.voidedAt))))[0]
  if (!p) throw new AppError('CARD_NOT_FOUND', 404, 'Card not found')
  if (!p.componentLabel) return p.id
  const main = (await db.select({ id: properties.id }).from(properties)
    .where(and(eq(properties.lineId, p.lineId), isNull(properties.componentLabel), isNull(properties.voidedAt))))[0]
  if (!main) throw new AppError('CARD_NOT_FOUND', 404, 'Card not found')
  return main.id
}

export async function cardHeader(propertyId: string) {
  const row = (await db.select().from(vActiveProperties)
    .where(and(eq(vActiveProperties.propertyId, propertyId), isNull(vActiveProperties.componentLabel))))[0]
  if (!row) throw new AppError('CARD_NOT_FOUND', 404, 'Card not found')
  const parts = await db.select({ propertyNo: properties.propertyNo, serialNo: properties.serialNo, componentLabel: properties.componentLabel })
    .from(properties).where(and(eq(properties.lineId, row.lineId!), isNotNull(properties.componentLabel), isNull(properties.voidedAt)))
    .orderBy(asc(properties.propertyNo))
  return {
    id: row.propertyId!, propertyNo: row.propertyNo!, serialNo: row.serialNo, category: row.category!, article: row.article!,
    description: withSerials(row.lineDescription!, [row.serialNo, ...parts.map((p) => p.serialNo)]),
    unit: row.unit!, propertyTypeId: row.propertyTypeId!, propertyTypeCode: row.propertyTypeCode!, propertyTypeName: row.propertyTypeName!,
    lineId: row.lineId!, documentId: row.documentId!, docType: row.docType!, docNo: row.docNo!, issuedDate: row.issuedDate!,
    components: parts.map((p) => ({ propertyNo: p.propertyNo, label: p.componentLabel!, serialNo: p.serialNo })),
  }
}

export async function cardEvents(propertyId: string): Promise<CardEvent[]> {
  return (await db.select().from(vPropertyCard).where(eq(vPropertyCard.propertyId, propertyId))
    .orderBy(asc(vPropertyCard.date), asc(vPropertyCard.firstMovementId))) as unknown as CardEvent[]
}

export async function cardRows(propertyId: string, mode?: 'merged' | 'split') {
  return mergeCardRows(await cardEvents(propertyId), mode ?? (await getSettings()).cardRowMode)
}

export async function card(propertyId: string, mode?: 'merged' | 'split') {
  const id = await cardPropertyId(propertyId)
  const header = await cardHeader(id)
  return { header, rows: await cardRows(id, mode) }
}

const holderName = () => sql<string | null>`(select o.full_name from v_custody cu join officers o on o.id = cu.holder_officer_id
  where cu.property_id = "v_active_properties"."property_id")`

// /cards: one row per card (main property), newest first, with who holds it now
export async function listCards(f: { category?: Category; typeId?: number; q?: string } = {}) {
  const term = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
  const ap = vActiveProperties
  return db.select({
    id: ap.propertyId, propertyNo: ap.propertyNo, serialNo: ap.serialNo, category: ap.category, article: ap.article,
    description: ap.lineDescription, unit: ap.unit, propertyTypeId: ap.propertyTypeId, propertyTypeCode: ap.propertyTypeCode,
    documentId: ap.documentId, docType: ap.docType, docNo: ap.docNo, issuedDate: ap.issuedDate, holder: holderName(),
  }).from(ap)
    .where(and(
      isNull(ap.componentLabel),
      f.category ? eq(ap.category, f.category) : undefined,
      f.typeId ? eq(ap.propertyTypeId, f.typeId) : undefined,
      term ? or(ilike(ap.propertyNo, term), ilike(ap.article, term), ilike(ap.lineDescription, term), ilike(ap.serialNo, term),
        sql`${holderName()} ilike ${term}`) : undefined,
    ))
    .orderBy(sql`${ap.issuedDate} desc`, asc(ap.propertyNo))
}

// a card row's Remarks (decision 2026-11-18), kept on the movement the row shows; for later transfers
export async function setCardRemarks(movementId: number, remarks: string | null, ctx: Ctx) {
  return db.transaction(async (tx) => {
    const m = (await tx.select().from(movements).where(eq(movements.id, movementId)).for('update'))[0]
    if (!m) throw new AppError('CARD_ROW_NOT_FOUND', 404, 'Card row not found')
    await tx.update(movements).set({ remarks }).where(eq(movements.id, movementId))
    await audit(tx, ctx, 'card.remarks', 'movements', String(movementId), { remarks: m.remarks }, { remarks })
    return { id: movementId, remarks }
  })
}

// ───────────── Officer report (RPCSP / RPCPPE) ─────────────

export async function getSignatories() {
  return db.select().from(reportSignatories).orderBy(asc(reportSignatories.role), asc(reportSignatories.sortOrder))
}

// who the report is for, the type filter and the as-at date, shared by the RPC and the IIRUP/IIRUSP
async function reportScope(q: { officerId: string; typeId?: number; asAt?: string }) {
  const officer = (await db.select({ id: officers.id, fullName: officers.fullName, position: officers.position, office: officers.office })
    .from(officers).where(eq(officers.id, q.officerId)))[0]
  if (!officer) throw new AppError('OFFICER_NOT_FOUND', 404, 'Officer not found')
  const type = q.typeId ? (await db.select().from(propertyTypes).where(eq(propertyTypes.id, q.typeId)))[0] ?? null : null
  if (q.typeId && !type) throw new AppError('PROPERTY_TYPE_NOT_FOUND', 404, 'Property type not found')
  return { officer, type, asAt: q.asAt ?? todayManila() }
}

// a legacy number is printed in Remarks automatically (decision 2026-11-14)
async function oldNumberRemarks(lineIds: string[]) {
  const old = lineIds.length
    ? await db.select({ lineId: properties.lineId, no: properties.propertyNo, old: properties.oldPropertyNo }).from(properties)
      .where(and(inArray(properties.lineId, lineIds), isNotNull(properties.oldPropertyNo), isNull(properties.voidedAt)))
      .orderBy(asc(properties.propertyNo))
    : []
  return (lineId: string) => {
    const o = old.filter((x) => x.lineId === lineId)
    return o.length ? `Old P#: ${o.length === 1 ? o[0].old : o.map((x) => `${x.old} (${x.no})`).join(', ')}` : null
  }
}

const byArticle = (a: { article: string; docNo: string; propertyNos: string }, b: typeof a) =>
  a.article.localeCompare(b.article) || a.docNo.localeCompare(b.docNo) || a.propertyNos.localeCompare(b.propertyNos)

// RPCSP / RPCPPE: the serviceable items the officer holds. With a count (decision 2026-11-19) each row also says whether its
// units were found: `counted` is true when every main unit was scanned; `countedUnits` says how many. Without one both are null.
export async function officerReportRows(q: { officerId: string; category: Category; typeId?: number; asAt?: string; countId?: string }) {
  const { officer, type, asAt } = await reportScope(q)
  const rows = (await officerReport(asAt, db, q.countId ?? null))
    .filter((r) => r.officerId === q.officerId && r.category === q.category && r.condition === 'serviceable' && (!q.typeId || r.propertyTypeId === q.typeId))
    .sort(byArticle)
  const remarks = await oldNumberRemarks(rows.map((r) => r.lineId))
  return {
    officer, category: q.category, type, asAt, countId: q.countId ?? null,
    rows: rows.map((r, i) => ({
      id: r.lineId, // the line: the row a QR scan highlights
      rowNo: i + 1, // the row's number on this report, on screen and on paper
      documentId: r.documentId,
      article: r.article, description: withSerials(r.description, serialsOf(r.serialNos)), propertyNos: r.propertyNos.split('\n'),
      unit: r.unit, unitValueCentavos: r.unitValueCentavos, balancePerCard: r.balancePerCard,
      reference: `${r.docType} ${r.docNo}`,
      remarks: remarks(r.lineId),
      countedUnits: r.countedUnits,
      counted: r.countedUnits === null ? null : r.countedUnits >= r.balancePerCard,
    })),
    signatories: await getSignatories(),
  }
}

// IIRUP (PPE) and IIRUSP (semi-expendable): the unserviceable items the officer holds. Cost columns are worked out here;
// accumulated depreciation, impairment, carrying amount and the disposal columns are not stored, so they print blank.
export async function unserviceableRows(q: { officerId: string; category: Category; typeId?: number; asAt?: string }) {
  const { officer, type, asAt } = await reportScope(q)
  const rows = (await officerReport(asAt))
    .filter((r) => r.officerId === q.officerId && r.category === q.category && r.condition === 'unserviceable' && (!q.typeId || r.propertyTypeId === q.typeId))
    .sort(byArticle)
  const remarks = await oldNumberRemarks(rows.map((r) => r.lineId))
  return {
    officer, category: q.category, type, asAt,
    rows: rows.map((r, i) => ({
      id: r.lineId,
      rowNo: i + 1,
      documentId: r.documentId,
      dateAcquired: r.issuedDate, // the card date is the ICS/PAR issue date (decision 2026-11-18)
      article: r.article, description: withSerials(r.description, serialsOf(r.serialNos)), propertyNos: r.propertyNos.split('\n'),
      unit: r.unit, qty: r.balancePerCard, unitValueCentavos: r.unitValueCentavos, totalCostCentavos: r.balancePerCard * r.unitValueCentavos,
      reference: `${r.docType} ${r.docNo}`,
      remarks: remarks(r.lineId),
    })),
  }
}
