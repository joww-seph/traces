import { z } from 'zod'
import { category, isoDate, nonEmpty, uuid } from './common.js'

export const signatory = z.object({
  role: z.enum(['committee', 'head_of_agency', 'coa_representative']),
  sortOrder: z.number().int().positive().default(1),
  name: nonEmpty,
  position: z.string().trim().optional(),
})

export const countInput = z.object({
  category,
  typeLabel: nonEmpty,
  asAt: isoDate,
  fundCluster: nonEmpty,
  officerId: uuid,
  officerPosition: nonEmpty.optional(),
  assumptionDate: isoDate.optional(),
  signatories: z.array(signatory).default([]),
})
export const countPatch = countInput.partial().extend({ status: z.enum(['open', 'closed']).optional() })
export const countItemPatch = z.object({
  qtyOnHand: z.number().int().nonnegative().nullable().optional(),
  remarks: z.string().trim().nullable().optional(),
})
