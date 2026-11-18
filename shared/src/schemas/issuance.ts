import { z } from 'zod'
import { isoDate, nonEmpty, positionText, uuid } from './common.js'
import { lineInput } from './line.js'

// One issuance form (Update 02 V-01): the receiver and date once, then every row. The server puts the rows under the
// PPE threshold on one ICS (one per purchase) and gives every PPE unit its own PAR (decision 2026-11-18), all in one save.
export const issuanceHeader = z.strictObject({
  receivedByOfficerId: uuid,
  receivedByPosition: positionText.optional(), // as printed; the officer's own position when omitted
  issuedByOfficerId: uuid,
  issuedByPosition: positionText.optional(),
  issuedDate: isoDate,
  fundCluster: nonEmpty,
  purpose: z.string().trim().optional(), // becomes the registry's Remarks
  icsNo: nonEmpty.optional(), // needed only when some row is semi-expendable
  parNos: z.array(nonEmpty).max(1000).optional(), // one per PPE unit, in row order
})

export const issuanceInput = z.strictObject({
  header: issuanceHeader,
  rows: z.array(lineInput).min(1).max(300),
  generate: z.boolean(), // true: render the ICS/PAR PDFs after the save
}).refine((v) => v.rows.reduce((n, r) => n + r.properties.length, 0) <= 1000, 'At most 1000 properties in one save')
