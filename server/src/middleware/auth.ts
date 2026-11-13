import type { RequestHandler } from 'express'
import { AppError } from './error.js'
import { findById } from '../services/users.js'

export type Role = 'supply_admin' | 'superadmin'
export type AuthUser = { id: string; email: string; displayName: string; role: Role; mustChangePassword: boolean }

declare global {
  namespace Express { interface Request { user?: AuthUser } }
}

// The user (and role) is re-read from the DB on every request: role changes and deactivation apply at once.
function loader(allowTempPassword: boolean): RequestHandler {
  return async (req, _res, next) => {
    const id = req.session.userId
    const u = id ? await findById(id) : undefined
    if (!u || !u.active) throw new AppError('UNAUTHENTICATED', 401, 'Not logged in')
    if (u.mustChangePassword && !allowTempPassword) {
      throw new AppError('PASSWORD_CHANGE_REQUIRED', 403, 'Change your temporary password first')
    }
    req.user = { id: u.id, email: u.email, displayName: u.displayName, role: u.role, mustChangePassword: u.mustChangePassword }
    next()
  }
}

export const requireAuth = loader(false)
// Only for /api/me and /api/me/password, which a temporary-password user must reach.
export const requireAuthAllowTemp = loader(true)

export const requireRole = (...roles: Role[]): RequestHandler[] => [
  requireAuth,
  (req, _res, next) => {
    if (!roles.includes(req.user!.role)) throw new AppError('FORBIDDEN', 403, 'Not allowed')
    next()
  },
]
