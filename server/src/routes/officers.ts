import { officerInput, officerPatch, uuid } from '@traces/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { createOfficer, deactivateOfficer, listOfficers, updateOfficer } from '../services/officers.js'
import { ctx } from './ctx.js'

const bool = z.enum(['true', 'false']).transform((v) => v === 'true').optional()
const query = z.object({ active: bool, canReceive: bool, q: z.string().trim().optional() })

export function officersRouter() {
  const r = Router()
  r.use('/officers', requireRole('supply_admin', 'superadmin'))

  r.get('/officers', async (req, res) => res.json(await listOfficers(query.parse(req.query))))
  r.post('/officers', validate(officerInput), async (req, res) => res.status(201).json(await createOfficer(req.body, ctx(req))))
  r.patch('/officers/:id', validate(officerPatch), async (req, res) =>
    res.json(await updateOfficer(uuid.parse(req.params.id), req.body, ctx(req))))
  r.delete('/officers/:id', async (req, res) => res.json(await deactivateOfficer(uuid.parse(req.params.id), ctx(req))))
  return r
}
