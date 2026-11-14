import { isoDate } from '@traces/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requireRole } from '../middleware/auth.js'
import { card, registry } from '../services/views.js'

const registryQuery = z.object({ category: z.enum(['semi', 'ppe']), from: isoDate.optional(), to: isoDate.optional() })

export function viewsRouter() {
  const r = Router()
  r.use('/views', requireRole('supply_admin', 'superadmin'))
  r.get('/views/registry', async (req, res) => {
    const q = registryQuery.parse(req.query)
    res.json(await registry(q.category, q.from, q.to))
  })
  r.get('/views/card/:no', async (req, res) => res.json(await card(String(req.params.no))))
  return r
}
