import type { officerInput, officerPatch } from '@traces/shared'
import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { officers } from '../db/schema.js'
import { AppError } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'

export const listOfficers = (active?: boolean) =>
  db.select().from(officers).where(active === undefined ? undefined : eq(officers.active, active)).orderBy(asc(officers.shortName))

export async function createOfficer(input: z.infer<typeof officerInput>, ctx: Ctx) {
  return db.transaction(async (tx) => {
    const [o] = await tx.insert(officers).values(input).returning()
    await audit(tx, ctx, 'officer.create', 'officers', o.id, null, o)
    return o
  })
}

async function change(id: string, set: z.infer<typeof officerPatch>, action: string, ctx: Ctx) {
  return db.transaction(async (tx) => {
    const before = (await tx.select().from(officers).where(eq(officers.id, id)).for('update'))[0]
    if (!before) throw new AppError('OFFICER_NOT_FOUND', 404, 'Officer not found')
    const [after] = await tx.update(officers).set(set).where(eq(officers.id, id)).returning()
    await audit(tx, ctx, action, 'officers', id, before, after)
    return after
  })
}

export const updateOfficer = (id: string, patch: z.infer<typeof officerPatch>, ctx: Ctx) => change(id, patch, 'officer.update', ctx)
// DELETE never removes the row: documents reference officers.
export const deactivateOfficer = (id: string, ctx: Ctx) => change(id, { active: false }, 'officer.deactivate', ctx)
