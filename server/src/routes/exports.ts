import { isoDate, signatoriesInput, uuid } from '@traces/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requireRole } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'
import { audit } from '../services/audit.js'
import { FORMS, exportForm, type Form } from '../services/exports.js'
import { db } from '../db/client.js'
import { ctx } from './ctx.js'

const query = z.object({
  itemId: uuid.optional(), officerId: uuid.optional(), typeId: z.coerce.number().int().positive().optional(),
  asAt: isoDate.optional(), from: isoDate.optional(), to: isoDate.optional(),
  // the footer names typed on the report page, as JSON (they are not saved unless "Save as default" is used)
  signatories: z.string().optional().transform((s, ctx) => {
    if (!s) return undefined
    try { return signatoriesInput.parse(JSON.parse(s)) } catch {
      ctx.addIssue({ code: 'custom', message: 'signatories must be a JSON list of { role, name } entries' })
      return z.NEVER
    }
  }),
})
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// GET /api/exports/:form  spc|pc (?itemId) · regspi|regppe (?typeId&from&to) · rpcsp|rpcppe (?officerId&typeId&asAt&signatories)
export function exportsRouter() {
  const r = Router()
  r.use('/exports', requireRole('supply_admin', 'superadmin'))
  r.get('/exports/:form', async (req, res) => {
    const form = String(req.params.form) as Form
    if (!FORMS.includes(form)) throw new AppError('NOT_FOUND', 404, `Unknown form "${form}"`)
    const q = query.parse(req.query)
    const { buffer, filename } = await exportForm(form, q)
    await audit(db, ctx(req), `export.${form}`, 'exports', form, null, { ...q, signatories: undefined, filename })
    res.setHeader('Content-Type', XLSX)
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    res.setHeader('Cache-Control', 'no-store')
    res.send(buffer)
  })
  return r
}
