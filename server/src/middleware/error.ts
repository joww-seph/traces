import type { ErrorRequestHandler, RequestHandler } from 'express'
import { MulterError } from 'multer'
import { ZodError } from 'zod'

export class AppError extends Error {
  constructor(public code: string, public status: number, message?: string, public details?: unknown) {
    super(message ?? code)
  }
}

type PgError = Error & { code: string; constraint?: string; detail?: string }
const isPgError = (e: unknown): e is PgError =>
  e instanceof Error && typeof (e as PgError).code === 'string' && /^[0-9A-Z]{5}$/.test((e as PgError).code)
// drizzle wraps driver errors; the pg error is in .cause
export const pgErrorOf = (e: unknown): PgError | null =>
  isPgError(e) ? e : isPgError((e as { cause?: unknown })?.cause) ? (e as { cause: PgError }).cause : null

const send = (res: Parameters<ErrorRequestHandler>[2], status: number, code: string, message: string, details?: unknown) =>
  res.status(status).json({ error: { code, message, ...(details === undefined ? {} : { details }) } })

export const notFound: RequestHandler = (_req, _res, next) => next(new AppError('NOT_FOUND', 404, 'Not found'))

// CLAUDE.md: Postgres errors are mapped centrally. 23505 -> 409, 23503/23514 -> 400.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) return send(res, 400, 'VALIDATION', 'Invalid request', err.issues)
  if (err instanceof AppError) return send(res, err.status, err.code, err.message, err.details)
  if ((err as { type?: string })?.type === 'entity.parse.failed') return send(res, 400, 'BAD_JSON', 'Malformed JSON body')
  if ((err as { type?: string })?.type === 'entity.too.large') return send(res, 413, 'TOO_LARGE', 'Request body too large')

  if (err instanceof MulterError) {
    return err.code === 'LIMIT_FILE_SIZE'
      ? send(res, 413, 'TOO_LARGE', 'File too large (max 20 MB)')
      : send(res, 400, 'BAD_UPLOAD', err.message)
  }

  const pgErr = pgErrorOf(err)
  if (pgErr) {
    const key = /=\((.*)\) already exists/.exec(pgErr.detail ?? '')?.[1]
    const details = { constraint: pgErr.constraint, ...(key ? { key } : {}) }
    if (pgErr.code === '23505') return send(res, 409, 'DUPLICATE', 'Already exists', details)
    if (pgErr.code === '23503') return send(res, 400, 'BAD_REFERENCE', 'Referenced record does not exist', details)
    if (pgErr.code === '23514') return send(res, 400, 'CONSTRAINT_FAILED', 'Value rejected by a database rule', details)
  }

  console.error(err)
  return send(res, 500, 'INTERNAL', 'Something went wrong')
}
