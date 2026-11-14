import { z } from 'zod'
import { nonEmpty, uuid } from './common.js'

export const settingsPatch = z.object({
  entityName: nonEmpty,
  defaultFundCluster: nonEmpty,
  ppeThresholdCentavos: z.number().int().positive(),
  cardRowMode: z.enum(['merged', 'split']),
  publicBaseUrl: z.string().trim().url(),
  ppeRegistryTitle: nonEmpty,
  icsFormCode: nonEmpty,
  icsFormRevision: nonEmpty,
  parFormCode: nonEmpty,
  parFormRevision: nonEmpty,
  defaultIssuedByOfficerId: uuid.nullable(), // the supply officer printed as issuer on generated ICS/PAR
}).partial()
