import type { propertyPatch } from '@traces/shared'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { properties, qrTokens } from '../db/schema.js'
import { AppError } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'

// Property numbers match case-insensitively (same rule as the unique index).
const byNo = (no: string) => and(sql`upper(${properties.propertyNo}) = ${no.trim().toUpperCase()}`, isNull(properties.voidedAt))
const notFound = (no: string) => new AppError('PROPERTY_NOT_FOUND', 404, `Property ${no} not found`, { propertyNo: no })

export async function getProperty(no: string) {
  const p = (await db.select().from(properties).where(byNo(no)))[0]
  if (!p) throw notFound(no)
  const token = (await db.select({ token: qrTokens.token }).from(qrTokens)
    .where(and(eq(qrTokens.propertyId, p.id), isNull(qrTokens.revokedAt))))[0]?.token ?? null
  return { ...p, token }
}

export async function patchProperty(no: string, patch: z.infer<typeof propertyPatch>, ctx: Ctx) {
  return db.transaction(async (tx) => {
    const before = (await tx.select().from(properties).where(byNo(no)).for('update'))[0]
    if (!before) throw notFound(no)
    if (!Object.keys(patch).length) return before
    const [after] = await tx.update(properties).set(patch).where(eq(properties.id, before.id)).returning()
    await audit(tx, ctx, 'property.update', 'properties', before.id, before, after)
    return after
  })
}
