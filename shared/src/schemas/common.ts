import { z } from 'zod'
import { isIsoDate } from '../utils/dates.js'
import { PROPERTY_NO_RE } from '../utils/propertyNo.js'

export const isoDate = z.string().refine(isIsoDate, 'Must be a valid date (YYYY-MM-DD)')
export const nonEmpty = z.string().trim().min(1, 'Required')
export const centavos = z.number().int().nonnegative()
export const propertyNo = z.string().trim().regex(PROPERTY_NO_RE, 'Letters, digits and hyphens only')
export const category = z.enum(['semi', 'ppe'])
export const uuid = z.string().uuid()
