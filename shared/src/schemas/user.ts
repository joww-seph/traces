import { z } from 'zod'
import { nonEmpty } from './common.js'

const role = z.enum(['supply_admin', 'superadmin'])
// The email is not typed: the server makes it from the name (shortname@region1.dost.gov.ph) and generates the
// temporary password, shown once.
export const userCreate = z.object({
  displayName: nonEmpty,
  role,
})
export const userPatch = z.object({
  displayName: nonEmpty.optional(),
  role: role.optional(),
  active: z.boolean().optional(),
  resetPassword: z.boolean().optional(),
})
