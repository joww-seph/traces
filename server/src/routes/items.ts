import { itemCreate, itemPatch, itemQuery, uuid } from '@traces/shared'
import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { createItem, listItems, updateItem } from '../services/items.js'
import { ctx } from './ctx.js'

export function itemsRouter() {
  const r = Router()
  r.use('/items', requireRole('supply_admin', 'superadmin'))
  r.get('/items', async (req, res) => res.json(await listItems(itemQuery.parse(req.query))))
  r.post('/items', validate(itemCreate), async (req, res) => res.status(201).json(await createItem(req.body, ctx(req))))
  r.patch('/items/:id', validate(itemPatch), async (req, res) => res.json(await updateItem(uuid.parse(req.params.id), req.body, ctx(req))))
  return r
}
