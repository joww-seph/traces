import { z } from 'zod'
import { nonEmpty } from './common.js'

export const propertyTypeInput = z.object({
  code: z.string().trim().regex(/^[A-Z]{2,8}$/, '2 to 8 capital letters'),
  name: nonEmpty.max(200),
})
export const propertyTypePatch = propertyTypeInput.partial().extend({ active: z.boolean().optional() })
