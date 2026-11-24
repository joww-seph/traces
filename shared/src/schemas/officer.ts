import { spellOutPosition } from '../utils/names.js'
import { z } from 'zod'
import { nonEmpty, positionText } from './common.js'

const designations = z.array(nonEmpty.max(300).transform(spellOutPosition)).max(30)

export const officerInput = z.object({
  fullName: nonEmpty,
  position: positionText,
  office: z.string().trim().default(''),
  canReceive: z.boolean().default(false),
  designations: designations.default([]),
})
export const officerPatch = z.object({
  fullName: nonEmpty.optional(),
  position: positionText.optional(),
  office: z.string().trim().optional(),
  canReceive: z.boolean().optional(),
  designations: designations.optional(),
  active: z.boolean().optional(),
})
