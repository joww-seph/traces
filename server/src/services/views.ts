import { and, asc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { items, officers, properties, propertyTypes, reportSignatories } from '../db/schema.js'
import { officerReport, vActiveProperties, vItemCard, vRegistry } from '../db/views.js'
import { AppError } from '../middleware/error.js'
import { mergeCardRows, type CardEvent } from '../projections/card.js'
import { getSettings } from './settings.js'

type Category = 'semi' | 'ppe'

// The Card, Registry and RPC "sheets" are SQL views (and a function); these functions only filter them and shape the rows.
export type RegistryRow = Awaited<ReturnType<typeof registry>>[number]

const todayManila = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })

export async function registry(category: Category, f: { typeId?: number; from?: string; to?: string } = {}) {
  const rows = await db.select().from(vRegistry)
    .where(and(
      eq(vRegistry.category, category),
      f.typeId ? eq(vRegistry.propertyTypeId, f.typeId) : undefined,
      f.from ? gte(vRegistry.date, f.from) : undefined,
      f.to ? lte(vRegistry.date, f.to) : undefined,
    ))
    .orderBy(asc(vRegistry.date), asc(vRegistry.docNo), asc(vRegistry.propertyNos))
  return rows.map((r) => ({
    id: r.lineId!, // a line: the row a QR scan highlights
    date: r.date!,
    docType: r.docType!,
    reference: `${r.docType} ${r.docNo}`,
    propertyNos: (r.propertyNos ?? '').split('\n').filter(Boolean),
    article: r.article!,
    description: r.description!,
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

// ───────────── Cards (one per model) ─────────────

export async function cardHeader(itemId: string) {
  const row = (await db.select({
    id: items.id, category: items.category, article: items.article, description: items.description, unit: items.unit, active: items.active,
    propertyTypeId: items.propertyTypeId, propertyTypeCode: propertyTypes.code, propertyTypeName: propertyTypes.name,
  }).from(items).innerJoin(propertyTypes, eq(propertyTypes.id, items.propertyTypeId)).where(eq(items.id, itemId)))[0]
  if (!row) throw new AppError('ITEM_NOT_FOUND', 404, 'Card not found')
  // the range of property numbers on the card: first - last of the main units
  const range = (await db.select({
    first: sql<string | null>`min(${vActiveProperties.propertyNo})`, last: sql<string | null>`max(${vActiveProperties.propertyNo})`,
  }).from(vActiveProperties).where(and(eq(vActiveProperties.itemId, itemId), isNull(vActiveProperties.componentLabel))))[0]
  return { ...row, propertyNoFirst: range.first, propertyNoLast: range.last }
}

export async function cardEvents(itemId: string): Promise<CardEvent[]> {
  return (await db.select().from(vItemCard).where(eq(vItemCard.itemId, itemId))
    .orderBy(asc(vItemCard.date), asc(vItemCard.firstMovementId))) as unknown as CardEvent[]
}

export async function cardRows(itemId: string, mode?: 'merged' | 'split') {
  return mergeCardRows(await cardEvents(itemId), mode ?? (await getSettings()).cardRowMode)
}

export async function card(itemId: string, mode?: 'merged' | 'split') {
  const header = await cardHeader(itemId)
  return { header, rows: await cardRows(itemId, mode) }
}

// /cards: every card with the balance the Supply Unit holds and how many units are with officers
export async function listCards(f: { category?: Category; typeId?: number; q?: string } = {}) {
  const term = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
  const rows = await db.select({
    id: items.id, category: items.category, article: items.article, description: items.description, unit: items.unit,
    propertyTypeId: items.propertyTypeId, propertyTypeCode: propertyTypes.code, active: items.active,
    balanceQty: sql<number>`coalesce((select sum(case when c.type in ('RECEIPT','RETURN') then c.qty else -c.qty end) from ${vItemCard} c where c.item_id = ${items.id}), 0)::int`,
    unitsIssued: sql<number>`(select count(*) from ${vActiveProperties} ap join v_custody cu on cu.property_id = ap.property_id and cu.holder_officer_id is not null
      where ap.item_id = ${items.id} and ap.component_label is null)::int`,
  }).from(items).innerJoin(propertyTypes, eq(propertyTypes.id, items.propertyTypeId))
    .where(and(
      f.category ? eq(items.category, f.category) : undefined,
      f.typeId ? eq(items.propertyTypeId, f.typeId) : undefined,
      term ? or(ilike(items.article, term), ilike(items.description, term)) : undefined,
    ))
    .orderBy(asc(items.article), asc(items.description))
  return rows
}

// ───────────── Officer report (RPCSP / RPCPPE) ─────────────

export async function getSignatories() {
  return db.select().from(reportSignatories).orderBy(asc(reportSignatories.role), asc(reportSignatories.sortOrder))
}

export async function officerReportRows(q: { officerId: string; category: Category; typeId?: number; asAt?: string }) {
  const officer = (await db.select({ id: officers.id, fullName: officers.fullName, position: officers.position, office: officers.office })
    .from(officers).where(eq(officers.id, q.officerId)))[0]
  if (!officer) throw new AppError('OFFICER_NOT_FOUND', 404, 'Officer not found')
  const type = q.typeId ? (await db.select().from(propertyTypes).where(eq(propertyTypes.id, q.typeId)))[0] ?? null : null
  if (q.typeId && !type) throw new AppError('PROPERTY_TYPE_NOT_FOUND', 404, 'Property type not found')
  const asAt = q.asAt ?? todayManila()

  const rows = (await officerReport(asAt))
    .filter((r) => r.officerId === q.officerId && r.category === q.category && (!q.typeId || r.propertyTypeId === q.typeId))
    .sort((a, b) => a.article.localeCompare(b.article) || a.docNo.localeCompare(b.docNo) || a.propertyNos.localeCompare(b.propertyNos))

  // a legacy number is printed in Remarks automatically (decision 2026-11-14)
  const lineIds = rows.map((r) => r.lineId)
  const old = lineIds.length
    ? await db.select({ lineId: properties.lineId, no: properties.propertyNo, old: properties.oldPropertyNo }).from(properties)
      .where(and(inArray(properties.lineId, lineIds), isNotNull(properties.oldPropertyNo), isNull(properties.voidedAt)))
      .orderBy(asc(properties.propertyNo))
    : []
  return {
    officer, category: q.category, type, asAt,
    rows: rows.map((r) => {
      const o = old.filter((x) => x.lineId === r.lineId)
      return {
        id: r.lineId, // the line: the row a QR scan highlights
        article: r.article, description: r.description, propertyNos: r.propertyNos.split('\n'),
        unit: r.unit, unitValueCentavos: r.unitValueCentavos, balancePerCard: r.balancePerCard,
        reference: `${r.docType} ${r.docNo}`,
        remarks: o.length ? `Old P#: ${o.length === 1 ? o[0].old : o.map((x) => `${x.old} (${x.no})`).join(', ')}` : null,
      }
    }),
    signatories: await getSignatories(),
  }
}
