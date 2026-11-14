// Walks through TRACES like a new user and saves an annotated screenshot of every step.
// Needs the demo servers (made-up data only): API on :3200 against traces_manual, client on :5373. See scripts/manual/README.md.
//   node scripts/manual/capture.mjs  ->  docs/manual/shots/*.png + docs/manual/shots/steps.json
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const BASE = process.env.MANUAL_BASE ?? 'http://localhost:5373'
const OUT = path.resolve('docs/manual/shots')
const SUPPLY = { email: 'jdelacruz@region1.dost.gov.ph', password: 'Manual-Supply-2026' }
const ADMIN = { email: 'it@region1.dost.gov.ph', password: 'Manual-Admin-2026' }

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const slides = [] // { section, title, image, phone, steps: string[], note }
const issues = [] // problems seen while crawling
let count = 0

// Draws numbered red boxes with arrows over the given elements (viewport coordinates).
async function overlay(page, boxes, prefer) {
  await page.evaluate(([boxes, prefer]) => {
    document.getElementById('manual-overlay')?.remove()
    const W = window.innerWidth, H = window.innerHeight
    const root = document.createElement('div')
    root.id = 'manual-overlay'
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('width', W); svg.setAttribute('height', H)
    svg.style.cssText = 'position:absolute;inset:0'
    svg.innerHTML = '<defs><marker id="mh" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#E0102F"/></marker></defs>'
    root.appendChild(svg)
    const pad = 4
    const rects = boxes.map((b) => {
      const x = Math.max(2, b.x - pad), y = Math.max(2, b.y - pad)
      return { x, y, w: Math.min(W - x - 2, b.w + pad * 2), h: Math.min(H - y - 2, b.h + pad * 2) }
    })
    const inside = (px, py, r, m) => px > r.x - m && px < r.x + r.w + m && py > r.y - m && py < r.y + r.h + m
    const tails = []
    rects.forEach((r, i) => {
      const box = document.createElement('div')
      box.style.cssText = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;border:3px solid #E0102F;border-radius:6px;box-sizing:border-box`
      root.appendChild(box)
      // the number goes where there is room: not on another box, not on another number, inside the screen
      const cy = r.y + Math.min(r.h / 2, 30), cx = r.x + Math.min(r.w / 2, 90)
      const left = [[r.x - 80, cy - 45], [r.x - 80, cy + 45], [r.x - 130, cy], [r.x - 190, cy - 20]]
      const right = [[r.x + r.w + 80, cy - 45], [r.x + r.w + 80, cy + 45], [r.x + r.w + 130, cy]]
      const above = [[cx - 50, r.y - 60], [cx + 50, r.y - 60]]
      const below = [[cx, r.y + r.h + 60], [cx + 70, r.y + r.h + 60], [cx - 70, r.y + r.h + 60]]
      const cands = prefer === 'right' ? [...right, ...below, ...above, ...left]
        : r.y < 130 ? [...below, ...left, ...right, ...above] // near the top of the screen: point up from below
          : [...left, ...above, ...right, ...below]
      const fits = ([px, py]) => px > 22 && px < W - 22 && py > 22 && py < H - 22
      const ok = (c) => fits(c) && rects.every((o) => !inside(c[0], c[1], o, 18)) && tails.every((t) => Math.hypot(t[0] - c[0], t[1] - c[1]) > 40)
      const [tx, ty] = cands.find(ok) ?? cands.find(fits) ?? [r.x + 20, r.y + 20]
      tails.push([tx, ty])
      // the arrow points at the nearest point of the box edge
      const hx = Math.min(Math.max(tx, r.x), r.x + r.w), hy = Math.min(Math.max(ty, r.y), r.y + r.h)
      const d = Math.hypot(hx - tx, hy - ty) || 1
      const sx = tx + ((hx - tx) / d) * 17, sy = ty + ((hy - ty) / d) * 17
      const ex = hx - ((hx - tx) / d) * 4, ey = hy - ((hy - ty) / d) * 4
      if (d > 24) {
        const line = document.createElementNS(ns, 'line')
        line.setAttribute('x1', sx); line.setAttribute('y1', sy); line.setAttribute('x2', ex); line.setAttribute('y2', ey)
        line.setAttribute('stroke', '#E0102F'); line.setAttribute('stroke-width', '4'); line.setAttribute('marker-end', 'url(#mh)')
        svg.appendChild(line)
      }
      const badge = document.createElement('div')
      badge.textContent = String(i + 1)
      badge.style.cssText = `position:absolute;left:${tx - 15}px;top:${ty - 15}px;width:30px;height:30px;border-radius:50%;background:#E0102F;color:#fff;font:bold 17px Arial,sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px #fff`
      root.appendChild(badge)
    })
    document.body.appendChild(root)
  }, [boxes, prefer])
}

