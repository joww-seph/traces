import { countInput, countItemPatch, countPatch, uuid } from '@traces/shared'
import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { createCount, getCount, listCounts, patchCount, patchItem, refreshCount } from '../services/counts.js'
import { ctx } from './ctx.js'

export function countsRouter() {
  const r = Router()
  r.use('/counts', requireRole('supply_admin', 'superadmin'))

  r.get('/counts', async (_req, res) => res.json(await listCounts()))
  r.post('/counts', validate(countInput), async (req, res) => res.status(201).json(await createCount(req.body, req.user!.id, ctx(req))))
  r.get('/counts/:id', async (req, res) => res.json(await getCount(uuid.parse(req.params.id))))
  r.patch('/counts/:id', validate(countPatch), async (req, res) => res.json(await patchCount(uuid.parse(req.params.id), req.body, ctx(req))))
  r.post('/counts/:id/refresh', async (req, res) => res.json(await refreshCount(uuid.parse(req.params.id), ctx(req))))
  r.patch('/counts/:id/items/:no', validate(countItemPatch), async (req, res) =>
    res.json(await patchItem(uuid.parse(req.params.id), String(req.params.no), req.body, ctx(req))))
  return r
}
