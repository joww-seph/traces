import { categorize, type issuanceInput } from '@traces/shared'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { documents, officers } from '../db/schema.js'
import { AppError } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'
import { duplicateNo } from './documents.js'
import { generateDocument } from './generate.js'
import { assertNoDuplicateNumbers, insertLineTx, withTokenRetry, type ItemCache } from './lines.js'
import { assertCanReceive } from './officers.js'
import { getSettings } from './settings.js'

type Input = z.infer<typeof issuanceInput>
type DocType = 'ICS' | 'PAR'

// V-02: rows below the PPE threshold go on an ICS, the others on a PAR. Everything is written in one transaction;
// the PDFs are rendered afterwards, so a rendering problem never loses the entries.
export async function createIssuance(input: Input, ctx: Ctx, generate: typeof generateDocument = generateDocument) {
  if (!ctx.actorId) throw new AppError('FORBIDDEN', 403, 'A signed-in user is required')
  const userId = ctx.actorId
  const { header, rows } = input

  const created = await withTokenRetry(() => db.transaction(async (tx) => {
    const s = await getSettings(tx)
    const typeOf = rows.map((r): DocType => (categorize(r.line.unitCostCentavos, s.ppeThresholdCentavos) === 'semi' ? 'ICS' : 'PAR'))
    const types = (['ICS', 'PAR'] as const).filter((t) => typeOf.includes(t))
    const docNo = { ICS: header.icsNo, PAR: header.parNo }
    for (const t of types) {
      if (!docNo[t]) throw new AppError('DOC_NO_REQUIRED', 400, `Enter the ${t} number: ${typeOf.filter((x) => x === t).length} row(s) belong on it`, { type: t })
    }

    await assertCanReceive(tx, header.receivedByOfficerId)
    const position = async (id: string, given?: string) => {
      if (given) return given
      const o = (await tx.select({ position: officers.position }).from(officers).where(eq(officers.id, id)))[0]
      if (!o) throw new AppError('OFFICER_NOT_FOUND', 400, 'Officer not found')
      return o.position
    }
    const issuedByPosition = await position(header.issuedByOfficerId, header.issuedByPosition)
    const receivedByPosition = await position(header.receivedByOfficerId, header.receivedByPosition)

    // every duplicate property number of the whole form, with its row, before anything is written (BR-14)
    await assertNoDuplicateNumbers(tx, rows.map((r) => r.properties))

    const docs = new Map<DocType, typeof documents.$inferSelect>()
    for (const t of types) {
      try {
        const [d] = await tx.insert(documents).values({
          type: t, docNo: docNo[t]!, fundCluster: header.fundCluster, issuedDate: header.issuedDate,
          issuedByOfficerId: header.issuedByOfficerId, issuedByPosition, receivedByOfficerId: header.receivedByOfficerId, receivedByPosition,
          purpose: header.purpose || null, createdBy: userId,
        }).returning()
        docs.set(t, d)
        await audit(tx, ctx, 'document.create', 'documents', d.id, null, { type: t, docNo: d.docNo, via: 'issuance' })
      } catch (e) { duplicateNo(e, t, docNo[t]!) }
    }

    const cache: ItemCache = new Map()
    const nextNo = { ICS: 1, PAR: 1 }
    const lineIds: Record<DocType, string[]> = { ICS: [], PAR: [] }
    for (const [rowIndex, row] of rows.entries()) {
      const t = typeOf[rowIndex]
      try {
        const r = await insertLineTx(tx, docs.get(t)!, row, { lineNo: nextNo[t]++, cache, thresholdCentavos: s.ppeThresholdCentavos, ctx })
        lineIds[t].push(r.lineId)
      } catch (e) {
        if (e instanceof AppError) throw new AppError(e.code, e.status, e.message, { ...(e.details as object | undefined), rowIndex })
        throw e
      }
    }
    await audit(tx, ctx, 'issuance.create', 'documents', [...docs.values()].map((d) => d.id).join(','), null,
      { documents: types.map((t) => ({ type: t, docNo: docNo[t], rows: lineIds[t].length })), receivedByOfficerId: header.receivedByOfficerId, issuedDate: header.issuedDate })
    return types.map((t) => ({ id: docs.get(t)!.id, type: t, docNo: docNo[t]!, lineIds: lineIds[t] }))
  }))

  // after commit: render the PDFs; a failure is reported, never undone
  const warnings: string[] = []
  if (input.generate) {
    for (const d of created) {
      try { await generate(d.id, ctx) } catch (e) {
        console.error(`ICS/PAR generation failed for ${d.type} ${d.docNo}:`, e)
        if (!warnings.includes('GENERATION_FAILED')) warnings.push('GENERATION_FAILED')
      }
    }
  }
  return { documents: created, warnings }
}
