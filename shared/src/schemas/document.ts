import { z } from 'zod'
import { isoDate, nonEmpty, uuid } from './common.js'

// Positions are optional: the server snapshots the officer's current position when omitted.
export const documentMeta = z.object({
  type: z.enum(['ICS', 'PAR']),
  docNo: nonEmpty,
  fundCluster: nonEmpty,
  issuedDate: isoDate,
  issuedByOfficerId: uuid,
  issuedByPosition: nonEmpty.optional(),
  receivedByOfficerId: uuid,
  receivedByPosition: nonEmpty.optional(),
  purpose: z.string().trim().optional(),
})
export const documentPatch = documentMeta.partial()
