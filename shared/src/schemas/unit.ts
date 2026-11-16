import { z } from 'zod'
import { nonEmpty } from './common.js'

// An office unit or project whose code goes inside ICS/PAR numbers: 2026-11SARAi-001
export const UNIT_CODE_RE = /^[A-Za-z0-9]{1,12}$/
export const unitCode = z.string().trim().regex(UNIT_CODE_RE, '1 to 12 letters or digits, no spaces')
export const unitInput = z.object({ code: unitCode, name: nonEmpty.max(200) })
export const unitPatch = z.object({ name: nonEmpty.max(200).optional(), active: z.boolean().optional() })
