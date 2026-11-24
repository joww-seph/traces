import { spellOutPosition } from '../utils/names.js'
import { z } from 'zod'
import { category, isoDate, nonEmpty, uuid } from './common.js'

export const reportQuery = z.object({
  officerId: uuid,
  category,
  typeId: z.coerce.number().int().positive().optional(),
  asAt: isoDate.optional(),
  countId: uuid.optional(),
})

export const signatory = z.object({
  role: z.enum(['committee', 'head_of_agency', 'coa_representative']),
  sortOrder: z.number().int().positive().default(1),
  name: nonEmpty,
  position: z.string().trim().transform(spellOutPosition).optional(),
})
export const signatoriesInput = z.array(signatory).max(30)

export const cardRemarksInput = z.strictObject({ remarks: z.string().trim().max(500).nullable().transform((v) => v || null) })

export const countStartInput = z.strictObject({ officerId: uuid, category, asAt: isoDate })
export const condition = z.enum(['serviceable', 'unserviceable'])
export const countScanInput = z.strictObject({ token: z.string().regex(/^[0-9A-Za-z]{10}$/), condition })
