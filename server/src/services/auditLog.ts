import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { auditLogs, users } from '../db/schema.js'

const PAGE = 50

export type AuditFilter = { entity?: string; actorId?: string; from?: string; to?: string; before?: number }

// Keyset pagination: the next page is "ids below the last one shown", stable while new rows arrive.
export async function listAudit(f: AuditFilter) {
  const rows = await db.select({
    id: auditLogs.id, at: auditLogs.at, action: auditLogs.action, entity: auditLogs.entity, entityId: auditLogs.entityId,
    before: auditLogs.before, after: auditLogs.after, ip: auditLogs.ip,
    actorId: users.id, actorEmail: users.email, actorName: users.displayName,
  }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(
      f.entity ? eq(auditLogs.entity, f.entity) : undefined,
      f.actorId ? eq(auditLogs.actorId, f.actorId) : undefined,
      f.from ? sql`${auditLogs.at} >= ${f.from}::date` : undefined,
      f.to ? sql`${auditLogs.at} < (${f.to}::date + 1)` : undefined,
      f.before ? lt(auditLogs.id, f.before) : undefined,
    ))
    .orderBy(desc(auditLogs.id)).limit(PAGE + 1)
  const page = rows.slice(0, PAGE)
  return {
    rows: page.map(({ actorId, actorEmail, actorName, ...r }) => ({ ...r, actor: actorId ? { id: actorId, email: actorEmail, displayName: actorName } : null })),
    nextBefore: rows.length > PAGE ? page[PAGE - 1].id : null,
  }
}
