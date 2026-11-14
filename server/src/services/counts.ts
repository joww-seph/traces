import type { countInput, countPatch } from '@traces/shared'
import { and, count, desc, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { countItems, countSignatories, officers, physicalCounts, properties } from '../db/schema.js'
import { AppError, pgErrorOf } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'
import { countRows } from './views.js'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Signatory = z.infer<typeof countInput>['signatories'][number]

const closedError = () => new AppError('COUNT_CLOSED', 409, 'This count is closed and can no longer be changed')
const notFound = () => new AppError('COUNT_NOT_FOUND', 404, 'Count not found')

// BR-10: one row per property the officer holds now (active, balance > 0) in the count's category.
// ON CONFLICT DO NOTHING keeps quantities already entered when this runs again (refresh).
async function addHoldings(tx: Tx, countId: string, officerId: string, category: 'semi' | 'ppe') {
  const res = await tx.execute(sql`
    INSERT INTO count_items (count_id, property_id)
    SELECT ${countId}, property_id FROM v_holdings
    WHERE holder_officer_id = ${officerId} AND category = ${category}
    ON CONFLICT DO NOTHING
    RETURNING property_id`)
  return res.rows.length
}

// Numbered per role in the order given, so two committee members never clash on the primary key.
async function writeSignatories(tx: Tx, countId: string, list: Signatory[]) {
  await tx.delete(countSignatories).where(eq(countSignatories.countId, countId))
  const seen: Record<string, number> = {}
  const rows = list.map((s) => ({ countId, role: s.role, sortOrder: (seen[s.role] = (seen[s.role] ?? 0) + 1), name: s.name, position: s.position ?? null }))
  if (rows.length) await tx.insert(countSignatories).values(rows)
}

export async function createCount(input: z.infer<typeof countInput>, userId: string, ctx: Ctx) {
  try {
    return await db.transaction(async (tx) => {
      const officer = (await tx.select().from(officers).where(eq(officers.id, input.officerId)))[0]
      if (!officer) throw new AppError('OFFICER_NOT_FOUND', 400, 'Officer not found')
      const { signatories, ...header } = input
      const [c] = await tx.insert(physicalCounts).values({
        ...header, officerPosition: input.officerPosition ?? officer.position, createdBy: userId,
      }).returning()
      await writeSignatories(tx, c.id, signatories)
      const added = await addHoldings(tx, c.id, c.officerId, c.category)
      await audit(tx, ctx, 'count.create', 'physical_counts', c.id, null, { ...header, items: added })
      return { id: c.id, added }
    })
  } catch (e) {
    if (pgErrorOf(e)?.constraint === 'physical_counts_unique_session') {
      throw new AppError('DUPLICATE_COUNT', 409, 'A count for this officer, category and date already exists')
    }
    throw e
  }
}

async function progress(countId: string) {
  const [r] = await db.select({ total: count(), counted: sql<number>`count(${countItems.qtyOnHand})`.mapWith(Number) })
    .from(countItems).where(eq(countItems.countId, countId))
  return { total: r.total, counted: r.counted }
}

export async function getCount(id: string) {
  const c = (await db.select({ c: physicalCounts, officerFull: officers.fullName, officerShort: officers.shortName })
    .from(physicalCounts).innerJoin(officers, eq(officers.id, physicalCounts.officerId)).where(eq(physicalCounts.id, id)))[0]
  if (!c) throw notFound()
  const sigs = await db.select().from(countSignatories).where(eq(countSignatories.countId, id))
  return {
    id: c.c.id, category: c.c.category, typeLabel: c.c.typeLabel, asAt: c.c.asAt, fundCluster: c.c.fundCluster,
    officerId: c.c.officerId, officerName: c.officerFull, officerShortName: c.officerShort, officerPosition: c.c.officerPosition,
    assumptionDate: c.c.assumptionDate, status: c.c.status, createdAt: c.c.createdAt, closedAt: c.c.closedAt,
    signatories: sigs.sort((a, b) => a.role.localeCompare(b.role) || a.sortOrder - b.sortOrder)
      .map((s) => ({ role: s.role, sortOrder: s.sortOrder, name: s.name, position: s.position })),
    progress: await progress(id),
    rows: await countRows(id),
  }
}

export async function listCounts() {
  const rows = await db.select({
    id: physicalCounts.id, category: physicalCounts.category, typeLabel: physicalCounts.typeLabel, asAt: physicalCounts.asAt,
    status: physicalCounts.status, officerShortName: officers.shortName, officerName: officers.fullName,
    total: sql<number>`(SELECT count(*) FROM count_items ci WHERE ci.count_id = ${physicalCounts.id})`.mapWith(Number),
    counted: sql<number>`(SELECT count(ci.qty_on_hand) FROM count_items ci WHERE ci.count_id = ${physicalCounts.id})`.mapWith(Number),
  }).from(physicalCounts).innerJoin(officers, eq(officers.id, physicalCounts.officerId))
    .orderBy(desc(physicalCounts.asAt), desc(physicalCounts.createdAt))
  return rows.map(({ total, counted, ...r }) => ({ ...r, progress: { total, counted } }))
}

async function lockOpen(tx: Tx, id: string) {
  const c = (await tx.select().from(physicalCounts).where(eq(physicalCounts.id, id)).for('update'))[0]
  if (!c) throw notFound()
  if (c.status === 'closed') throw closedError()
  return c
}

export async function patchCount(id: string, patch: z.infer<typeof countPatch>, ctx: Ctx) {
  try {
    await db.transaction(async (tx) => {
      const before = await lockOpen(tx, id) // a closed count is final: any edit, or a re-open, is refused
      const { signatories, status, ...fields } = patch
      const set: Partial<typeof physicalCounts.$inferInsert> = { ...fields }
      if (status === 'closed') { set.status = 'closed'; set.closedAt = new Date() }
      if (Object.keys(set).length) await tx.update(physicalCounts).set(set).where(eq(physicalCounts.id, id))
      if (signatories) await writeSignatories(tx, id, signatories)
      await audit(tx, ctx, status === 'closed' ? 'count.close' : 'count.update', 'physical_counts', id, before, patch)
    })
  } catch (e) {
    if (pgErrorOf(e)?.constraint === 'physical_counts_unique_session') {
      throw new AppError('DUPLICATE_COUNT', 409, 'A count for this officer, category and date already exists')
    }
    throw e
  }
  return getCount(id)
}

export async function refreshCount(id: string, ctx: Ctx) {
  return db.transaction(async (tx) => {
    const c = await lockOpen(tx, id)
    const added = await addHoldings(tx, id, c.officerId, c.category)
    await audit(tx, ctx, 'count.refresh', 'physical_counts', id, null, { added })
    return { added }
  })
}

export async function patchItem(id: string, propertyNo: string, patch: { qtyOnHand?: number | null; remarks?: string | null }, ctx: Ctx) {
  await db.transaction(async (tx) => {
    await lockOpen(tx, id)
    const item = (await tx.select({ propertyId: countItems.propertyId, before: countItems.qtyOnHand })
      .from(countItems).innerJoin(properties, eq(properties.id, countItems.propertyId))
      .where(and(eq(countItems.countId, id), sql`upper(${properties.propertyNo}) = ${propertyNo.trim().toUpperCase()}`)))[0]
    if (!item) throw new AppError('COUNT_ITEM_NOT_FOUND', 404, `Property ${propertyNo} is not in this count`)
    const set: { qtyOnHand?: number | null; remarks?: string | null } = {}
    if (patch.qtyOnHand !== undefined) set.qtyOnHand = patch.qtyOnHand
    if (patch.remarks !== undefined) set.remarks = patch.remarks
    if (!Object.keys(set).length) return
    await tx.update(countItems).set(set).where(and(eq(countItems.countId, id), eq(countItems.propertyId, item.propertyId)))
    await audit(tx, ctx, 'count.item', 'physical_counts', id, { propertyNo, qtyOnHand: item.before }, { propertyNo, ...set })
  })
  return { ok: true }
}

