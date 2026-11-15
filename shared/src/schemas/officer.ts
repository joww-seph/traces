import { spellOutPosition } from '../utils/names.js'
import { z } from 'zod'
import { nonEmpty, positionText } from './common.js'

const designations = z.array(nonEmpty.max(300).transform(spellOutPosition)).max(30)

// The short name is not typed: the server makes it from the full name (see shortNameOf).
export const officerInput = z.object({
  fullName: nonEmpty,
  position: positionText,
  office: z.string().trim().default(''),
  canReceive: z.boolean().default(false), // may be "Received by" on an ICS/PAR and appear on the officer report
  designations: designations.default([]), // programs / projects, e.g. "SARAi CENTRO, Focal Person"
})
// Written out (not .partial()) so an omitted field stays omitted instead of taking its default.
export const officerPatch = z.object({
  fullName: nonEmpty.optional(),
  position: positionText.optional(),
  office: z.string().trim().optional(),
  canReceive: z.boolean().optional(),
  designations: designations.optional(),
  active: z.boolean().optional(),
})
