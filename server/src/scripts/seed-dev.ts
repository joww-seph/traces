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
import { createCount, patchCount, patchItem } from '../services/counts.js'
import { createLine } from '../services/lines.js'
import { createOfficer } from '../services/officers.js'

// Sample data for development, modelled on the office's real forms but with made-up people.
//   npm run seed:dev              adds the samples to an empty database
//   npm run seed:dev -- --more    adds a larger made-up set (officers, 13 documents, 2 counts) on top of what exists
//   npm run seed:dev -- --reset   first wipes officers, documents, lines, properties, counts and PDFs (users and settings stay)
const { values } = parseArgs({ options: { reset: { type: 'boolean' }, more: { type: 'boolean' } } })
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

// ───────────── --more: a larger made-up data set for testing screens, counts and exports ─────────────
async function seedMore() {
  const admin = (await db.select().from(users).where(sql`${users.role} = 'superadmin'`).limit(1))[0]
  if (!admin) { console.error('Create the superadmin first: npm run seed:superadmin'); process.exit(1) }
  ctx.actorId = admin.id
  if ((await db.select({ id: documents.id }).from(documents).where(sql`${documents.docNo} = '2026-10TEST-001'`)).length) {
    console.error('The --more data is already there (ICS 2026-10TEST-001 exists).'); process.exit(1)
  }

  const people = [
    ['Juan Dela Cruz', 'JDelaCruz', 'Administrative Officer V', 'Supply Unit'],
    ['Maria Santos', 'MSantos', 'ARD for Field Operations', 'Field Operations'],
    ['Pedro Reyes', 'PReyes', 'SRS II', 'Regional Standards and Testing Laboratory'],
    ['Lorna Bautista', 'LBautista', 'Accountant III', 'Accounting'],
    ['Ramon Garcia', 'RGarcia', 'Engineer III', 'Technical Operations'],
    ['Carla Mendoza', 'CMendoza', 'SRS I', 'Planning'],
    ['Tomas Villanueva', 'TVillanueva', 'Driver II', 'Administrative Unit'],
    ['Elena Flores', 'EFlores', 'Cashier II', 'Finance'],
    ['Danilo Navarro', 'DNavarro', 'Information Systems Analyst II', 'ICT Unit'],
  ] as const
  const existing = await db.execute(sql`SELECT id, short_name FROM officers`)
  const byShort = new Map<string, string>((existing.rows as { id: string; short_name: string }[]).map((r) => [r.short_name, r.id]))
  for (const [fullName, shortName, position, office] of people) {
    if (!byShort.has(shortName)) byShort.set(shortName, (await createOfficer({ fullName, shortName, position, office }, ctx)).id)
  }
  const id = (short: string) => byShort.get(short)!

  // [article, description, unit cost in pesos, life in years, component labels]
  type Item = [string, string, number, number | undefined, string[]]
  const semi: Item[] = [
    ['Office chair', 'Ergonomic office chair, mesh back', 4500, undefined, []],
    ['Desktop computer', 'Desktop computer, i5, 16GB RAM, 512GB SSD', 38500, 5, ['Monitor', 'Keyboard', 'Mouse']],
    ['Printer', 'Inkjet printer, multifunction, wireless', 12900, 5, []],
    ['Air conditioner', 'Split-type air conditioner, 1.5 HP inverter', 32000, 10, []],
    ['Steel cabinet', 'Steel filing cabinet, 4-drawer', 8800, undefined, []],
    ['Digital camera', 'Mirrorless digital camera with 18-55mm lens', 27500, 5, ['Lens', 'Battery charger']],
    ['Projector', 'LCD projector, 4000 lumens', 41200, 5, []],
    ['UPS', 'Uninterruptible power supply, 1000VA', 6500, 5, []],
    ['Tablet', 'Tablet computer, 10.4 inch, 128GB', 18900, 5, ['Stylus']],
  ]
  const ppe: Item[] = [
    ['Laptop', 'Laptop, i7, 32GB RAM, 1TB SSD, 15.6 inch', 72000, 5, ['Mouse', 'Laptop bag']],
    ['Server', 'Rack server, 2x Xeon, 128GB RAM', 185000, 7, ['Rack rails']],
    ['Generator set', 'Diesel generator set, 20 kVA, with ATS', 128000, 10, []],
    ['Spectrophotometer', 'UV-Vis spectrophotometer, double beam', 540000, 10, ['Cuvette holder', 'Software dongle']],
    ['Photocopier', 'Multifunction photocopier, A3, with duplex', 89500, 7, []],
    ['Pickup truck', 'Pickup truck, 4x4, 2.4L diesel, plate NAB 4521', 1350000, 10, []],
  ]

  // property numbers like 2026-10ICT-0001: one running counter per prefix; components get a letter suffix
  const counter = new Map<string, number>()
  const nextNo = (prefix: string) => { const n = (counter.get(prefix) ?? 0) + 1; counter.set(prefix, n); return `2026-10${prefix}-${String(n).padStart(4, '0')}` }
  const prefixFor = (a: string) => (/computer|laptop|server|tablet|printer|ups|projector/i.test(a) ? 'ICT' : /camera|spectro/i.test(a) ? 'EQP' : /truck/i.test(a) ? 'VEH' : 'OFC')

  type Plan = { type: 'ICS' | 'PAR'; docNo: string; date: string; to: string; items: Item[] }
  const plans: Plan[] = [
    { type: 'ICS', docNo: '2026-10TEST-001', date: '2026-06-03', to: 'LBautista', items: [semi[0], semi[1], semi[7]] },
    { type: 'ICS', docNo: '2026-10TEST-002', date: '2026-06-17', to: 'RGarcia', items: [semi[2], semi[4]] },
    { type: 'ICS', docNo: '2026-10TEST-003', date: '2026-07-08', to: 'CMendoza', items: [semi[8], semi[0], semi[5]] },
    { type: 'ICS', docNo: '2026-10TEST-004', date: '2026-07-22', to: 'EFlores', items: [semi[1], semi[2]] },
    { type: 'ICS', docNo: '2026-10TEST-005', date: '2026-08-05', to: 'DNavarro', items: [semi[6], semi[7], semi[8]] },
    { type: 'ICS', docNo: '2026-10TEST-006', date: '2026-08-19', to: 'PReyes', items: [semi[3], semi[4]] },
    { type: 'ICS', docNo: '2026-10TEST-007', date: '2026-09-02', to: 'MSantos', items: [semi[5], semi[0]] },
    { type: 'ICS', docNo: '2026-10TEST-008', date: '2026-09-30', to: 'TVillanueva', items: [semi[4]] },
    { type: 'PAR', docNo: '2026-10TEST-P01', date: '2026-06-10', to: 'DNavarro', items: [ppe[0], ppe[1]] },
    { type: 'PAR', docNo: '2026-10TEST-P02', date: '2026-07-15', to: 'PReyes', items: [ppe[3]] },
    { type: 'PAR', docNo: '2026-10TEST-P03', date: '2026-08-12', to: 'TVillanueva', items: [ppe[5], ppe[2]] },
    { type: 'PAR', docNo: '2026-10TEST-P04', date: '2026-09-18', to: 'MSantos', items: [ppe[4], ppe[0]] },
    { type: 'PAR', docNo: '2026-10TEST-P05', date: '2026-10-20', to: 'RGarcia', items: [ppe[0]] },
  ]

  let props = 0
  for (const plan of plans) {
    const form = await formPdf(plan.type === 'ICS' ? 'INVENTORY CUSTODIAN SLIP' : 'PROPERTY ACKNOWLEDGMENT RECEIPT', ['Qty', 'Unit', 'Unit cost', 'Description'],
      plan.items.map(([a, , cost]) => ['1', 'unit', cost.toLocaleString('en-US', { minimumFractionDigits: 2 }), a]))
    const doc = await createDocument({
      type: plan.type, docNo: plan.docNo, fundCluster: 'RAF', issuedDate: plan.date, purpose: 'Test data',
      issuedByOfficerId: id('JDelaCruz'), receivedByOfficerId: id(plan.to),
    }, form.file, admin.id, ctx)
    for (const [n, [article, description, cost, life, parts]] of plan.items.entries()) {
      const main = nextNo(prefixFor(article))
      await createLine(doc.id, {
        line: { qty: 1, unit: 'unit', unitCostCentavos: cost * 100, article, description, ...(life ? { estUsefulLifeYears: life } : {}) },
        region: form.boxes[n],
        properties: [
          { propertyNo: main, serialNo: `SN-${plan.docNo.slice(-3)}-${n + 1}` },
          ...parts.map((label, i) => ({ propertyNo: `${main}${String.fromCharCode(97 + i)}`, componentLabel: label })),
        ],
      }, ctx)
      props += 1 + parts.length
    }
  }

  // two counts: a closed PPE count for the ICT officer (one item missing) and an open semi count for the accountant
  const countRows = async (countId: string, limit = 1000) =>
    (await db.execute(sql`SELECT p.property_no FROM count_items ci JOIN properties p ON p.id = ci.property_id WHERE ci.count_id = ${countId} ORDER BY 1 LIMIT ${limit}`)).rows as { property_no: string }[]
  const closed = await createCount({ category: 'ppe', typeLabel: 'ICT Equipment', asAt: '2026-10-31', fundCluster: 'RAF', officerId: id('DNavarro'), signatories: [] }, admin.id, ctx)
  for (const [i, r] of (await countRows(closed.id)).entries()) await patchItem(closed.id, r.property_no, { qtyOnHand: i === 0 ? 0 : 1, remarks: i === 0 ? 'Not found during the count' : null }, ctx)
  await patchCount(closed.id, { status: 'closed' }, ctx)
  const open = await createCount({ category: 'semi', typeLabel: 'Office equipment', asAt: '2026-11-14', fundCluster: 'RAF', officerId: id('LBautista'), signatories: [] }, admin.id, ctx)
  for (const r of await countRows(open.id, 2)) await patchItem(open.id, r.property_no, { qtyOnHand: 1 }, ctx)

  console.log(`Seeded ${plans.length} documents (8 ICS, 5 PAR), ${props} property numbers, ${people.length} officers in all, 1 closed count and 1 open count.`)
}

try {
  if (values.more) { await seedMore(); process.exit(0) }
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
