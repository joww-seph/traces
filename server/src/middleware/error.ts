import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'

export class AppError extends Error {
  constructor(public code: string, public status: number, message?: string, public details?: unknown) {
    super(message ?? code)
  }
}

type PgError = Error & { code: string; constraint?: string; detail?: string }
const isPgError = (e: unknown): e is PgError =>
  e instanceof Error && typeof (e as PgError).code === 'string' && /^[0-9A-Z]{5}$/.test((e as PgError).code)

const send = (res: Parameters<ErrorRequestHandler>[2], status: number, code: string, message: string, details?: unknown) =>
  res.status(status).json({ error: { code, message, ...(details === undefined ? {} : { details }) } })

export const notFound: RequestHandler = (_req, _res, next) => next(new AppError('NOT_FOUND', 404, 'Not found'))

// CLAUDE.md: Postgres errors are mapped centrally. 23505 -> 409, 23503/23514 -> 400.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) return send(res, 400, 'VALIDATION', 'Invalid request', err.issues)
  if (err instanceof AppError) return send(res, err.status, err.code, err.message, err.details)
  if ((err as { type?: string })?.type === 'entity.parse.failed') return send(res, 400, 'BAD_JSON', 'Malformed JSON body')
  if ((err as { type?: string })?.type === 'entity.too.large') return send(res, 413, 'TOO_LARGE', 'Request body too large')

  if (isPgError(err)) {
    const key = /=\((.*)\) already exists/.exec(err.detail ?? '')?.[1]
    const details = { constraint: err.constraint, ...(key ? { key } : {}) }
    if (err.code === '23505') return send(res, 409, 'DUPLICATE', 'Already exists', details)
    if (err.code === '23503') return send(res, 400, 'BAD_REFERENCE', 'Referenced record does not exist', details)
    if (err.code === '23514') return send(res, 400, 'CONSTRAINT_FAILED', 'Value rejected by a database rule', details)
  }

  console.error(err)
  return send(res, 500, 'INTERNAL', 'Something went wrong')
}
