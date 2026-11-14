import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { sql } from 'drizzle-orm'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { db, pool } from '../db/client.js'
import { documents, users } from '../db/schema.js'
import { pdfDir } from '../middleware/upload.js'
import { createDocument, type DocFile } from '../services/documents.js'
import { createLine } from '../services/lines.js'
import { createOfficer } from '../services/officers.js'

// Sample data for development, modelled on the office's real forms but with made-up people.
//   npm run seed:dev              adds the samples to an empty database
//   npm run seed:dev -- --reset   first wipes officers, documents, lines, properties, counts and PDFs (users and settings stay)
const { values } = parseArgs({ options: { reset: { type: 'boolean' } } })
if (process.env.NODE_ENV === 'production') { console.error('seed:dev never runs in production'); process.exit(1) }

const ctx = { actorId: null as string | null, ip: null }

// A one-page form with a table; returns the stored PDF plus each row's box as fractions of the page.
async function formPdf(title: string, headers: string[], rows: string[][]) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595, 842])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  page.drawText(title, { x: 50, y: 790, size: 15, font: bold })
  page.drawText('Entity Name: DEPARTMENT OF SCIENCE AND TECHNOLOGY - REGION 1', { x: 50, y: 765, size: 9, font })
  const top = 720, rowH = 34
  headers.forEach((h, i) => page.drawText(h, { x: 55 + i * (485 / headers.length), y: top, size: 8, font: bold }))
  const boxes = rows.map((r, n) => {
    const y = top - 14 - (n + 1) * rowH
    page.drawRectangle({ x: 50, y, width: 495, height: rowH, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 0.5 })
    r.forEach((c, i) => page.drawText(c, { x: 55 + i * (485 / headers.length), y: y + 13, size: 8, font }))
    return { page: 1, x: 50 / 595, y: (842 - (y + rowH)) / 842, w: 495 / 595, h: rowH / 842 }
  })
  const bytes = await pdf.save()
  const storedName = `${randomUUID()}.pdf`
  mkdirSync(pdfDir(), { recursive: true })
  writeFileSync(path.join(pdfDir(), storedName), bytes)
  const file: DocFile = { storedName, originalName: `${title.toLowerCase().replace(/\W+/g, '-')}.pdf`, size: bytes.length, pageCount: 1 }
  return { file, boxes }
}

try {
  if (values.reset) {
    await db.execute(sql`TRUNCATE audit_logs, count_items, count_signatories, physical_counts, movements, qr_tokens, properties, line_pdf_regions, lines, documents, officers RESTART IDENTITY CASCADE`)
    rmSync(pdfDir(), { recursive: true, force: true })
    console.log('Wiped officers, documents, lines, properties, counts and stored PDFs.')
  }
  if ((await db.select({ id: documents.id }).from(documents).limit(1)).length) {
    console.error('Documents already exist. Run with --reset to replace them with the samples.')
    process.exit(1)
  }
  const admin = (await db.select().from(users).where(sql`${users.role} = 'superadmin'`).limit(1))[0]
  if (!admin) { console.error('Create the superadmin first: npm run seed:superadmin'); process.exit(1) }
  ctx.actorId = admin.id

  const supply = await createOfficer({ fullName: 'Juan Dela Cruz', shortName: 'JDelaCruz', position: 'Administrative Officer V', office: 'Supply Unit' }, ctx)
  const eng = await createOfficer({ fullName: 'Maria Santos', shortName: 'MSantos', position: 'ARD for Field Operations', office: 'Field Operations' }, ctx)
  const lab = await createOfficer({ fullName: 'Pedro Reyes', shortName: 'PReyes', position: 'SRS II', office: 'Regional Standards and Testing Laboratory' }, ctx)

  // ICS 2026-03SARAi-005: a laptop set (main unit + mouse + headset, PPE by cost) and an LCD television
  const ics = await formPdf('INVENTORY CUSTODIAN SLIP', ['Qty', 'Unit', 'Unit cost', 'Total cost', 'Description', 'Item no.', 'Life'], [
    ['1', 'unit', '96,450.00', '96,450.00', 'Laptop Unit, MSI Katana', '2026-09ICT-0199 / a / b', '5'],
    ['1', 'unit', '98,200.00', '98,200.00', 'LCD TELEVISION SmartboardPH', '2026-09ICT-202', '5'],
  ])
  const icsDoc = await createDocument({
    type: 'ICS', docNo: '2026-03SARAi-005', fundCluster: 'RAF', issuedDate: '2026-05-12', purpose: 'ICT equipment for SARAi staff operations',
    issuedByOfficerId: supply.id, receivedByOfficerId: eng.id,
  }, ics.file, admin.id, ctx)
  await createLine(icsDoc.id, {
    line: { qty: 1, unit: 'unit', unitCostCentavos: 9645000, article: 'Laptop', description: 'Laptop Unit, MSI Katana\nSpecification:\n- Processors: 16 Cores\n- Memory: 16GB', estUsefulLifeYears: 5 },
    region: ics.boxes[0],
    properties: [
      { propertyNo: '2026-09ICT-0199', serialNo: 'K2507N0078345' },
      { propertyNo: '2026-09ICT-0199a', componentLabel: 'Mouse' },
      { propertyNo: '2026-09ICT-0199b', componentLabel: 'Headset' },
    ],
  }, ctx)
  await createLine(icsDoc.id, {
    line: { qty: 1, unit: 'unit', unitCostCentavos: 9820000, article: 'LCD Television', description: 'LCD TELEVISION\nBrand: SmartboardPH\nS/N: CORE55-2026-018-01', estUsefulLifeYears: 5 },
    region: ics.boxes[1],
    properties: [{ propertyNo: '2026-09ICT-202', serialNo: 'CORE55-2026-018-01' }],
  }, ctx)

  // PAR 2025-RO-68: a fume hood bought in 1998, carrying its old property number
  const par = await formPdf('PROPERTY ACKNOWLEDGMENT RECEIPT', ['Qty', 'Unit', 'Description', 'Property number', 'Date acquired', 'Amount'], [
    ['1', 'unit', 'Fume hood, fabricated', '1998-05-140-TSE000-RSTL15', 'August 10, 1998', '92,000.00'],
  ])
  const parDoc = await createDocument({
    type: 'PAR', docNo: '2025-RO-68', fundCluster: 'RAF', issuedDate: '2025-05-31',
    issuedByOfficerId: supply.id, receivedByOfficerId: lab.id,
  }, par.file, admin.id, ctx)
  await createLine(parDoc.id, {
    line: { qty: 1, unit: 'unit', unitCostCentavos: 9200000, article: 'Fume hood', description: 'Fume hood, fabricated', dateAcquired: '1998-08-10' },
    region: par.boxes[0],
    properties: [{ propertyNo: '1998-05-140-TSE000-RSTL15', oldPropertyNo: '10605140-00-7' }],
  }, ctx)

  console.log('Seeded 3 officers, ICS 2026-03SARAi-005 (2 lines, 4 property numbers) and PAR 2025-RO-68 (1 line).')
} finally {
  await pool.end()
}
