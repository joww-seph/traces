import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { documents, lines, properties, qrTokens } from '../db/schema.js'
import { AppError } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'
import { withTokenRetry } from './lines.js'
import { newToken } from './qr.js'
import { getSettings } from './settings.js'
import { findPropertyByNo } from './views.js'

// BR-11: revoke the old token and insert a new one in one transaction; the partial unique index
// guarantees only one stays active.
export async function rotateToken(propertyNo: string, ctx: Ctx) {
  const p = await findPropertyByNo(propertyNo)
  return withTokenRetry(() => db.transaction(async (tx) => {
    const old = (await tx.update(qrTokens).set({ revokedAt: new Date() })
      .where(and(eq(qrTokens.propertyId, p.id), isNull(qrTokens.revokedAt))).returning({ token: qrTokens.token }))[0]
    const token = newToken()
    await tx.insert(qrTokens).values({ token, propertyId: p.id })
    await audit(tx, ctx, 'qr.rotate', 'properties', p.id, { token: old?.token.trim() ?? null }, { token })
    return { token }
  }))
}

// The QR content is `${public_base_url}/q/${token}`; the image itself is drawn in the browser at print time.
export async function stickers(by: { documentId?: string; nos?: string[] }) {
  const base = (await getSettings()).publicBaseUrl.replace(/\/+$/, '')
  const where = by.documentId
    ? and(eq(lines.documentId, by.documentId))
    : inArray(sql`upper(${properties.propertyNo})`, (by.nos ?? []).map((n) => n.trim().toUpperCase()).filter(Boolean))
  const rows = await db.select({ propertyNo: properties.propertyNo, token: qrTokens.token })
    .from(properties)
    .innerJoin(lines, and(eq(lines.id, properties.lineId), isNull(lines.deletedAt)))
    .innerJoin(documents, and(eq(documents.id, lines.documentId), isNull(documents.deletedAt)))
    .innerJoin(qrTokens, and(eq(qrTokens.propertyId, properties.id), isNull(qrTokens.revokedAt)))
    .where(and(where, isNull(properties.voidedAt)))
    .orderBy(asc(documents.issuedDate), asc(lines.lineNo), asc(properties.propertyNo))
  if (by.nos && !rows.length && by.nos.length) throw new AppError('NOT_FOUND', 404, 'No matching property numbers')
  return rows.map((r) => ({ propertyNo: r.propertyNo, url: `${base}/q/${r.token.trim()}` }))
}
