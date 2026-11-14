import 'dotenv/config'
import { rmSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { formatPropertyNo, parseSeries } from '@traces/shared'
import { sql } from 'drizzle-orm'
import { db, pool } from '../db/client.js'
import { documents, users } from '../db/schema.js'
import { pdfDir } from '../middleware/upload.js'
import { createIssuance } from '../services/issuances.js'
import { createOfficer } from '../services/officers.js'
import { suggestPropertyNumbers } from '../services/propertyNumbers.js'
import { clearSettingsCache } from '../services/settings.js'

// Sample data for development, modelled on the office's real forms but with made-up people.
// Everything goes through the real issuance service, so the forms are generated and the boxes computed like in the app.
//   npm run seed:dev              adds the samples to an empty database
//   npm run seed:dev -- --more    adds a larger made-up set (officers, 13 issuances) on top of what exists
//   npm run seed:dev -- --reset   first wipes officers, cards, documents, lines, properties and PDFs (users, settings and property types stay)
const { values } = parseArgs({ options: { reset: { type: 'boolean' }, more: { type: 'boolean' } } })
if (process.env.NODE_ENV === 'production') { console.error('seed:dev never runs in production'); process.exit(1) }

const ctx = { actorId: null as string | null, ip: null }
type Officer = { fullName: string; shortName: string; position: string; office: string; designations?: string[] }
type Item = { article: string; model: string; typeId: 1 | 2 | 3; pesos: number; life?: number; parts: string[] } // typeId: 1 ICT, 2 Furniture and Fixtures, 3 Office Equipment

const TYPE_CODE = { 1: 'ICT', 2: 'FF', 3: 'OE' } as const

async function officersFrom(list: Officer[]) {
  const existing = await db.execute(sql`SELECT id, short_name FROM officers`)
  const byShort = new Map<string, string>((existing.rows as { id: string; short_name: string }[]).map((r) => [r.short_name, r.id]))
  for (const o of list) {
    if (!byShort.has(o.shortName)) byShort.set(o.shortName, (await createOfficer({ ...o, canReceive: true, designations: o.designations ?? [] }, ctx)).id)
  }
  return (short: string) => byShort.get(short)!
}

// The card of a model: an existing one by id, or a new one created with the line.
async function cardOf(it: Item, category: 'semi' | 'ppe') {
  const r = await db.execute(sql`SELECT id FROM items WHERE category = ${category} AND property_type_id = ${it.typeId}
    AND lower(article) = lower(${it.article}) AND lower(description) = lower(${it.model})`)
  return r.rows[0]
    ? { itemId: String((r.rows[0] as { id: string }).id) }
    : { new: { propertyTypeId: it.typeId, article: it.article, description: it.model, unit: 'unit' } }
}

// property numbers continue the series of their year + type (the same rule as the app's suggestion)
const nextOf = new Map<string, number>()
async function numbersFor(it: Item, dateAcquired: string) {
  const key = `${dateAcquired.slice(0, 4)}|${it.typeId}`
  if (!nextOf.has(key)) nextOf.set(key, parseSeries((await suggestPropertyNumbers(it.typeId, dateAcquired, 1))[0])!.n)
  const n = nextOf.get(key)!
  nextOf.set(key, n + 1)
  const main = formatPropertyNo({ year: Number(dateAcquired.slice(0, 4)), month: Number(dateAcquired.slice(5, 7)), code: TYPE_CODE[it.typeId], n })
  return [main, ...it.parts.map((_, i) => `${main}${String.fromCharCode(97 + i)}`)]
}

const daysBefore = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)

type Plan = { icsNo?: string; parNo?: string; date: string; to: string; items: Item[]; purpose?: string }

