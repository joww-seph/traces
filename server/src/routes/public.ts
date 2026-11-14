import { Router } from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { AppError } from '../middleware/error.js'
import { publicPdfRef, publicPropertyView } from '../services/propertyView.js'
import { sendPdf } from './pdf.js'

// Anyone holding a sticker may open the one property behind its token. No listing, no search (BR-12).
export function publicRouter() {
  const r = Router()

  r.use('/public', rateLimit({
    windowMs: 60_000,
    limit: Number(process.env.PUBLIC_RATE_LIMIT_PER_MIN ?? 60),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED', 429, 'Too many requests. Try again in a minute.')),
  }))
  r.use('/public', (_req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex'); next() })

  // a malformed token is answered without touching the database
  r.param('token', (_req, _res, next, token: string) => (/^[0-9A-Za-z]{10}$/.test(token) ? next() : next(new AppError('NOT_FOUND', 404, 'Not found'))))

  r.get('/public/q/:token', async (req, res) => res.json(await publicPropertyView(String(req.params.token))))
  r.get('/public/q/:token/pdf', async (req, res) => sendPdf(res, await publicPdfRef(String(req.params.token))))
  return r
}
