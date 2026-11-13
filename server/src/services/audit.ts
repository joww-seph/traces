import type { db } from '../db/client.js'
import { auditLogs } from '../db/schema.js'

export type Ctx = { actorId: string | null; ip: string | null }
// Accepts the db or a transaction, so the audit row lands in the caller's transaction.
type Executor = Pick<typeof db, 'insert'>

export async function audit(
  tx: Executor, ctx: Ctx, action: string, entity: string, entityId: string, before: unknown = null, after: unknown = null,
) {
  await tx.insert(auditLogs).values({ actorId: ctx.actorId, action, entity, entityId, before, after, ip: ctx.ip })
}