async function issue(admin: string, id: (s: string) => string, plan: Plan, threshold: number) {
  const dateAcquired = daysBefore(plan.date, 10)
  const rows = []
  for (const [n, it] of plan.items.entries()) {
    const cents = it.pesos * 100
    const nos = await numbersFor(it, dateAcquired)
    rows.push({
      line: { qty: 1, unitCostCentavos: cents, description: `${it.article}\n${it.model}`, dateAcquired, ...(it.life ? { estUsefulLifeYears: it.life } : {}) },
      item: await cardOf(it, cents >= threshold ? 'ppe' : 'semi'),
      properties: [
        { propertyNo: nos[0], serialNo: `SN-${plan.date.slice(2, 4)}${plan.date.slice(5, 7)}-${n + 1}` },
        ...it.parts.map((componentLabel, i) => ({ propertyNo: nos[i + 1], componentLabel })),
      ],
    })
  }
  const out = await createIssuance({
    header: {
      receivedByOfficerId: id(plan.to), issuedByOfficerId: id('JDelaCruz'), issuedDate: plan.date, fundCluster: 'RAF',
      purpose: plan.purpose ?? 'Test data', icsNo: plan.icsNo, parNo: plan.parNo,
    },
    rows, generate: true,
  }, { actorId: admin, ip: null })
  if (out.warnings.length) console.warn(`  warnings for ${plan.icsNo ?? plan.parNo}: ${out.warnings.join(', ')}`)
  return { documents: out.documents.length, properties: rows.reduce((n, r) => n + r.properties.length, 0) }
}

async function superadmin() {
  const admin = (await db.select().from(users).where(sql`${users.role} = 'superadmin'`).limit(1))[0]
  if (!admin) { console.error('Create the superadmin first: npm run seed:superadmin'); process.exit(1) }
  ctx.actorId = admin.id
  return admin.id
}

const threshold = async () => Number((await db.execute(sql`SELECT ppe_threshold_centavos FROM settings`)).rows[0]?.ppe_threshold_centavos ?? 5_000_000)

async function setDefaultIssuer(officerId: string) {
  await db.execute(sql`UPDATE settings SET default_issued_by_officer_id = ${officerId} WHERE default_issued_by_officer_id IS NULL`)
  clearSettingsCache()
}

