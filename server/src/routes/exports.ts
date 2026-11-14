import { isoDate, uuid } from '@traces/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requireRole } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'
import { FORMS, exportForm, type Form } from '../services/exports.js'

const query = z.object({
  documentId: uuid.optional(), countId: uuid.optional(), no: z.string().trim().min(1).optional(), from: isoDate.optional(), to: isoDate.optional(),
})
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// GET /api/exports/:form  ics|par (?documentId) · spc|pc (?no) · regspi|regppe (?from&to) · rpcsp|rpcppe (?countId)
export function exportsRouter() {
  const r = Router()
  r.use('/exports', requireRole('supply_admin', 'superadmin'))
  r.get('/exports/:form', async (req, res) => {
    const form = String(req.params.form) as Form
    if (!FORMS.includes(form)) throw new AppError('NOT_FOUND', 404, `Unknown form "${form}"`)
    const { buffer, filename } = await exportForm(form, query.parse(req.query))
    res.setHeader('Content-Type', XLSX)
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    res.setHeader('Cache-Control', 'no-store')
    res.send(buffer)
  })
  return r
}
