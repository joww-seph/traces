import { isoDate, unitCode } from '@traces/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requireRole } from '../middleware/auth.js'
import { suggestDocumentNumbers } from '../services/documentNumbers.js'
import { suggestPropertyNumbers } from '../services/propertyNumbers.js'

const query = z.object({
  typeId: z.coerce.number().int().positive(),
  dateAcquired: isoDate,
  count: z.coerce.number().int().min(1).max(300).default(1),
})

export function propertyNumbersRouter() {
  const r = Router()
  r.use('/property-numbers', requireRole('supply_admin'))
  r.get('/property-numbers/next', async (req, res) => {
    const q = query.parse(req.query)
    res.json({ suggestions: await suggestPropertyNumbers(q.typeId, q.dateAcquired, q.count) })
  })
  r.use('/document-numbers', requireRole('supply_admin'))
  r.get('/document-numbers/next', async (req, res) => {
    const q = z.object({ issuedDate: isoDate, unit: unitCode, parCount: z.coerce.number().int().min(0).max(1000).default(1) }).parse(req.query)
    res.json(await suggestDocumentNumbers(q.issuedDate, q.unit, q.parCount))
  })
  return r
}
