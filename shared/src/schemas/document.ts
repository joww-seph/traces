import { z } from 'zod'
import { isoDate, nonEmpty, positionText, uuid } from './common.js'

export const documentMeta = z.object({
  type: z.enum(['ICS', 'PAR']),
  docNo: nonEmpty,
  fundCluster: nonEmpty,
  issuedDate: isoDate,
  issuedByOfficerId: uuid,
  issuedByPosition: positionText.optional(),
  receivedByOfficerId: uuid,
  receivedByPosition: positionText.optional(),
  purpose: z.string().trim().optional(),
})
export const documentPatch = documentMeta.partial()
