import { unitCode, unitInput, unitPatch } from '@traces/shared'
import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { createUnit, listUnits, updateUnit } from '../services/units.js'
import { ctx } from './ctx.js'

export function unitsRouter() {
  const r = Router()
  r.use('/units', requireRole('supply_admin', 'superadmin'))
  const itOfficer = requireRole('superadmin') // the IT officer keeps this list; supply admins only read it
  r.get('/units', async (_req, res) => res.json(await listUnits()))
  r.post('/units', ...itOfficer, validate(unitInput), async (req, res) => res.status(201).json(await createUnit(req.body, ctx(req))))
  r.patch('/units/:code', ...itOfficer, validate(unitPatch), async (req, res) => res.json(await updateUnit(unitCode.parse(req.params.code), req.body, ctx(req))))
  return r
}
