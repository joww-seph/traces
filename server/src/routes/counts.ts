import { category, countScanInput, countStartInput, uuid } from '@traces/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { closeCount, getCount, listCounts, recordScan, removeScan, startCount } from '../services/counts.js'
import { ctx } from './ctx.js'

export function countsRouter() {
  const r = Router()
  r.use('/counts', requireRole('supply_admin'))

  r.get('/counts', async (req, res) => {
    const q = z.object({ officerId: uuid.optional(), category: category.optional(), open: z.enum(['true', 'false']).optional() }).parse(req.query)
    const rows = await listCounts({ officerId: q.officerId, open: q.open === 'true' })
    res.json(q.category ? rows.filter((c) => c.category === q.category) : rows)
  })
  r.post('/counts', validate(countStartInput), async (req, res) => {
    const { created, count } = await startCount(req.body, ctx(req))
    res.status(created ? 201 : 200).json(count)
  })
  r.get('/counts/:id', async (req, res) => res.json(await getCount(uuid.parse(req.params.id))))
  r.post('/counts/:id/close', async (req, res) => res.json(await closeCount(uuid.parse(req.params.id), ctx(req))))
  r.post('/counts/:id/scans', validate(countScanInput), async (req, res) => res.json(await recordScan(uuid.parse(req.params.id), req.body, ctx(req))))
  r.delete('/counts/:id/scans/:propertyId', async (req, res) =>
    res.json(await removeScan(uuid.parse(req.params.id), uuid.parse(req.params.propertyId), ctx(req))))
  return r
}
