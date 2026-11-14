import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { documentFiles, documents, items, linePdfRegions, lines, officers, properties } from '../db/schema.js'
import { renderIcsPar, type FormFonts } from '../forms/icsPar.js'
import { AppError } from '../middleware/error.js'
import { pdfDir, removePdf } from '../middleware/upload.js'
import { audit, type Ctx } from './audit.js'
import { assertNotSigned, filesOf, filesSummary } from './documentFiles.js'
import { getSettings } from './settings.js'

// Fonts ship with the app (server/assets/fonts); the same relative path works from src/ and from the bundled dist/.
const FONT_DIRS = [new URL('../../assets/fonts/', import.meta.url), new URL('../assets/fonts/', import.meta.url)].map((u) => fileURLToPath(u))
let cached: FormFonts | null = null
export function loadFonts(): FormFonts {
  if (cached) return cached
  const dir = FONT_DIRS.find((d) => existsSync(path.join(d, 'DejaVuSansCondensed.ttf')))
  if (!dir) throw new Error('The form fonts are missing (server/assets/fonts)')
  return (cached = {
    regular: readFileSync(path.join(dir, 'DejaVuSansCondensed.ttf')),
    bold: readFileSync(path.join(dir, 'DejaVuSansCondensed-Bold.ttf')),
  })
}

// Renders the document as the official form (Appendix 59 / 71) and stores it as its `generated` PDF, with the box
// of every line computed from the layout. Generating again replaces the file and the boxes. Refused once signed.
export async function generateDocument(documentId: string, ctx: Ctx, render: typeof renderIcsPar = renderIcsPar) {
  if (!ctx.actorId) throw new AppError('FORBIDDEN', 403, 'A signed-in user is required')
  const userId = ctx.actorId
  const doc = (await db.select().from(documents).where(and(eq(documents.id, documentId), isNull(documents.deletedAt))))[0]
  if (!doc) throw new AppError('DOCUMENT_NOT_FOUND', 404, 'Document not found')
  await assertNotSigned(db, documentId)

  const s = await getSettings()
  const lineRows = await db.select({ line: lines, unit: items.unit }).from(lines).innerJoin(items, eq(items.id, lines.itemId))
    .where(and(eq(lines.documentId, documentId), isNull(lines.deletedAt))).orderBy(asc(lines.lineNo))
  if (!lineRows.length) throw new AppError('NO_LINES', 400, 'Add at least one line before generating the form')
  const props = await db.select().from(properties)
    .where(and(inArray(properties.lineId, lineRows.map((l) => l.line.id)), isNull(properties.voidedAt))).orderBy(asc(properties.propertyNo))
  const names = new Map((await db.select({ id: officers.id, name: officers.fullName }).from(officers)
    .where(inArray(officers.id, [doc.issuedByOfficerId, doc.receivedByOfficerId]))).map((o) => [o.id, o.name]))

  const code = doc.type === 'ICS' ? `${s.icsFormCode}  ${s.icsFormRevision}` : `${s.parFormCode}  ${s.parFormRevision}`
  const { bytes, pageCount, regions } = await render({
    type: doc.type, docNo: doc.docNo, entityName: s.entityName, fundCluster: doc.fundCluster, formCode: code, issuedDate: doc.issuedDate,
    from: { name: names.get(doc.issuedByOfficerId) ?? '', position: doc.issuedByPosition },
    to: { name: names.get(doc.receivedByOfficerId) ?? '', position: doc.receivedByPosition },
    lines: lineRows.map(({ line, unit }) => ({
      lineId: line.id, qty: line.qty, unit, unitCostCentavos: line.unitCostCentavos, description: line.description,
      // the main unit first, then its components (a set stacks all its numbers in one cell)
      itemNos: props.filter((p) => p.lineId === line.id).sort((a, b) => Number(!!a.componentLabel) - Number(!!b.componentLabel) || a.propertyNo.localeCompare(b.propertyNo)).map((p) => p.propertyNo),
      life: line.estUsefulLifeYears, dateAcquired: line.dateAcquired,
    })),
  }, loadFonts())

  const storedName = `${randomUUID()}.pdf`
  await mkdir(pdfDir(), { recursive: true })
  await writeFile(path.join(pdfDir(), storedName), bytes)
  await chmod(path.join(pdfDir(), storedName), 0o600).catch(() => {})

  try {
    const old = await db.transaction(async (tx) => {
      await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, documentId)).for('update')
      await assertNotSigned(tx, documentId) // re-checked under the lock: a scan may have been uploaded meanwhile
      const previous = (await filesOf([documentId], tx)).get(documentId)!.generated
      await tx.delete(documentFiles).where(and(eq(documentFiles.documentId, documentId), eq(documentFiles.kind, 'generated')))
      await tx.insert(documentFiles).values({ documentId, kind: 'generated', storedName, originalName: null, sizeBytes: bytes.length, pageCount, createdBy: userId })
      await tx.delete(linePdfRegions).where(and(eq(linePdfRegions.kind, 'generated'), inArray(linePdfRegions.lineId, tx.select({ id: lines.id }).from(lines).where(eq(lines.documentId, documentId)))))
      await tx.insert(linePdfRegions).values(regions.map((r) => ({ lineId: r.lineId, kind: 'generated' as const, page: r.page, x: String(r.x), y: String(r.y), w: String(r.w), h: String(r.h) })))
      await audit(tx, ctx, 'document.generate', 'documents', documentId, null, { pageCount, lines: regions.length })
      return previous?.storedName ?? null
    })
    if (old) await removePdf(old) // a generated copy is reproducible, so the replaced one is not archived
  } catch (e) {
    await removePdf(storedName)
    throw e
  }
  return filesSummary((await filesOf([documentId])).get(documentId)!)
}
