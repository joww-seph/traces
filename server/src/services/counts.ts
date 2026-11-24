import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { countScans, officers, physicalCounts, properties, qrTokens } from '../db/schema.js'
import { officerReport, vActiveProperties, vCustody } from '../db/views.js'
import { AppError } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'

type Category = 'semi' | 'ppe'
type Condition = 'serviceable' | 'unserviceable'
type Tx = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

const getRow = async (d: Pick<typeof db, 'select'>, id: string) => {
  const c = (await d.select({
    id: physicalCounts.id, officerId: physicalCounts.officerId, officerName: officers.fullName, category: physicalCounts.category,
    asAt: physicalCounts.asAt, closedAt: physicalCounts.closedAt,
  }).from(physicalCounts).innerJoin(officers, eq(officers.id, physicalCounts.officerId)).where(eq(physicalCounts.id, id)))[0]
  if (!c) throw new AppError('COUNT_NOT_FOUND', 404, 'Count not found')
  return c
}

async function progress(d: Tx, c: Awaited<ReturnType<typeof getRow>>) {
  const total = (await officerReport(c.asAt, d))
    .filter((r) => r.officerId === c.officerId && r.category === c.category)
    .reduce((n, r) => n + r.balancePerCard, 0)
  const scanned = await d.select({ condition: properties.condition }).from(countScans)
    .innerJoin(properties, eq(properties.id, countScans.propertyId)).where(eq(countScans.countId, c.id))
  return {
    ...c, closedAt: c.closedAt ? c.closedAt.toISOString() : null,
    total, counted: scanned.length, unserviceable: scanned.filter((s) => s.condition === 'unserviceable').length,
  }
}

export async function getCount(id: string) {
  return progress(db, await getRow(db, id))
}

export async function listCounts(f: { officerId?: string; open?: boolean } = {}) {
  const ids = (await db.select({ id: physicalCounts.id }).from(physicalCounts)
    .where(and(f.officerId ? eq(physicalCounts.officerId, f.officerId) : undefined, f.open ? isNull(physicalCounts.closedAt) : undefined))
    .orderBy(desc(physicalCounts.asAt), desc(physicalCounts.createdAt))).map((r) => r.id)
  return Promise.all(ids.map(getCount))
}

export async function startCount(input: { officerId: string; category: Category; asAt: string }, ctx: Ctx) {
  return db.transaction(async (tx) => {
    if (!(await tx.select({ id: officers.id }).from(officers).where(eq(officers.id, input.officerId)))[0]) {
      throw new AppError('OFFICER_NOT_FOUND', 404, 'Officer not found')
    }
    const made = (await tx.insert(physicalCounts).values({ ...input, createdBy: ctx.actorId }).onConflictDoNothing().returning({ id: physicalCounts.id }))[0]
    if (made) await audit(tx, ctx, 'count.start', 'physical_counts', made.id, null, input)
    const id = made?.id ?? (await tx.select({ id: physicalCounts.id }).from(physicalCounts)
      .where(and(eq(physicalCounts.officerId, input.officerId), eq(physicalCounts.category, input.category), eq(physicalCounts.asAt, input.asAt))))[0].id
    return { created: !!made, count: await progress(tx, await getRow(tx, id)) }
  })
}

export async function closeCount(id: string, ctx: Ctx) {
  return db.transaction(async (tx) => {
    const c = (await tx.select().from(physicalCounts).where(eq(physicalCounts.id, id)).for('update'))[0]
    if (!c) throw new AppError('COUNT_NOT_FOUND', 404, 'Count not found')
    if (!c.closedAt) {
      await tx.update(physicalCounts).set({ closedAt: sql`now()` }).where(eq(physicalCounts.id, id))
      await audit(tx, ctx, 'count.close', 'physical_counts', id)
    }
    return progress(tx, await getRow(tx, id))
  })
}

