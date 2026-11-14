import type { signatoriesInput } from '@traces/shared'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { reportSignatories } from '../db/schema.js'
import { audit, type Ctx } from './audit.js'
import { getSignatories } from './views.js'

// "Save as default" on the report page: replaces the whole list in one transaction.
export async function replaceSignatories(input: z.infer<typeof signatoriesInput>, ctx: Ctx) {
  await db.transaction(async (tx) => {
    const before = await tx.select().from(reportSignatories)
    await tx.delete(reportSignatories)
    if (input.length) await tx.insert(reportSignatories).values(input.map((s) => ({ ...s, position: s.position || null })))
    await audit(tx, ctx, 'report_signatories.update', 'report_signatories', 'default', before, input)
  })
  return getSignatories()
}
