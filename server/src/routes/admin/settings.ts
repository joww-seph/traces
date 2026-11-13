import { settingsPatch } from '@traces/shared'
import { Router } from 'express'
import { requireRole } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { getSettings, updateSettings } from '../../services/settings.js'
import { ctx } from '../ctx.js'

export function adminSettingsRouter() {
  const r = Router()
  r.use('/admin', requireRole('superadmin'))
  r.get('/admin/settings', async (_req, res) => res.json(await getSettings()))
  r.patch('/admin/settings', validate(settingsPatch), async (req, res) => res.json(await updateSettings(req.body, ctx(req))))
  return r
}
