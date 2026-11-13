import { z } from 'zod'

export const propertyPatch = z.object({
  serialNo: z.string().trim().min(1).nullable().optional(),
  componentLabel: z.string().trim().min(1).nullable().optional(),
  condition: z.enum(['serviceable', 'unserviceable']).optional(),
})
