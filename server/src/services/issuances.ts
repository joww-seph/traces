import { categorize, type issuanceInput } from '@traces/shared'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { documents, officers } from '../db/schema.js'
import { AppError } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'
import { duplicateNo } from './documents.js'
import { generateDocument } from './generate.js'
import { assertNoDuplicateNumbers, insertLineTx, withTokenRetry, type LineInput } from './lines.js'
import { assertCanReceive } from './officers.js'
import { getSettings } from './settings.js'

type Input = z.infer<typeof issuanceInput>
type DocType = 'ICS' | 'PAR'

export async function createIssuance(input: Input, ctx: Ctx, generate: typeof generateDocument = generateDocument) {
  if (!ctx.actorId) throw new AppError('FORBIDDEN', 403, 'A signed-in user is required')
  const userId = ctx.actorId
  const { header, rows } = input

  const created = await withTokenRetry(() => db.transaction(async (tx) => {
    const s = await getSettings(tx)
    const isPpe = rows.map((r) => categorize(r.line.unitCostCentavos, s.ppeThresholdCentavos) === 'ppe')
    const parts: { rowIndex: number; row: LineInput }[] = rows.flatMap((row, rowIndex) => {
      if (!isPpe[rowIndex]) return []
      const mains = row.properties.filter((p) => !p.componentLabel)
      if (mains.length === 1) return [{ rowIndex, row: { ...row, line: { ...row.line, qty: 1 } } }]
      return mains.map((m) => ({ rowIndex, row: { line: { ...row.line, qty: 1 }, properties: [m] } }))
    })
    const semiRows = rows.map((row, rowIndex) => ({ rowIndex, row })).filter((r) => !isPpe[r.rowIndex])
    if (semiRows.length && !header.icsNo) {
      throw new AppError('DOC_NO_REQUIRED', 400, `Enter the ICS number: ${semiRows.length} row(s) belong on it`, { type: 'ICS' })
    }
    const parNos = header.parNos ?? []
    if (parNos.length < parts.length) {
      throw new AppError('DOC_NO_REQUIRED', 400, `Enter ${parts.length} PAR number(s), one for each PPE unit (${parNos.length} given)`, { type: 'PAR', needed: parts.length })
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

    await assertNoDuplicateNumbers(tx, rows.map((r) => r.properties))

    const newDoc = async (type: DocType, docNo: string) => {
      try {
        const [d] = await tx.insert(documents).values({
          type, docNo, fundCluster: header.fundCluster, issuedDate: header.issuedDate,
          issuedByOfficerId: header.issuedByOfficerId, issuedByPosition, receivedByOfficerId: header.receivedByOfficerId, receivedByPosition,
          purpose: header.purpose || null, createdBy: userId,
        }).returning()
        await audit(tx, ctx, 'document.create', 'documents', d.id, null, { type, docNo: d.docNo, via: 'issuance' })
        return d
      } catch (e) { duplicateNo(e, type, docNo) }
    }
    const addLine = async (doc: typeof documents.$inferSelect, rowIndex: number, row: LineInput, lineNo: number) => {
      try {
        return (await insertLineTx(tx, doc, row, { lineNo, thresholdCentavos: s.ppeThresholdCentavos, ctx })).lineId
      } catch (e) {
        if (e instanceof AppError) throw new AppError(e.code, e.status, e.message, { ...(e.details as object | undefined), rowIndex })
        throw e
      }
    }

    const out: { id: string; type: DocType; docNo: string; lineIds: string[] }[] = []
    if (semiRows.length) {
      const d = await newDoc('ICS', header.icsNo!)
      const lineIds = []
      for (const [i, r] of semiRows.entries()) lineIds.push(await addLine(d, r.rowIndex, r.row, i + 1))
      out.push({ id: d.id, type: 'ICS', docNo: d.docNo, lineIds })
    }
    for (const [i, p] of parts.entries()) {
      const d = await newDoc('PAR', parNos[i])
      out.push({ id: d.id, type: 'PAR', docNo: d.docNo, lineIds: [await addLine(d, p.rowIndex, p.row, 1)] })
    }
    await audit(tx, ctx, 'issuance.create', 'documents', out.map((d) => d.id).join(','), null,
      { documents: out.map((d) => ({ type: d.type, docNo: d.docNo, rows: d.lineIds.length })), receivedByOfficerId: header.receivedByOfficerId, issuedDate: header.issuedDate })
    return out
  }))

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
