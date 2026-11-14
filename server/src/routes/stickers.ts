import { uuid } from '@traces/shared'
import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'
import { stickers } from '../services/stickers.js'

export function stickersRouter() {
  const r = Router()
  r.use('/stickers', requireRole('supply_admin', 'superadmin'))
  // ?documentId=<uuid> or ?nos=A-1,A-2
  r.get('/stickers', async (req, res) => {
    const { documentId, nos } = req.query
    if (typeof documentId === 'string') return res.json(await stickers({ documentId: uuid.parse(documentId) }))
    if (typeof nos === 'string' && nos.trim()) return res.json(await stickers({ nos: nos.split(',') }))
    throw new AppError('VALIDATION', 400, 'Give documentId or nos')
  })
  return r
}