// ───────────── --more: a larger made-up data set for testing screens, cards, reports and exports ─────────────
async function seedMore() {
  const admin = await superadmin()
  if ((await db.select({ id: documents.id }).from(documents).where(sql`${documents.docNo} = '2026-10TEST-001'`)).length) {
    console.error('The --more data is already there (ICS 2026-10TEST-001 exists).'); process.exit(1)
  }
  const id = await officersFrom([
    { fullName: 'Juan Dela Cruz', shortName: 'JDelaCruz', position: 'Administrative Officer V', office: 'Supply Unit' },
    { fullName: 'Maria Santos', shortName: 'MSantos', position: 'ARD for Field Operations', office: 'Field Operations', designations: ['SARAi CENTRO, Focal Person'] },
    { fullName: 'Pedro Reyes', shortName: 'PReyes', position: 'SRS II', office: 'Regional Standards and Testing Laboratory' },
    { fullName: 'Lorna Bautista', shortName: 'LBautista', position: 'Accountant III', office: 'Accounting' },
    { fullName: 'Ramon Garcia', shortName: 'RGarcia', position: 'Engineer III', office: 'Technical Operations', designations: ['SARAi, Coordinator'] },
    { fullName: 'Carla Mendoza', shortName: 'CMendoza', position: 'SRS I', office: 'Planning' },
    { fullName: 'Tomas Villanueva', shortName: 'TVillanueva', position: 'Driver II', office: 'Administrative Unit' },
    { fullName: 'Elena Flores', shortName: 'EFlores', position: 'Cashier II', office: 'Finance' },
    { fullName: 'Danilo Navarro', shortName: 'DNavarro', position: 'Information Systems Analyst II', office: 'ICT Unit' },
  ])
  await setDefaultIssuer(id('JDelaCruz'))

  const semi: Item[] = [
    { article: 'Office chair', model: 'Ergonomic office chair, mesh back', typeId: 2, pesos: 4500, parts: [] },
    { article: 'Desktop computer', model: 'Desktop computer, i5, 16GB RAM, 512GB SSD', typeId: 1, pesos: 38500, life: 5, parts: ['Monitor', 'Keyboard', 'Mouse'] },
    { article: 'Printer', model: 'Inkjet printer, multifunction, wireless', typeId: 1, pesos: 12900, life: 5, parts: [] },
    { article: 'Air conditioner', model: 'Split-type air conditioner, 1.5 HP inverter', typeId: 3, pesos: 32000, life: 10, parts: [] },
    { article: 'Steel cabinet', model: 'Steel filing cabinet, 4-drawer', typeId: 2, pesos: 8800, parts: [] },
    { article: 'Digital camera', model: 'Mirrorless digital camera with 18-55mm lens', typeId: 3, pesos: 27500, life: 5, parts: ['Lens', 'Battery charger'] },
    { article: 'Projector', model: 'LCD projector, 4000 lumens', typeId: 1, pesos: 41200, life: 5, parts: [] },
    { article: 'UPS', model: 'Uninterruptible power supply, 1000VA', typeId: 1, pesos: 6500, life: 5, parts: [] },
    { article: 'Tablet', model: 'Tablet computer, 10.4 inch, 128GB', typeId: 1, pesos: 18900, life: 5, parts: ['Stylus'] },
  ]
  const ppe: Item[] = [
    { article: 'Laptop', model: 'Laptop, i7, 32GB RAM, 1TB SSD, 15.6 inch', typeId: 1, pesos: 72000, life: 5, parts: ['Mouse', 'Laptop bag'] },
    { article: 'Server', model: 'Rack server, 2x Xeon, 128GB RAM', typeId: 1, pesos: 185000, life: 7, parts: ['Rack rails'] },
    { article: 'Generator set', model: 'Diesel generator set, 20 kVA, with ATS', typeId: 3, pesos: 128000, life: 10, parts: [] },
    { article: 'Spectrophotometer', model: 'UV-Vis spectrophotometer, double beam', typeId: 3, pesos: 540000, life: 10, parts: ['Cuvette holder', 'Software dongle'] },
    { article: 'Photocopier', model: 'Multifunction photocopier, A3, with duplex', typeId: 3, pesos: 89500, life: 7, parts: [] },
    { article: 'Pickup truck', model: 'Pickup truck, 4x4, 2.4L diesel', typeId: 3, pesos: 1350000, life: 10, parts: [] },
  ]
  const plans: Plan[] = [
    { icsNo: '2026-10TEST-001', date: '2026-06-03', to: 'LBautista', items: [semi[0], semi[1], semi[7]] },
    { icsNo: '2026-10TEST-002', date: '2026-06-17', to: 'RGarcia', items: [semi[2], semi[4]] },
    { icsNo: '2026-10TEST-003', date: '2026-07-08', to: 'CMendoza', items: [semi[8], semi[0], semi[5]] },
    { icsNo: '2026-10TEST-004', date: '2026-07-22', to: 'EFlores', items: [semi[1], semi[2]] },
    { icsNo: '2026-10TEST-005', date: '2026-08-05', to: 'DNavarro', items: [semi[6], semi[7], semi[8]] },
    { icsNo: '2026-10TEST-006', date: '2026-08-19', to: 'PReyes', items: [semi[3], semi[4]] },
    { icsNo: '2026-10TEST-007', date: '2026-09-02', to: 'MSantos', items: [semi[5], semi[0]] },
    { icsNo: '2026-10TEST-008', date: '2026-09-30', to: 'TVillanueva', items: [semi[4]] },
    { parNo: '2026-10TEST-P01', date: '2026-06-10', to: 'DNavarro', items: [ppe[0], ppe[1]] },
    { parNo: '2026-10TEST-P02', date: '2026-07-15', to: 'PReyes', items: [ppe[3]] },
    { parNo: '2026-10TEST-P03', date: '2026-08-12', to: 'TVillanueva', items: [ppe[5], ppe[2]] },
    // a mixed purchase: one save, one ICS + one PAR for the same receiver
    { icsNo: '2026-10TEST-009', parNo: '2026-10TEST-P04', date: '2026-09-18', to: 'MSantos', items: [ppe[4], ppe[0], semi[2]] },
    { parNo: '2026-10TEST-P05', date: '2026-10-20', to: 'RGarcia', items: [ppe[0]] },
  ]
  const th = await threshold()
  let docs = 0, props = 0
  for (const p of plans) { const r = await issue(admin, id, p, th); docs += r.documents; props += r.properties }
  console.log(`Seeded ${plans.length} issuances (${docs} documents with generated PDFs), ${props} property numbers, 9 officers in all.`)
}

