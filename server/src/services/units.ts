import type { unitInput, unitPatch } from '@traces/shared'
import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { units } from '../db/schema.js'
import { AppError } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'

export const listUnits = () => db.select().from(units).orderBy(asc(units.code))

export async function createUnit(input: z.infer<typeof unitInput>, ctx: Ctx) {
  return db.transaction(async (tx) => {
    const [u] = await tx.insert(units).values(input).returning()
    await audit(tx, ctx, 'unit.create', 'units', u.code, null, u)
    return u
  })
}

export async function updateUnit(code: string, patch: z.infer<typeof unitPatch>, ctx: Ctx) {
  return db.transaction(async (tx) => {
    const before = (await tx.select().from(units).where(eq(units.code, code)).for('update'))[0]
    if (!before) throw new AppError('UNIT_NOT_FOUND', 404, 'Unit not found')
    const [after] = Object.keys(patch).length ? await tx.update(units).set(patch).where(eq(units.code, code)).returning() : [before]
    await audit(tx, ctx, 'unit.update', 'units', code, before, after)
    return after
  })
}
