import type { RequestHandler } from 'express'
import type { ZodType } from 'zod'

// Parses req.body with a shared zod schema; a ZodError goes to the error middleware (-> 400).
export const validate = (schema: ZodType): RequestHandler => (req, _res, next) => {
  req.body = schema.parse(req.body)
  next()
}
