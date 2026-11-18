import { readFile } from 'node:fs/promises'
import { inArray } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { db } from '../db/client.js'
import { documents } from '../db/schema.js'
import { officerReport } from '../db/views.js'
import { AppError } from '../middleware/error.js'
import { filesOf, getPdfFile } from './documentFiles.js'

const todayManila = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })

// Every ICS/PAR of which the officer still holds a property (decision 2026-11-18), in issue order.
export async function officerForms(officerId: string, asAt = todayManila()) {
  const ids = [...new Set((await officerReport(asAt)).filter((r) => r.officerId === officerId).map((r) => r.documentId))]
  if (!ids.length) return []
  const docs = await db.select({ id: documents.id, type: documents.type, docNo: documents.docNo, issuedDate: documents.issuedDate })
    .from(documents).where(inArray(documents.id, ids))
  const files = await filesOf(ids)
  return docs
    .map((d) => ({ ...d, hasPdf: Boolean(files.get(d.id)?.uploaded ?? files.get(d.id)?.generated), signed: Boolean(files.get(d.id)?.uploaded) }))
    .sort((a, b) => a.issuedDate.localeCompare(b.issuedDate) || a.type.localeCompare(b.type) || a.docNo.localeCompare(b.docNo))
}

// All of them as one PDF: each form's signed copy, else its generated one; forms with no PDF are left out.
export async function officerFormsPdf(officerId: string) {
  const forms = (await officerForms(officerId)).filter((f) => f.hasPdf)
  if (!forms.length) throw new AppError('PDF_NOT_FOUND', 404, 'None of this officer’s forms has a PDF yet')
  const out = await PDFDocument.create()
  for (const f of forms) {
    const src = await PDFDocument.load(await readFile((await getPdfFile(f.id)).file), { ignoreEncryption: true })
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page)
  }
  return Buffer.from(await out.save())
}
