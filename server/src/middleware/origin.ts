import type { RequestHandler } from 'express'
import { AppError } from './error.js'

// CSRF defence (spec §10): non-GET requests need an allowed Origin and, when they carry a body,
// a JSON or multipart content type (a cross-site <form> can only send urlencoded/plain).
export function originCheck(): RequestHandler {
  const allowed = new Set((process.env.APP_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
    if (!req.headers.origin || !allowed.has(req.headers.origin)) {
      return next(new AppError('BAD_ORIGIN', 403, 'Origin not allowed'))
    }
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || 'transfer-encoding' in req.headers
    if (hasBody && !req.is(['application/json', 'multipart/form-data'])) {
      return next(new AppError('BAD_CONTENT_TYPE', 403, 'Content type not allowed'))
    }
    next()
  }
}
