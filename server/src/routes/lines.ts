import { batchInput, lineInput, linePatch, pdfRegion, uuid } from '@traces/shared'
import { z } from 'zod'
import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { createLine, createLinesBatch, deleteLine, getLine, setRegion, updateLine } from '../services/lines.js'
import { ctx } from './ctx.js'

export function linesRouter() {
  const r = Router()
  r.use(['/lines', '/documents/:id/lines'], requireRole('supply_admin', 'superadmin'))

  r.post('/documents/:id/lines', validate(lineInput), async (req, res) =>
    res.status(201).json(await createLine(uuid.parse(req.params.id), req.body, ctx(req))))
  r.post('/documents/:id/lines/batch', validate(batchInput), async (req, res) =>
    res.status(201).json({ lines: await createLinesBatch(uuid.parse(req.params.id), req.body.rows, ctx(req)) }))
  r.get('/lines/:id', async (req, res) => res.json(await getLine(uuid.parse(req.params.id))))
  r.patch('/lines/:id', validate(linePatch), async (req, res) =>
    res.json(await updateLine(uuid.parse(req.params.id), req.body, ctx(req))))
  // a highlight box on the generated or the uploaded PDF; allowed even when the form is signed
  r.put('/lines/:id/region', validate(z.object({ kind: z.enum(['generated', 'uploaded']) }).and(pdfRegion)), async (req, res) => {
    const { kind, ...region } = req.body
    res.json(await setRegion(uuid.parse(req.params.id), kind, region, ctx(req)))
  })
  r.delete('/lines/:id', async (req, res) => {
    await deleteLine(uuid.parse(req.params.id), ctx(req))
    res.json({ ok: true })
  })
  return r
}
