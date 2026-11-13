import { z } from 'zod'
import { nonEmpty } from './common.js'

export const settingsPatch = z.object({
  entityName: nonEmpty,
  defaultFundCluster: nonEmpty,
  ppeThresholdCentavos: z.number().int().positive(),
  cardRowMode: z.enum(['merged', 'split']),
  publicBaseUrl: z.string().trim().url(),
  ppeRegistryTitle: nonEmpty,
}).partial()