async function lockOpen(tx: Tx, id: string) {
  const c = (await tx.select().from(physicalCounts).where(eq(physicalCounts.id, id)).for('update'))[0]
  if (!c) throw new AppError('COUNT_NOT_FOUND', 404, 'Count not found')
  if (c.closedAt) throw new AppError('COUNT_CLOSED', 409, 'This count is closed; it takes no more scans.')
  return getRow(tx, id)
}

export async function recordScan(countId: string, input: { token: string; condition: Condition }, ctx: Ctx) {
  return db.transaction(async (tx) => {
    const count = await lockOpen(tx, countId)

    const t = (await tx.select().from(qrTokens).where(eq(qrTokens.token, input.token)))[0]
    if (!t) throw new AppError('NOT_FOUND', 404, 'This QR code is not in TRACES.')
    if (t.revokedAt) throw new AppError('QR_REPLACED', 410, 'This QR code was replaced. Scan the newer sticker on the item.')
    const p = (await tx.select().from(vActiveProperties).where(eq(vActiveProperties.propertyId, t.propertyId)))[0]
    if (!p) throw new AppError('ITEM_REMOVED', 410, 'This item was removed from the records.')

    if (p.componentLabel) {
      const main = (await tx.select({ propertyNo: properties.propertyNo }).from(properties)
        .where(and(eq(properties.lineId, p.lineId!), isNull(properties.componentLabel), isNull(properties.voidedAt))))[0]
      throw new AppError('COUNT_COMPONENT', 409, `${p.propertyNo} is a part of ${main?.propertyNo ?? 'a unit'}. Scan the main unit.`, { mainPropertyNo: main?.propertyNo ?? null })
    }
    if (p.category !== count.category) {
      throw new AppError('WRONG_CATEGORY', 409, `${p.propertyNo} is ${p.category === 'ppe' ? 'PPE' : 'semi-expendable'}; this count is for ${count.category === 'ppe' ? 'PPE' : 'semi-expendable'} property.`)
    }
    const holder = (await tx.select({ id: vCustody.holderOfficerId, name: officers.fullName }).from(vCustody)
      .leftJoin(officers, eq(officers.id, vCustody.holderOfficerId)).where(eq(vCustody.propertyId, p.propertyId!)))[0]
    if (holder?.id !== count.officerId) {
      throw new AppError('NOT_HOLDER', 409, `${p.propertyNo} is not held by ${count.officerName}.`, { holder: holder?.name ?? null })
    }

    const parts = await tx.select({ id: properties.id }).from(properties)
      .where(and(eq(properties.lineId, p.lineId!), isNotNull(properties.componentLabel), isNull(properties.voidedAt)))
    for (const id of [p.propertyId!, ...parts.map((x) => x.id)]) {
      await tx.update(properties).set({ condition: input.condition }).where(eq(properties.id, id))
    }
    await tx.insert(countScans).values({ countId, propertyId: p.propertyId!, scannedBy: ctx.actorId })
      .onConflictDoUpdate({ target: [countScans.countId, countScans.propertyId], set: { scannedBy: ctx.actorId, scannedAt: sql`now()` } })
    await audit(tx, ctx, 'count.scan', 'physical_counts', countId, { condition: p.condition }, { propertyNo: p.propertyNo, condition: input.condition })

    return { ...(await progress(tx, count)), propertyNo: p.propertyNo!, article: p.article!, condition: input.condition }
  })
}

export async function removeScan(countId: string, propertyId: string, ctx: Ctx) {
  return db.transaction(async (tx) => {
    const count = await lockOpen(tx, countId)
    const gone = await tx.delete(countScans).where(and(eq(countScans.countId, countId), eq(countScans.propertyId, propertyId))).returning({ id: countScans.propertyId })
    if (!gone.length) throw new AppError('SCAN_NOT_FOUND', 404, 'This item is not counted in this count.')
    await audit(tx, ctx, 'count.unscan', 'physical_counts', countId, { propertyId }, null)
    return progress(tx, count)
  })
}
