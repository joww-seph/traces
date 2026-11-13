import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { settingsPatch } from '@traces/shared'
import { db } from '../db/client.js'
import { settings } from '../db/schema.js'
import { AppError } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'

type Settings = typeof settings.$inferSelect
type Reader = Pick<typeof db, 'select'>

// shortcut: in-process cache, fine for the single Node process; use pg LISTEN/NOTIFY if the API is ever scaled out.
let cache: { at: number; row: Settings } | null = null
const TTL_MS = 30_000
export const clearSettingsCache = () => { cache = null }

// Pass a transaction to read inside it (uncached); omit for the cached read.
export async function getSettings(tx?: Reader): Promise<Settings> {
  if (!tx && cache && Date.now() - cache.at < TTL_MS) return cache.row
  const row = (await (tx ?? db).select().from(settings).where(eq(settings.id, 1)))[0]
  if (!row) throw new AppError('SETTINGS_MISSING', 500, 'Settings row missing; run seed:superadmin')
  if (!tx) cache = { at: Date.now(), row }
  return row
}

export async function updateSettings(patch: z.infer<typeof settingsPatch>, ctx: Ctx) {
  const row = await db.transaction(async (tx) => {
    const before = await getSettings(tx)
    const [after] = await tx.update(settings)
      .set({ ...patch, updatedAt: new Date(), updatedBy: ctx.actorId })
      .where(eq(settings.id, 1)).returning()
    await audit(tx, ctx, 'settings.update', 'settings', '1', before, after)
    return after
  })
  clearSettingsCache()
  return row
}