async function boxOf(page, loc) {
  const l = typeof loc === 'string' ? page.locator(loc).first() : loc.first()
  await l.waitFor({ state: 'visible', timeout: 15000 })
  const b = await l.boundingBox()
  if (!b) throw new Error(`no box for ${loc}`)
  return { x: b.x, y: b.y, w: b.width, h: b.height }
}

// One slide: marks[i] is the element for step i+1 (or null for a step without a mark).
async function shot(page, { section, title, steps, marks = [], note, scrollTo, phone = false, prefer }) {
  if (scrollTo) {
    const l = typeof scrollTo === 'string' ? page.locator(scrollTo).first() : scrollTo.first()
    await l.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
    await page.evaluate(() => window.scrollBy({ top: -70, behavior: 'instant' }))
  }
  await page.waitForTimeout(500)
  // wait until nothing moves any more (smooth scrolling, pages still drawing)
  let boxes = []
  for (let tries = 0; tries < 8; tries++) {
    const now = []
    for (const m of marks) if (m) now.push(await boxOf(page, m))
    const same = JSON.stringify(now) === JSON.stringify(boxes)
    boxes = now
    if (same) break
    await page.waitForTimeout(300)
  }
  // everything marked must be on screen: scroll down when the last mark is below the fold
  const H = page.viewportSize().height
  const bottom = Math.max(0, ...boxes.map((b) => b.y + b.h)), top = Math.min(H, ...boxes.map((b) => b.y))
  if (bottom > H - 20 && top > 60) {
    await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: 'instant' }), Math.min(bottom - H + 40, top - 40))
    await page.waitForTimeout(300)
    boxes = []
    for (const m of marks) if (m) boxes.push(await boxOf(page, m))
  }
  await overlay(page, boxes, prefer)
  const image = `${String(++count).padStart(3, '0')}.png`
  await page.screenshot({ path: path.join(OUT, image) })
  await page.evaluate(() => document.getElementById('manual-overlay')?.remove())
  slides.push({ section, title, image, phone, steps, note })
  console.log(`${image}  ${section} / ${title}`)
}

function watch(page, label) {
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) issues.push(`${label} console: ${m.text().slice(0, 200)} @ ${page.url()}`) })
  page.on('pageerror', (e) => issues.push(`${label} page error: ${e.message} @ ${page.url()}`))
  page.on('response', (r) => {
    const u = r.url()
    if (r.status() >= 500 && u.includes('/api/')) issues.push(`${label} HTTP ${r.status()} ${r.request().method()} ${u} @ ${page.url()}`)
  })
}

