import type { itemCreate, itemPatch, itemQuery } from '@traces/shared'
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { items, propertyTypes } from '../db/schema.js'
import { AppError } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type NewItem = z.infer<typeof itemCreate>

const withType = () => db.select({
  id: items.id, propertyTypeId: items.propertyTypeId, propertyTypeCode: propertyTypes.code, category: items.category,
  article: items.article, description: items.description, unit: items.unit, active: items.active,
}).from(items).innerJoin(propertyTypes, eq(propertyTypes.id, items.propertyTypeId))

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export function listItems(q: z.infer<typeof itemQuery>) {
  const term = q.q ? `%${likeEscape(q.q)}%` : null
  return withType().where(and(
    q.category ? eq(items.category, q.category) : undefined,
    q.typeId ? eq(items.propertyTypeId, q.typeId) : undefined,
    q.active ? eq(items.active, q.active === 'true') : undefined,
    term ? or(ilike(items.article, term), ilike(items.description, term)) : undefined,
  )).orderBy(asc(items.article), asc(items.description)).limit(50)
}

export const getItem = async (id: string) => {
  const item = (await withType().where(eq(items.id, id)))[0]
  if (!item) throw new AppError('ITEM_NOT_FOUND', 404, 'Card not found')
  return item
}

// Inserts a card, or throws 409 ITEM_EXISTS naming the one that already has this identity.
// Used by POST /api/items and by line saves that create a card inline.
export async function insertItem(tx: Tx, values: NewItem) {
  const [row] = await tx.insert(items).values(values).onConflictDoNothing().returning()
  if (row) return row
  const existing = (await tx.select({ id: items.id }).from(items).where(and(
    eq(items.category, values.category), eq(items.propertyTypeId, values.propertyTypeId),
    sql`lower(${items.article}) = lower(${values.article})`, sql`lower(${items.description}) = lower(${values.description})`,
  )))[0]
  throw new AppError('ITEM_EXISTS', 409, 'A card for this model already exists', { itemId: existing?.id })
}

export async function createItem(input: NewItem, ctx: Ctx) {
  const id = await db.transaction(async (tx) => {
    const row = await insertItem(tx, input)
    await audit(tx, ctx, 'item.create', 'items', row.id, null, row)
    return row.id
  })
  return getItem(id)
}

export async function updateItem(id: string, patch: z.infer<typeof itemPatch>, ctx: Ctx) {
  await db.transaction(async (tx) => {
    const before = (await tx.select().from(items).where(eq(items.id, id)).for('update'))[0]
    if (!before) throw new AppError('ITEM_NOT_FOUND', 404, 'Card not found')
    const [after] = Object.keys(patch).length ? await tx.update(items).set(patch).where(eq(items.id, id)).returning() : [before]
    await audit(tx, ctx, 'item.update', 'items', id, before, after)
  })
  return getItem(id)
}
