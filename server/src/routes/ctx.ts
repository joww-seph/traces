import type { Request } from 'express'
import type { Ctx } from '../services/audit.js'

export const ctx = (req: Request): Ctx => ({ actorId: req.user?.id ?? null, ip: req.ip ?? null })
