import { Router, type Request, type Response } from 'express'
import { requireRole } from '../middleware/auth.js'
import { getSettings } from '../services/settings.js'

export function settingsRouter() {
  const r = Router()
  r.get('/settings', requireRole('supply_admin', 'superadmin'), async (_req: Request, res: Response) => res.json(await getSettings()))
  return r
}
