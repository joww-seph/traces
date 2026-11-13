import { lineInput, linePatch, uuid } from '@traces/shared'
import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { createLine, deleteLine, updateLine } from '../services/lines.js'
import { ctx } from './ctx.js'

export function linesRouter() {
  const r = Router()
  r.use(['/lines', '/documents/:id/lines'], requireRole('supply_admin', 'superadmin'))

  r.post('/documents/:id/lines', validate(lineInput), async (req, res) =>
    res.status(201).json(await createLine(uuid.parse(req.params.id), req.body, ctx(req))))
  r.patch('/lines/:id', validate(linePatch), async (req, res) =>
    res.json(await updateLine(uuid.parse(req.params.id), req.body, ctx(req))))
  r.delete('/lines/:id', async (req, res) => {
    await deleteLine(uuid.parse(req.params.id), ctx(req))
    res.json({ ok: true })
  })
  return r
}