try {
  if (values.more) { await seedMore(); process.exit(0) }
  if (values.reset) {
    await db.execute(sql`UPDATE settings SET default_issued_by_officer_id = NULL`)
    await db.execute(sql`TRUNCATE audit_logs, movements, qr_tokens, properties, line_pdf_regions, document_files, lines, documents, items RESTART IDENTITY CASCADE`)
    await db.execute(sql`DELETE FROM officer_designations`)
    await db.execute(sql`DELETE FROM officers`)
    rmSync(pdfDir(), { recursive: true, force: true })
    clearSettingsCache()
    console.log('Wiped officers, cards, documents, lines, properties and stored PDFs.')
  }
  if ((await db.select({ id: documents.id }).from(documents).limit(1)).length) {
    console.error('Documents already exist. Run with --reset to replace them with the samples.')
    process.exit(1)
  }
  const admin = await superadmin()
  const id = await officersFrom([
    { fullName: 'Juan Dela Cruz', shortName: 'JDelaCruz', position: 'Administrative Officer V', office: 'Supply Unit' },
    { fullName: 'Maria Santos', shortName: 'MSantos', position: 'ARD for Field Operations', office: 'Field Operations', designations: ['SARAi CENTRO, Focal Person'] },
    { fullName: 'Pedro Reyes', shortName: 'PReyes', position: 'SRS II', office: 'Regional Standards and Testing Laboratory' },
  ])
  await setDefaultIssuer(id('JDelaCruz'))
  const th = await threshold()

  // one save: a laptop set and an LCD television (PPE by cost) plus an office chair (semi) -> 1 PAR + 1 ICS
  const a = await issue(admin, id, {
    icsNo: '2026-03SARAi-005', parNo: '2026-05SARAi-001', date: '2026-05-12', to: 'MSantos', purpose: 'ICT equipment for SARAi staff operations',
    items: [
      { article: 'Laptop', model: 'MSI Katana', typeId: 1, pesos: 96450, life: 5, parts: ['Mouse', 'Headset'] },
      { article: 'LCD Television', model: 'SmartboardPH 55 inch', typeId: 1, pesos: 98200, life: 5, parts: [] },
      { article: 'Office chair', model: 'Ergonomic office chair, mesh back', typeId: 2, pesos: 4500, parts: [] },
    ],
  }, th)

  // an old record with a legacy property number and an old date acquired
  const old = await createIssuance({
    header: { receivedByOfficerId: id('PReyes'), issuedByOfficerId: id('JDelaCruz'), issuedDate: '2025-05-31', fundCluster: 'RAF', parNo: '2025-RO-68' },
    rows: [{
      line: { qty: 1, unitCostCentavos: 9_200_000, description: 'Fume hood, fabricated', dateAcquired: '1998-08-10' },
      item: { new: { propertyTypeId: 3, article: 'Fume hood', description: 'Fume hood, fabricated', unit: 'unit' } },
      properties: [{ propertyNo: '1998-05-140-TSE000-RSTL15', oldPropertyNo: '10605140-00-7' }],
    }],
    generate: true,
  }, { actorId: admin, ip: null })

  console.log(`Seeded 3 officers, ${a.documents + old.documents.length} documents (${a.properties + 1} property numbers) with generated PDFs.`)
} finally {
  await pool.end()
}
