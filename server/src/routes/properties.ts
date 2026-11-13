import { propertyPatch } from '@traces/shared'
import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { dashboard } from '../services/dashboard.js'
import { getProperty, patchProperty } from '../services/properties.js'
import { ctx } from './ctx.js'

export function propertiesRouter() {
  const r = Router()
  r.use('/properties', requireRole('supply_admin', 'superadmin'))
  r.use('/dashboard', requireRole('supply_admin', 'superadmin'))

  r.get('/dashboard', async (_req, res) => res.json(await dashboard()))
  r.get('/properties/:no', async (req, res) => res.json(await getProperty(req.params.no)))
  r.patch('/properties/:no', validate(propertyPatch), async (req, res) => res.json(await patchProperty(String(req.params.no), req.body, ctx(req))))
  return r
}
