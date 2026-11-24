import { cardRemarksInput, category, isoDate, reportQuery, signatoriesInput, uuid } from '@traces/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { replaceSignatories } from '../services/reportSignatories.js'
import { officerForms, officerFormsPdf } from '../services/officerForms.js'
import { card, getSignatories, listCards, officerReportRows, registry, setCardRemarks, unserviceableRows } from '../services/views.js'
import { ctx } from './ctx.js'

const registryQuery = z.object({
  category, typeId: z.coerce.number().int().positive().optional(), from: isoDate.optional(), to: isoDate.optional(),
})
const cardsQuery = z.object({ category: category.optional(), typeId: z.coerce.number().int().positive().optional(), q: z.string().trim().optional() })
const cardQuery = z.object({ highlightLineId: uuid.optional() })

export function viewsRouter() {
  const r = Router()
  r.use(['/views', '/reports', '/report-signatories'], requireRole('supply_admin'))

  r.get('/views/registry', async (req, res) => {
    const { category, ...f } = registryQuery.parse(req.query)
    res.json(await registry(category, f))
  })
  r.get('/views/cards', async (req, res) => res.json(await listCards(cardsQuery.parse(req.query))))
  r.get('/views/card/:propertyId', async (req, res) => {
    const { highlightLineId } = cardQuery.parse(req.query)
    const c = await card(uuid.parse(req.params.propertyId))
    res.json({ ...c, highlightRowIds: highlightLineId ? c.rows.filter((row) => row.lineId === highlightLineId).map((row) => row.id) : [] })
  })

  r.patch('/views/card-rows/:movementId', validate(cardRemarksInput), async (req, res) =>
    res.json(await setCardRemarks(z.coerce.number().int().positive().parse(req.params.movementId), req.body.remarks, ctx(req))))

  r.get('/reports/forms', async (req, res) => res.json(await officerForms(z.object({ officerId: uuid }).parse(req.query).officerId)))
  r.get('/reports/forms.pdf', async (req, res) => {
    const { officerId } = z.object({ officerId: uuid }).parse(req.query)
    res.type('application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="ICS-PAR_${officerId.slice(0, 8)}.pdf"`)
    res.setHeader('Cache-Control', 'no-store')
    res.send(await officerFormsPdf(officerId))
  })

  r.get('/reports/rpc', async (req, res) => res.json(await officerReportRows(reportQuery.parse(req.query))))
  r.get('/reports/unserviceable', async (req, res) => res.json(await unserviceableRows(reportQuery.parse(req.query))))
  r.get('/report-signatories', async (_req, res) => res.json(await getSignatories()))
  r.put('/report-signatories', validate(signatoriesInput), async (req, res) => res.json(await replaceSignatories(req.body, ctx(req))))
  return r
}
