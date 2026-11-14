import { z } from 'zod'
import { category, isoDate, nonEmpty, uuid } from './common.js'

export const reportQuery = z.object({
  officerId: uuid,
  category,
  typeId: z.coerce.number().int().positive().optional(),
  asAt: isoDate.optional(),
})

export const signatory = z.object({
  role: z.enum(['committee', 'head_of_agency', 'coa_representative']),
  sortOrder: z.number().int().positive().default(1),
  name: nonEmpty,
  position: z.string().trim().optional(),
})
export const signatoriesInput = z.array(signatory).max(30)
