import { userCreate, userPatch, uuid } from '@traces/shared'
import { Router } from 'express'
import { requireRole } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { adminCreateUser, adminUpdateUser, listUsers } from '../../services/users.js'
import { ctx } from '../ctx.js'

export function adminUsersRouter() {
  const r = Router()
  r.use('/admin/users', requireRole('superadmin'))
  r.get('/admin/users', async (_req, res) => res.json(await listUsers()))
  r.post('/admin/users', validate(userCreate), async (req, res) => res.status(201).json(await adminCreateUser(req.body, ctx(req))))
  r.patch('/admin/users/:id', validate(userPatch), async (req, res) => res.json(await adminUpdateUser(uuid.parse(req.params.id), req.body, ctx(req))))
  return r
}
