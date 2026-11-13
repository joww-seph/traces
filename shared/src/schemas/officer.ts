import { z } from 'zod'
import { nonEmpty } from './common.js'

export const officerInput = z.object({
  fullName: nonEmpty,
  shortName: nonEmpty,
  position: nonEmpty,
  office: z.string().trim().default(''),
})
export const officerPatch = officerInput.partial().extend({ active: z.boolean().optional() })
