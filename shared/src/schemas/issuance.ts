import { z } from 'zod'
import { isoDate, nonEmpty, uuid } from './common.js'
import { lineInput } from './line.js'

// One issuance form (Update 02 V-01): the receiver and date once, then every row. The server splits it into an ICS
// (rows under the PPE threshold) and a PAR (rows at or above it) and saves both together.
export const issuanceHeader = z.strictObject({
  receivedByOfficerId: uuid,
  receivedByPosition: nonEmpty.optional(), // as printed; the officer's own position when omitted
  issuedByOfficerId: uuid,
  issuedByPosition: nonEmpty.optional(),
  issuedDate: isoDate,
  fundCluster: nonEmpty,
  purpose: z.string().trim().optional(), // becomes the registry's Remarks
  icsNo: nonEmpty.optional(), // needed only when some row is semi-expendable
  parNo: nonEmpty.optional(), // needed only when some row is PPE
})

export const issuanceInput = z.strictObject({
  header: issuanceHeader,
  rows: z.array(lineInput).min(1).max(300),
  generate: z.boolean(), // true: render the ICS/PAR PDFs after the save
}).refine((v) => v.rows.reduce((n, r) => n + r.properties.length, 0) <= 1000, 'At most 1000 properties in one save')
