import { z } from 'zod'
import { isoDate, nonEmpty, positionText, uuid } from './common.js'
import { lineInput } from './line.js'

export const issuanceHeader = z.strictObject({
  receivedByOfficerId: uuid,
  receivedByPosition: positionText.optional(),
  issuedByOfficerId: uuid,
  issuedByPosition: positionText.optional(),
  issuedDate: isoDate,
  fundCluster: nonEmpty,
  purpose: z.string().trim().optional(),
  icsNo: nonEmpty.optional(),
  parNos: z.array(nonEmpty).max(1000).optional(),
})

export const issuanceInput = z.strictObject({
  header: issuanceHeader,
  rows: z.array(lineInput).min(1).max(300),
  generate: z.boolean(),
}).refine((v) => v.rows.reduce((n, r) => n + r.properties.length, 0) <= 1000, 'At most 1000 properties in one save')
