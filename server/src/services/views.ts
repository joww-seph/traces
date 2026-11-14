import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { properties } from '../db/schema.js'
import { vCardMovements, vCountRows, vRegistry } from '../db/views.js'
import { AppError } from '../middleware/error.js'
import { mergeCardRows, type CardMovement } from '../projections/card.js'
import { getSettings } from './settings.js'

type Category = 'semi' | 'ppe'

// The Registry, Card and RPC "sheets" are SQL views; these functions only filter them and shape the rows.
export type RegistryRow = Awaited<ReturnType<typeof registry>>[number]

export async function registry(category: Category, from?: string, to?: string) {
  const rows = await db.select().from(vRegistry)
    .where(and(eq(vRegistry.category, category), from ? gte(vRegistry.date, from) : undefined, to ? lte(vRegistry.date, to) : undefined))
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
  }))
}

export async function findPropertyByNo(no: string) {
  const p = (await db.select().from(properties)
    .where(and(sql`upper(${properties.propertyNo}) = ${no.trim().toUpperCase()}`, isNull(properties.voidedAt))))[0]
  if (!p) throw new AppError('PROPERTY_NOT_FOUND', 404, `Property ${no} not found`, { propertyNo: no })
  return p
}

export async function cardForProperty(propertyId: string, mode?: 'merged' | 'split') {
  const movements = (await db.select().from(vCardMovements).where(eq(vCardMovements.propertyId, propertyId))
    .orderBy(asc(vCardMovements.date), asc(vCardMovements.movementId))) as unknown as CardMovement[]
  return mergeCardRows(movements, mode ?? (await getSettings()).cardRowMode)
}

export async function card(propertyNo: string) {
  const p = await findPropertyByNo(propertyNo)
  const rows = await cardForProperty(p.id)
  const first = (await db.select({ category: vCardMovements.category }).from(vCardMovements).where(eq(vCardMovements.propertyId, p.id)).limit(1))[0]
  return { property: { propertyNo: p.propertyNo, category: first?.category ?? null }, rows }
}

export async function countRows(countId: string) {
  const rows = await db.select().from(vCountRows).where(eq(vCountRows.countId, countId)).orderBy(asc(vCountRows.propertyNo))
  const ids = rows.map((r) => r.propertyId!)
  const old = new Map(
    (ids.length ? await db.select({ id: properties.id, no: properties.oldPropertyNo }).from(properties).where(inArray(properties.id, ids)) : [])
      .map((p) => [p.id, p.no]),
  )
  return rows.map((v) => ({
    id: v.propertyNo!, // the property number: the row a QR scan highlights
    article: v.article!,
    description: v.description!,
    propertyNo: v.propertyNo!,
    unit: v.unit!,
    unitValueCentavos: v.unitValueCentavos!,
    balancePerCard: v.balancePerCard!,
    qtyOnHand: v.qtyOnHand,
    shortageOverageQty: v.shortageOverageQty,
    shortageOverageValueCentavos: v.shortageOverageValueCentavos,
    // legacy number is printed in Remarks automatically (decision 2026-11-14)
    remarks: [v.remarks, old.get(v.propertyId!) ? `Old P#: ${old.get(v.propertyId!)}` : null].filter(Boolean).join('\n') || null,
  }))
}
