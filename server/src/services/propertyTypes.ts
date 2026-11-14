import type { propertyTypeInput, propertyTypePatch } from '@traces/shared'
import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { propertyTypes } from '../db/schema.js'
import { AppError } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'

export const listPropertyTypes = () => db.select().from(propertyTypes).orderBy(asc(propertyTypes.code))

export async function createPropertyType(input: z.infer<typeof propertyTypeInput>, ctx: Ctx) {
  return db.transaction(async (tx) => {
    const [t] = await tx.insert(propertyTypes).values(input).returning()
    await audit(tx, ctx, 'property_type.create', 'property_types', String(t.id), null, t)
    return t
  })
}

export async function updatePropertyType(id: number, patch: z.infer<typeof propertyTypePatch>, ctx: Ctx) {
  return db.transaction(async (tx) => {
    const before = (await tx.select().from(propertyTypes).where(eq(propertyTypes.id, id)).for('update'))[0]
    if (!before) throw new AppError('PROPERTY_TYPE_NOT_FOUND', 404, 'Property type not found')
    const [after] = Object.keys(patch).length
      ? await tx.update(propertyTypes).set(patch).where(eq(propertyTypes.id, id)).returning()
      : [before]
    await audit(tx, ctx, 'property_type.update', 'property_types', String(id), before, after)
    return after
  })
}
