import { isoDate, uuid } from '@traces/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requireRole } from '../../middleware/auth.js'
import { listAudit } from '../../services/auditLog.js'

const query = z.object({
  entity: z.string().trim().min(1).optional(), actorId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional(),
  before: z.coerce.number().int().positive().optional(),
})

export function adminAuditRouter() {
  const r = Router()
  r.use('/admin/audit-logs', requireRole('superadmin'))
  r.get('/admin/audit-logs', async (req, res) => res.json(await listAudit(query.parse(req.query))))
  return r
}
