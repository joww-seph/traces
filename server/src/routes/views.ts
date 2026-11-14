import { category, isoDate, reportQuery, signatoriesInput, uuid } from '@traces/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { replaceSignatories } from '../services/reportSignatories.js'
import { card, getSignatories, listCards, officerReportRows, registry } from '../services/views.js'
import { ctx } from './ctx.js'

const registryQuery = z.object({
  category, typeId: z.coerce.number().int().positive().optional(), from: isoDate.optional(), to: isoDate.optional(),
})
const cardsQuery = z.object({ category: category.optional(), typeId: z.coerce.number().int().positive().optional(), q: z.string().trim().optional() })
const cardQuery = z.object({ highlightLineId: uuid.optional() })

export function viewsRouter() {
  const r = Router()
  r.use(['/views', '/reports', '/report-signatories'], requireRole('supply_admin', 'superadmin'))

  r.get('/views/registry', async (req, res) => {
    const { category, ...f } = registryQuery.parse(req.query)
    res.json(await registry(category, f))
  })
  r.get('/views/cards', async (req, res) => res.json(await listCards(cardsQuery.parse(req.query))))
  r.get('/views/card/:itemId', async (req, res) => {
    const { highlightLineId } = cardQuery.parse(req.query)
    const c = await card(uuid.parse(req.params.itemId))
    res.json({ ...c, highlightRowIds: highlightLineId ? c.rows.filter((row) => row.lineId === highlightLineId).map((row) => row.id) : [] })
  })

  r.get('/reports/rpc', async (req, res) => res.json(await officerReportRows(reportQuery.parse(req.query))))
  r.get('/report-signatories', async (_req, res) => res.json(await getSignatories()))
  r.put('/report-signatories', validate(signatoriesInput), async (req, res) => res.json(await replaceSignatories(req.body, ctx(req))))
  return r
}
