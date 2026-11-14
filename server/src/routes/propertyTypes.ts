import { propertyTypeInput, propertyTypePatch } from '@traces/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { createPropertyType, listPropertyTypes, updatePropertyType } from '../services/propertyTypes.js'
import { ctx } from './ctx.js'

export function propertyTypesRouter() {
  const r = Router()
  r.use('/property-types', requireRole('supply_admin', 'superadmin'))
  r.get('/property-types', async (_req, res) => res.json(await listPropertyTypes()))
  r.post('/property-types', validate(propertyTypeInput), async (req, res) => res.status(201).json(await createPropertyType(req.body, ctx(req))))
  r.patch('/property-types/:id', validate(propertyTypePatch), async (req, res) =>
    res.json(await updatePropertyType(z.coerce.number().int().positive().parse(req.params.id), req.body, ctx(req))))
  return r
}