async function login(page, who) {
  await page.goto(`${BASE}/login`)
  await page.locator('#email').fill(who.email)
  await page.locator('#password').fill(who.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
}

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
watch(page, 'desktop')
const row = (n) => page.getByRole('group', { name: `Row ${n}` })
const S = {
  start: 'Getting started', officers: 'People and property types', issue: 'Entering an issuance', docs: 'ICS and PAR documents',
  cards: 'Cards, registry and property', reports: 'Reports', stickers: 'QR stickers', scan: 'Scanning a sticker', admin: 'Administration', account: 'Your account',
}

// ───────────── Getting started ─────────────
await page.goto(`${BASE}/login`)
await page.locator('#email').fill(SUPPLY.email)
await page.locator('#password').fill(SUPPLY.password)
await shot(page, {
  section: S.start, title: 'Sign in',
  steps: ['Type the email address the IT administrator gave you.', 'Type your password. Click the eye icon to see what you typed.', 'Click Sign in.'],
  marks: ['#email', '#password', page.getByRole('button', { name: 'Sign in' })],
  note: 'Forgot your password? Ask the ITSM Unit. There is no "reset my password" link on purpose.',
})
await page.getByRole('button', { name: 'Sign in' }).click()
await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
await shot(page, {
  section: S.start, title: 'The dashboard: where every day starts',
  steps: [
    'The menu. It is always on the left. Click a name to open that page.',
    'Shortcuts. Each box shows a count and opens its page when clicked.',
    'New issuance: start here whenever property is handed to someone.',
    'The amounts of semi-expendable property and of property, plant and equipment (PPE) on record.',
  ],
  marks: ['nav[aria-label="Main"]', 'section[aria-label="Shortcuts"]', page.getByRole('link', { name: 'New issuance' }).nth(1), 'section[aria-label="Totals"]'],
})
await shot(page, {
  section: S.start, title: 'What each menu item is for',
  steps: [
    'Dashboard: totals and shortcuts.',
    'New issuance: record property given to an officer. TRACES makes the ICS or PAR for you.',
    'ICS and PAR: every slip and receipt, printed or signed.',
    'Cards: one property card per model (SPC or PC).',
    'Registry: the registry of property issued (RegSPI and the PPE registry).',
    'Reports: what one officer holds on a date (RPCSP or RPCPPE), for the physical count.',
    'Stickers: print QR stickers.',
    'Officers and Property types: the lists the forms pick from.',
  ],
  marks: [
    page.getByRole('link', { name: 'Dashboard' }), page.getByRole('link', { name: 'New issuance' }).first(), page.getByRole('link', { name: 'ICS and PAR' }),
    page.getByRole('link', { name: 'Cards', exact: true }), page.getByRole('link', { name: 'Registry' }), page.getByRole('link', { name: 'Reports' }),
    page.getByRole('link', { name: 'Stickers' }), page.getByRole('link', { name: 'Officers' }),
  ],
  prefer: 'right',
})

// ───────────── Officers and property types ─────────────
await page.goto(`${BASE}/officers`)
await shot(page, {
  section: S.officers, title: 'Officers: the people who issue and receive property',
  steps: ['Click Add officer to add a person.', 'Type a name or a program (for example SARAi) to find someone.', 'Edit changes a person; Deactivate hides them from new forms but keeps their records.'],
  marks: [page.getByRole('button', { name: 'Add officer' }), page.getByLabel('Search officers'), page.getByRole('button', { name: 'Edit' }).first()],
})
await page.getByRole('button', { name: 'Add officer' }).click()
const dlg = page.getByRole('dialog')
await dlg.locator('#o-fullName').fill('Rosa M. Lim')
await dlg.locator('#o-position').fill('Science Research Specialist II')
await dlg.locator('#o-office').fill('Provincial S&T Center')
await dlg.locator('#o-designations').fill('SETUP, Project Assistant')
await shot(page, {
  section: S.officers, title: 'Adding an officer',
  steps: [
    'Full name, as it should be printed on forms.',
    'The short name is made for you from the name (Rosa M. Lim becomes RMLim).',
    'Position: printed under the name on the ICS and PAR (you can still change it on each form).',
    'Programs and projects, one per line. Searching for a program finds this person.',
    'Leave "Can receive property" ticked for anyone who will sign as "Received by".',
    'Click Add officer to save.',
  ],
  marks: [dlg.locator('#o-fullName'), dlg.locator('#o-shortName'), dlg.locator('#o-position'), dlg.locator('#o-designations'), dlg.getByText('Can receive property'), dlg.getByRole('button', { name: 'Add officer' })],
})
await dlg.getByRole('button', { name: 'Add officer' }).click()
await dlg.waitFor({ state: 'hidden' })
await page.getByLabel('Search officers').fill('SARAi')
await page.waitForTimeout(800)
await shot(page, {
  section: S.officers, title: 'Finding an officer by program',
  steps: ['Typing a program name lists everyone working on it.', 'The programs are shown under each position.'],
  marks: [page.getByLabel('Search officers'), page.getByRole('row').nth(1)],
})
await page.goto(`${BASE}/property-types`)
await shot(page, {
  section: S.officers, title: 'Property types',
  steps: [
    'The code is the letters inside every property number, like ICT in 2026-11ICT-0005.',
    'Add type when the COA list has a kind of property that is not here yet.',
    'Deactivate a type that should no longer be used for new property.',
  ],
  marks: [page.getByRole('cell', { name: 'ICT', exact: true }), page.getByRole('button', { name: 'Add type' }), page.getByRole('button', { name: 'Deactivate' }).first()],
})

// ───────────── New issuance ─────────────
await page.goto(`${BASE}/issue`)
await shot(page, {
  section: S.issue, title: 'New issuance: the four parts of the form',
  steps: [
    'Part 1, Property card: one row for each model you are handing over.',
    'Each row is a box like this one. You can add as many rows as you need.',
    'Parts 2 to 4 are further down: Registry (who receives it), Report (a preview) and ICS/PAR (the slip numbers).',
  ],
  marks: [page.getByRole('heading', { name: '1. Property card' }), row(1), null],
  note: 'Nothing is saved until you press a Save button at the bottom. If the page is closed by accident, your typing is kept on this computer and comes back when you open the form again.',
})
await shot(page, {
  section: S.issue, title: 'Step 1: choose the card (the model)',
  steps: ['If this model was issued before, type part of its name here and pick it from the list.', 'If it is a new model, click New card.'],
  marks: [row(1).getByLabel('Row 1, search cards'), row(1).getByRole('button', { name: 'New card' })],
})
await row(1).getByRole('button', { name: 'New card' }).click()
await row(1).getByLabel('Row 1, property type', { exact: true }).selectOption({ label: 'ICT · Information and Communications Technology Equipment' })
await row(1).getByLabel('Row 1, article', { exact: true }).fill('Laptop')
await row(1).getByLabel('Row 1, model', { exact: true }).fill('Acer TravelMate P2')
await row(1).getByLabel('Row 1, unit', { exact: true }).fill('unit')
await shot(page, {
  section: S.issue, title: 'Step 2: describe a new card',
  steps: [
    'Property type: pick from the list. It decides the letters in the property number.',
    'Article: the general name, like Laptop.',
    'Model: brand and model, like Acer TravelMate P2. All laptops of this model share one card.',
    'Unit: how it is counted, like unit or set.',
  ],
  marks: [row(1).getByLabel('Row 1, property type', { exact: true }), row(1).getByLabel('Row 1, article', { exact: true }), row(1).getByLabel('Row 1, model', { exact: true }), row(1).getByLabel('Row 1, unit', { exact: true })],
})
await row(1).getByLabel('Description as printed on the form').fill('Laptop, Acer TravelMate P2\nSpecification:\n- Intel Core i7, 16GB RAM, 512GB SSD')
await row(1).getByLabel('Quantity').fill('2')
await row(1).getByLabel('Unit cost (₱)').fill('62,500.00')
await row(1).getByLabel('Date acquired').fill('2026-11-03')
await row(1).getByLabel('Useful life (years)').fill('5')
await shot(page, {
  section: S.issue, title: 'Step 3: what was bought',
  steps: [
    'Description: type it exactly as it should appear on the slip, specifications included.',
    'Quantity: how many units of this model.',
    'Unit cost in pesos. At ₱50,000 or more the item is PPE and goes on a PAR; below that it goes on an ICS.',
    'The label shows the result: here PPE, so a PAR.',
    'Date acquired: the delivery date. The month goes into the property number.',
  ],
  marks: [row(1).getByLabel('Description as printed on the form'), row(1).getByLabel('Quantity'), row(1).getByLabel('Unit cost (₱)'), row(1).getByText('PPE · PC · PAR'), row(1).getByLabel('Date acquired')],
})
await shot(page, {
  section: S.issue, title: 'Step 4: property numbers are suggested for you',
  steps: [
    'One box per unit. The grey number is TRACES\'s suggestion: the next free number for this type and year.',
    'To use a different number (for example an old one), just type it in the box.',
    'Serial numbers are optional.',
  ],
  marks: [row(1).getByLabel('Row 1, unit 1, property number'), row(1).getByLabel('Row 1, unit 2, property number'), row(1).getByLabel('Row 1, unit 1, serial number')],
  scrollTo: row(1).getByText('Property numbers'),
})
// row 2: an existing card with parts
await page.getByRole('button', { name: 'Add a row' }).click()
await row(2).getByLabel('Row 2, search cards').fill('desktop')
await row(2).getByRole('button', { name: /Desktop computer/ }).waitFor()
await shot(page, {
  section: S.issue, title: 'Picking a card that already exists',
  steps: ['Click Add a row for the next model.', 'Type part of the name.', 'Click the matching card. Only cards of the right kind (SPC or PC) are offered once the cost is entered.'],
  marks: [page.getByRole('button', { name: 'Add a row' }), row(2).getByLabel('Row 2, search cards'), row(2).getByRole('button', { name: /Desktop computer/ })],
  scrollTo: row(2),
})
await row(2).getByRole('button', { name: /Desktop computer/ }).click()
await row(2).getByLabel('Description as printed on the form').fill('Desktop computer set\nwith monitor and keyboard')
await row(2).getByLabel('Unit cost (₱)').fill('38,500.00')
await row(2).getByLabel('Date acquired').fill('2026-11-03')
await row(2).getByRole('button', { name: 'Add component' }).click()
await row(2).getByRole('button', { name: 'Add component' }).click()
await row(2).getByLabel('Row 2, component 1, label').fill('Monitor')
await row(2).getByLabel('Row 2, component 2, label').fill('Keyboard')
await shot(page, {
  section: S.issue, title: 'Sets: one row, a sticker for every part',
  steps: [
    'For a set, click Add component once for each part.',
    'Name the part, like Monitor.',
    'Its number is the main number plus a letter (a, b, c…). Each part gets its own QR sticker, but the set stays one row on the card, registry and report.',
    'Copy row (or Ctrl+D) repeats a row; Make copies repeats it as many times as the number beside it. Remove deletes the row.',
  ],
  marks: [row(2).getByRole('button', { name: 'Add component' }), row(2).getByLabel('Row 2, component 1, label'), row(2).getByLabel('Row 2, component 1, property number'), row(2).getByRole('button', { name: 'Copy row' })],
  scrollTo: row(2),
})
await page.locator('#rcv-search').fill('SARAi')
await page.waitForTimeout(600)
await page.locator('#rcv').selectOption({ index: 1 })
await page.locator('#date').fill('2026-11-14')
await page.locator('#purpose').fill('Equipment for the SARAi project team')
await shot(page, {
  section: S.issue, title: 'Part 2, Registry: who receives the items',
  steps: [
    'Type a name or a program to shorten the list.',
    'Pick the accountable officer who receives the items. Only officers allowed to receive property are listed.',
    'Date issued: the date on the slip.',
    'Fund cluster: filled in for you.',
    'Purpose: printed in the registry\'s Remarks column.',
  ],
  marks: ['#rcv-search', '#rcv', '#date', '#fund', '#purpose'],
  scrollTo: page.getByRole('heading', { name: '2. Registry' }),
})
await shot(page, {
  section: S.issue, title: 'Part 3, Report: a preview, nothing to type',
  steps: ['This is how the rows will look on the receiver\'s physical count report (RPCSP or RPCPPE).', 'Balance per card is filled in; the count columns stay empty until the physical count.'],
  marks: [page.locator('section[aria-labelledby="s3"] table'), page.locator('section[aria-labelledby="s3"] th', { hasText: 'Balance per card' })],
  scrollTo: page.locator('#s3'),
})
await page.locator('#icsNo').fill('2026-11TEST-010')
await page.locator('#parNo').fill('2026-11TEST-P06')
await shot(page, {
  section: S.issue, title: 'Part 4, ICS/PAR: the slip numbers, then save',
  steps: [
    'TRACES tells you which slips this makes. Here: one ICS (the cheaper desktop) and one PAR (the laptops).',
    'Type the ICS number and the PAR number. A box only appears when that slip is needed.',
    'Received from / Issued by: the supply officer is filled in. Positions can be changed to match the printed form.',
    'Save and generate ICS/PAR: saves everything and makes the slips ready to print.',
    'Use "Save, I\'ll upload the PDF" only when encoding an old paper form that already exists.',
  ],
  marks: [page.getByTestId('summary'), '#icsNo', '#issuer', page.getByRole('button', { name: 'Save and generate ICS/PAR' }), page.getByRole('button', { name: "Save, I'll upload the PDF" })],
  scrollTo: page.getByRole('heading', { name: '4. ICS / PAR' }),
})
await page.getByRole('button', { name: 'Save and generate ICS/PAR' }).click()
await page.getByRole('heading', { name: 'Saved' }).waitFor()
await shot(page, {
  section: S.issue, title: 'Saved: print the slips',
  steps: [
    'Each slip that was made is listed.',
    'Print opens the slip as a PDF. Print it and have it signed.',
    'Open shows the slip in TRACES. Stickers prints its QR stickers.',
    'Enter another issuance starts a fresh form.',
  ],
  marks: [page.getByRole('listitem').filter({ hasText: '2026-11TEST-P06' }), page.getByRole('link', { name: 'Print' }).first(), page.getByRole('link', { name: 'Open' }).first(), page.getByRole('button', { name: 'Enter another issuance' })],
})
await page.goto(`${BASE}/issue`)
await page.getByRole('button', { name: 'Save and generate ICS/PAR' }).click()
await page.waitForTimeout(800)
await shot(page, {
  section: S.issue, title: 'When something is missing',
  steps: ['A row with a problem gets a red border.', 'The red list under it says exactly what to fix. Nothing is saved until every problem is fixed.'],
  marks: [row(1), row(1).getByRole('alert')],
  scrollTo: row(1),
  note: 'Other messages you may see: "already used or repeated" (a property number is taken: type another), "Enter the ICS number" (part 4), "already exists" (that slip number was used before).',
})

// ───────────── ICS and PAR documents ─────────────
await page.goto(`${BASE}/documents`)
await shot(page, {
  section: S.docs, title: 'ICS and PAR: the list of slips',
  steps: [
    'Search by slip number.',
    'Show only ICS or only PAR.',
    'Show only slips that still need their signed copy.',
    'The PDF column: No PDF, Generated (printed, not yet signed) or Signed.',
    'Click a number to open the slip.',
  ],
  marks: [page.getByLabel('Search by document number'), page.getByLabel('Document type'), page.getByLabel('Signed copy'), page.getByRole('columnheader', { name: 'PDF' }), page.getByRole('link', { name: '2026-11TEST-P06' })],
})
await page.getByRole('link', { name: '2026-11TEST-P06' }).click()
await page.getByText('Page 1 of 1').waitFor()
const parUrl = page.url()
const parId = parUrl.split('/').pop()
await shot(page, {
  section: S.docs, title: 'A slip that is printed but not yet signed',
  steps: [
    'Status: Generated, unsigned.',
    'Print generated: opens the PDF to print.',
    'After it is signed, scan it and click Upload signed copy.',
    'The slip as TRACES made it.',
    'The rows of the slip. Click one to correct it (only while the slip is not signed).',
  ],
  marks: [page.getByText('Generated, unsigned').first(), page.getByRole('link', { name: 'Print generated' }), page.getByRole('button', { name: 'Upload signed copy' }), page.locator('canvas').first(), page.locator('.ag-root-wrapper').first()],
})
// use the generated PDF itself as the "signed scan"
const pdf = await page.request.get(`${BASE}/api/documents/${parId}/pdf?kind=generated`)
const scanFile = path.join(OUT, 'signed-scan.pdf')
writeFileSync(scanFile, await pdf.body())
await page.getByLabel('Choose the PDF to attach').setInputFiles(scanFile)
await page.getByText(/Signed copy attached|PDF attached/).waitFor()
await page.waitForTimeout(1200)
await shot(page, {
  section: S.docs, title: 'After uploading the signed copy',
  steps: [
    'Status: Signed.',
    'The slip is now locked: its rows cannot be changed. This protects what was signed.',
    'Adjust highlights moves the yellow box that marks a row on the scan, if the scan came out crooked.',
    'Remove signed copy is only for mistakes. It asks for a reason, keeps the file in the archive and unlocks the rows.',
  ],
  marks: [page.getByText('Signed', { exact: true }).first(), page.getByText('its entries are locked'), page.getByRole('button', { name: 'Adjust highlights' }), page.getByRole('button', { name: 'Remove signed copy' })],
})
await page.getByRole('button', { name: 'Adjust highlights' }).click()
await page.locator('[aria-label="Draw a box around this line on the PDF"]').waitFor()
await page.waitForTimeout(1500)
await shot(page, {
  section: S.docs, title: 'Adjusting a highlight box',
  steps: ['Pick the row.', 'Drag a box around that row on the page. It is saved at once.', 'Clear box removes it.'],
  marks: ['#hl-line', '[aria-label="Draw a box around this line on the PDF"]', page.getByRole('button', { name: 'Clear box' })],
})
await page.getByRole('button', { name: 'Hide highlights' }).click()
await page.getByRole('button', { name: 'Remove signed copy' }).click()
await shot(page, {
  section: S.docs, title: 'Removing a signed copy (only to correct a mistake)',
  steps: ['Write why it is removed. This is kept in the audit log.', 'Click Remove signed copy. Then correct the rows, print again and have it signed again.', 'Or keep it.'],
  marks: [page.getByLabel('Why is it being removed?'), page.getByRole('dialog').getByRole('button', { name: 'Remove signed copy' }), page.getByRole('button', { name: 'Keep the signed copy' })],
})
await page.getByRole('button', { name: 'Keep the signed copy' }).click()

// the ICS: edit a row, add rows
await page.goto(`${BASE}/documents`)
await page.getByRole('link', { name: '2026-11TEST-010' }).click()
await page.getByText('Page 1 of 1').waitFor()
await page.locator('.ag-row').first().click()
await page.getByRole('heading', { name: 'Edit line' }).waitFor()
await shot(page, {
  section: S.docs, title: 'Correcting a row (before it is signed)',
  steps: [
    'Change card moves the row to another card of the same kind, if the wrong one was picked.',
    'Correct the quantity, cost, description or dates here.',
    'Each property number with its serial number, old number and condition.',
    'Save line. The card, registry and report change with it.',
  ],
  marks: [page.getByRole('button', { name: 'Change card' }), page.locator('#qty'), page.getByLabel('Property number 1', { exact: true }), page.getByRole('button', { name: 'Save line' })],
  note: 'After a correction, open the slip again: TRACES asks you to regenerate it so the printed slip matches.',
})
await page.goBack()
await page.getByRole('link', { name: 'Add lines' }).waitFor()
await shot(page, {
  section: S.docs, title: 'Adding rows to a slip that is not signed yet',
  steps: ['Add lines opens the issuance form for this slip only. Use it to encode a long old slip over several sittings.', 'Regenerate makes the printable slip again after rows were added or corrected.'],
  marks: [page.getByRole('link', { name: 'Add lines' }), page.getByRole('button', { name: 'Regenerate' })],
})

// ───────────── Cards, registry, property ─────────────
await page.goto(`${BASE}/cards`)
await shot(page, {
  section: S.cards, title: 'Cards: one property card per model',
  steps: ['Search by article or model.', 'Show SPC (semi-expendable) or PC (PPE) cards, or one property type.', 'In stock: still with the Supply Unit. Units issued: now with officers.', 'Click a card to open it.'],
  marks: [page.getByLabel('Search cards'), page.getByLabel('Category'), page.getByRole('columnheader', { name: 'In stock' }), page.getByRole('row', { name: /Acer TravelMate P2/ }).getByRole('link')],
})
await page.getByRole('row', { name: /Acer TravelMate P2/ }).getByRole('link').click()
await page.getByRole('heading', { name: 'PROPERTY CARD', level: 1 }).waitFor()
await shot(page, {
  section: S.cards, title: 'A property card',
  steps: ['The card heading: article, model and the range of property numbers on this card.', 'Every receipt and issue of this model is a row. Balance is what the Supply Unit still holds.', 'Edit card fixes the name or stops offering the card on new entries.', 'Export PC (or SPC) downloads the official form as an Excel file.'],
  marks: [page.getByText('Property Number:'), page.locator('.ag-root-wrapper'), page.getByRole('button', { name: 'Edit card' }), page.getByRole('button', { name: /Export (PC|SPC)/ })],
})
await page.goto(`${BASE}/registry`)
await page.getByRole('radio', { name: 'Property, plant and equipment' }).click()
await page.waitForTimeout(800)
await shot(page, {
  section: S.cards, title: 'Registry of property issued',
  steps: ['Choose semi-expendable or PPE.', 'Choose a property type, or all.', 'Optional dates: only slips issued between them.', 'Export downloads the registry as an Excel file.', 'Click a row to open its property.'],
  marks: [page.getByRole('radiogroup', { name: 'Category' }), page.getByLabel('Property type'), page.locator('#from'), page.getByRole('button', { name: /^Export/ }), page.locator('.ag-row').first()],
})
await page.locator('.ag-row').first().click()
await page.getByRole('tab', { name: 'ICS/PAR' }).waitFor()
await page.waitForTimeout(2500) // the page scrolls itself to the highlighted row once the PDF is drawn
await shot(page, {
  section: S.cards, title: 'One property and everything about it',
  steps: ['The link inside its QR sticker.', 'Print sticker prints this one sticker.', 'Replace QR code: use when a sticker is lost or damaged. The old sticker then says "replaced".', 'Serial number, old property number and condition can be changed here.', 'The four forms this property appears on.'],
  marks: [page.getByText('Scan link:'), page.getByRole('link', { name: 'Print sticker' }), page.getByRole('button', { name: 'Replace QR code' }), page.locator('section[aria-label="Edit this property"]'), page.getByRole('tablist')],
  scrollTo: page.locator('main h1'),
})
await page.getByRole('tablist').evaluate((el) => el.scrollIntoView({ block: 'start' }))
await shot(page, {
  section: S.cards, title: 'The four tabs',
  steps: ['ICS/PAR: the slip, with this item\'s row highlighted in yellow.', 'Report: the receiver\'s physical count report.', 'Registry: the registry rows of this kind of property.', 'Card: the model\'s property card.'],
  marks: [page.getByRole('tab', { name: 'ICS/PAR' }), page.getByRole('tab', { name: 'Report' }), page.getByRole('tab', { name: 'Registry' }), page.getByRole('tab', { name: 'Card' })],
})

// ───────────── Reports ─────────────
await page.goto(`${BASE}/reports`)
await page.locator('#r-search').fill('SARAi')
await page.waitForTimeout(600)
await page.locator('#r-officer').selectOption({ index: 1 })
await page.locator('.ag-row').first().waitFor()
await shot(page, {
  section: S.reports, title: 'Report on the physical count',
  steps: [
    'Find the accountable officer by name or program, then pick them in the list below it.',
    'RPCPPE (PPE) or RPCSP (semi-expendable).',
    '"As at": the date of the count. Today is filled in.',
    'Everything the officer holds on that date, one row per slip row.',
    'Print prints the report; Export to Excel downloads the official RPCPPE / RPCSP file.',
  ],
  marks: ['#r-search', '#r-category', '#r-asat', page.locator('.ag-root-wrapper'), page.getByRole('button', { name: 'Print' })],
  note: 'On Hand per Count and Shortage/Overage are left empty on purpose: print the report and fill them in by hand during the count.',
})
await shot(page, {
  section: S.reports, title: 'Names that sign the report',
  steps: ['Type the names that sign the report, one per line, in each box.', 'Save these names as the default to have them filled in next time. Without it, the names are used only for this print or export.'],
  marks: ['#sig-committee', page.getByRole('button', { name: 'Save these names as the default' })],
  scrollTo: page.locator('#sig-committee'),
})

// ───────────── Stickers ─────────────
await page.goto(`${BASE}/stickers`)
await page.getByLabel('Find a document by number').fill('P06')
await page.waitForTimeout(600)
await shot(page, {
  section: S.stickers, title: 'Choosing which stickers to print',
  steps: ['Type part of the slip number to find it.', 'Pick the slip: you get a sticker for every item on it.', 'Or type property numbers, separated by commas.', 'Click Prepare sheet.'],
  marks: [page.getByLabel('Find a document by number'), '#doc', '#nos', page.getByRole('button', { name: 'Prepare sheet' })],
})
await page.goto(`${BASE}/stickers?documentId=${parId}`)
await page.getByTestId('sticker-sheet').locator('img').first().waitFor()
await page.getByText('Copies per property number').click()
await shot(page, {
  section: S.stickers, title: 'The sticker sheet',
  steps: ['A warning appears while TRACES runs on a test address: those stickers will not work later. Print real stickers only after the IT administrator sets the real address.', 'Pick the sticker size of your sticker paper.', 'Need more than one sticker for an item? Set the copies here.', 'Print. Choose 100% scale (not "fit to page") in the print window.'],
  marks: [page.getByRole('alert'), page.getByRole('radiogroup', { name: 'Sticker size' }), page.getByText('Copies per property number'), page.getByRole('button', { name: 'Print' })],
})

// ───────────── Scanning (phone) ─────────────
const reg = await (await page.request.get(`${BASE}/api/views/registry?category=ppe`)).json()
const laptopNo = reg.find((r) => r.reference === 'PAR 2026-11TEST-P06').propertyNos[0]
const view = await (await page.request.get(`${BASE}/api/properties/${laptopNo}/view`)).json()
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const mob = await phone.newPage()
watch(mob, 'phone')
await mob.goto(`${BASE}/q/${view.property.token.trim()}`)
await mob.getByRole('tab', { name: 'ICS/PAR' }).waitFor()
await shot(mob, {
  section: S.scan, phone: true, title: 'What anyone sees after scanning a sticker',
  steps: ['No sign-in needed. The item and its property number.', 'The key facts: description, serial number, who holds it.'],
  marks: [mob.getByRole('heading', { level: 1 }), mob.locator('dl').first()],
})
await mob.waitForTimeout(2500)
await shot(mob, {
  section: S.scan, phone: true, title: 'The signed slip, with the item marked',
  steps: ['Tabs: ICS/PAR, Report, Registry, Card.', 'The signed slip; the yellow box marks this item\'s row.'],
  marks: [mob.getByRole('tablist'), mob.locator('[data-testid="region-highlight"]')],
  scrollTo: mob.getByRole('tablist'),
})
await mob.getByRole('tab', { name: 'Card' }).click()
await mob.waitForTimeout(1200)
await shot(mob, {
  section: S.scan, phone: true, title: 'The property card on a phone',
  steps: ['The rows of this item are highlighted. Other people\'s items of the same model are not shown to the public.'],
  marks: [mob.locator('.traces-highlight').first()],
  scrollTo: mob.getByRole('tablist'),
})
await phone.close()

// ───────────── Administration (superadmin) ─────────────
await page.getByRole('button', { name: 'Log out' }).click()
await login(page, ADMIN)
await page.goto(`${BASE}/admin/users`)
await shot(page, {
  section: S.admin, title: 'User accounts (IT administrator only)',
  steps: ['Add user creates an account and shows a one-time temporary password.', 'Reset password makes a new temporary password if someone forgot theirs.', 'Deactivate signs the person out and stops them signing in.', 'The Administration menu appears only for the IT administrator.'],
  marks: [page.getByRole('button', { name: 'Add user' }).first(), page.getByRole('button', { name: /^Reset password of/ }).first(), page.getByRole('button', { name: /^Deactivate/ }).first(), page.getByText('Administration')],
})
await page.getByRole('button', { name: 'Add user' }).first().click()
await page.getByRole('dialog').getByLabel('Full name').fill('Carlo B. Ramos')
await shot(page, {
  section: S.admin, title: 'Adding a user',
  steps: ['Full name. The work email is made from it (Carlo B. Ramos gets cbramos@region1.dost.gov.ph).', 'Role: Supply admin for Supply Unit staff; Superadmin only for IT.', 'Add user.'],
  marks: [page.getByRole('dialog').getByLabel('Email'), page.getByRole('dialog').getByLabel('Role'), page.getByRole('dialog').getByRole('button', { name: 'Add user' })],
})
await page.getByRole('dialog').getByRole('button', { name: 'Add user' }).click()
await page.getByRole('dialog').getByLabel('Temporary password').waitFor()
await page.getByRole('dialog').getByLabel('Temporary password').evaluate((el) => { el.value = '•••••• (shown once)'; el.type = 'text' }) // never print a real password in the manual
await shot(page, {
  section: S.admin, title: 'The temporary password is shown only once',
  steps: ['Copy the temporary password and give it to the person privately. It is not shown again.', 'Click Done. At first sign-in they must choose their own password.'],
  marks: [page.getByRole('dialog').getByLabel('Temporary password'), page.getByRole('dialog').getByRole('button', { name: 'Done' })],
})
await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
await page.goto(`${BASE}/admin/settings`)
await shot(page, {
  section: S.admin, title: 'Settings',
  steps: ['The office name printed on every form.', 'Public base URL: the address inside every QR code. Set it to the real address before printing real stickers.', 'PPE threshold: items costing this much or more are PPE.', 'The supply officer printed as issuer on new slips.'],
  marks: [page.getByLabel('Entity name'), page.getByLabel('Public base URL'), page.getByLabel('PPE threshold (pesos)'), page.locator('#s-issuer')],
})
await page.goto(`${BASE}/admin/audit`)
await page.getByRole('button', { name: 'Details' }).first().click()
await shot(page, {
  section: S.admin, title: 'Audit log: every change, who made it and when',
  steps: ['Filter by kind of record, by person or by dates.', 'Each change is one row.', 'Details shows the values before and after the change.'],
  marks: [page.getByLabel('Record type'), page.getByRole('row').nth(1), page.getByRole('button', { name: 'Hide' }).first()],
})

// ───────────── Your account ─────────────
await page.goto(`${BASE}/account/password`)
await shot(page, {
  section: S.account, title: 'Changing your password and signing out',
  steps: ['Change password is at the bottom of the menu.', 'Type your current password and the new one twice, then save.', 'Log out when you leave the computer.'],
  marks: [page.getByRole('link', { name: 'Change password' }), page.locator('main form').first(), page.getByRole('button', { name: 'Log out' })],
  prefer: 'right',
})

writeFileSync(path.join(OUT, 'steps.json'), JSON.stringify({ slides, issues }, null, 2))
console.log(`\n${slides.length} screenshots. Issues seen while crawling: ${issues.length}`)
for (const i of issues) console.log(' - ' + i)
await browser.close()
