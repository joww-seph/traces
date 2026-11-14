import { z } from 'zod'
import { category, nonEmpty } from './common.js'

// A card: one per model. The category comes from the cost of the lines on it, never typed.
export const itemInput = z.strictObject({
  propertyTypeId: z.number().int().positive(),
  article: nonEmpty.max(300),
  description: nonEmpty.max(300),
  unit: nonEmpty.max(30),
})
export const itemPatch = itemInput.omit({ propertyTypeId: true }).partial().extend({ active: z.boolean().optional() })

export const itemQuery = z.object({
  q: z.string().trim().optional(),
  category: category.optional(),
  typeId: z.coerce.number().int().positive().optional(),
  active: z.enum(['true', 'false']).optional(),
})
