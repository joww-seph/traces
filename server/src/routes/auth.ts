import { changePasswordInput, loginInput } from '@traces/shared'
import { Router } from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { requireAuthAllowTemp } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'
import { changePassword, checkCredentials } from '../services/users.js'

const ctx = (req: { user?: { id: string }; ip?: string }) => ({ actorId: req.user?.id ?? null, ip: req.ip ?? null })
const run = <T>(fn: (cb: (err?: unknown) => void) => T) => new Promise<void>((resolve, reject) => fn((e) => (e ? reject(e) : resolve())))

export function authRouter() {
  const r = Router()

  // Limit is read at build time so a test can build an app with a small one. Memory store: one process only.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.LOGIN_RATE_LIMIT ?? 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.email ?? '').trim().toLowerCase()}`,
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED', 429, 'Too many login attempts. Try again later.')),
  })

  r.post('/auth/login', validate(loginInput), loginLimiter, async (req, res) => {
    const user = await checkCredentials(req.body.email, req.body.password)
    if (!user) throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid email or password')
    await run((cb) => req.session.regenerate(cb)) // new sid on login: no session fixation
    req.session.userId = user.id
    req.session.role = user.role
    await run((cb) => req.session.save(cb))
    res.json({ user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, mustChangePassword: user.mustChangePassword } })
  })

  r.post('/auth/logout', async (req, res) => {
    await run((cb) => req.session.destroy(cb))
    res.clearCookie('traces.sid').json({ ok: true })
  })

  r.get('/me', requireAuthAllowTemp, (req, res) => res.json(req.user))

  r.post('/me/password', requireAuthAllowTemp, validate(changePasswordInput), async (req, res) => {
    await changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword, ctx(req))
    res.json({ ok: true })
  })

  return r
}
