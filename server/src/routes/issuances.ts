import { issuanceInput } from '@traces/shared'
import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { createIssuance } from '../services/issuances.js'
import { ctx } from './ctx.js'

// The one way to enter data: card -> registry -> report -> ICS/PAR, saved together.
export function issuancesRouter() {
  const r = Router()
  r.use('/issuances', requireRole('supply_admin', 'superadmin'))
  r.post('/issuances', validate(issuanceInput), async (req, res) => res.status(201).json(await createIssuance(req.body, ctx(req))))
  return r
}
