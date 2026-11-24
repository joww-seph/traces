import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const BASE = process.env.MANUAL_BASE ?? 'http://localhost:5373'
const OUT = path.resolve('docs/manual/shots')
const SUPPLY = { email: 'jdelacruz@region1.dost.gov.ph', password: 'Manual-Supply-2026' }
const ADMIN = { email: 'it@region1.dost.gov.ph', password: 'Manual-Admin-2026' }

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const slides = []
const issues = []
let count = 0

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
      const cy = r.y + Math.min(r.h / 2, 30), cx = r.x + Math.min(r.w / 2, 90)
      const left = [[r.x - 80, cy - 45], [r.x - 80, cy + 45], [r.x - 130, cy], [r.x - 190, cy - 20]]
      const right = [[r.x + r.w + 80, cy - 45], [r.x + r.w + 80, cy + 45], [r.x + r.w + 130, cy]]
      const above = [[cx - 50, r.y - 60], [cx + 50, r.y - 60]]
      const below = [[cx, r.y + r.h + 60], [cx + 70, r.y + r.h + 60], [cx - 70, r.y + r.h + 60]]
      const cands = prefer === 'right' ? [...right, ...below, ...above, ...left]
        : r.y < 130 ? [...below, ...left, ...right, ...above]
          : [...left, ...above, ...right, ...below]
      const fits = ([px, py]) => px > 22 && px < W - 22 && py > 22 && py < H - 22
      const ok = (c) => fits(c) && rects.every((o) => !inside(c[0], c[1], o, 18)) && tails.every((t) => Math.hypot(t[0] - c[0], t[1] - c[1]) > 40)
      const [tx, ty] = cands.find(ok) ?? cands.find(fits) ?? [r.x + 20, r.y + 20]
      tails.push([tx, ty])
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

async function shot(page, { section, title, steps, marks = [], note, scrollTo, phone = false, prefer }) {
  if (scrollTo) {
    const l = typeof scrollTo === 'string' ? page.locator(scrollTo).first() : scrollTo.first()
    await l.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
    await page.evaluate(() => window.scrollBy({ top: -70, behavior: 'instant' }))
  }
  await page.waitForTimeout(500)
  let boxes = []
  for (let tries = 0; tries < 8; tries++) {
    const now = []
    for (const m of marks) if (m) now.push(await boxOf(page, m))
    const same = JSON.stringify(now) === JSON.stringify(boxes)
    boxes = now
    if (same) break
    await page.waitForTimeout(300)
  }
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
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
  await page.getByRole('main').getByRole('heading').first().waitFor()
}

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
watch(page, 'desktop')
const row = (n) => page.getByRole('group', { name: `Row ${n}` })
const S = {
  start: 'Getting started', officers: 'Lists kept by the IT administrator', issue: 'Entering an issuance', docs: 'ICS and PAR documents',
  cards: 'Cards, registry and property', reports: 'Reports', stickers: 'QR stickers', scan: 'Scanning a sticker', admin: 'Administration', account: 'Your account',
}

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
    'Cards: one property card for every property number (SPC or PC).',
    'Registry: the registry of property issued (RegSPI and the PPE registry).',
    'Reports: what one officer holds on a date (RPCSP or RPCPPE), for the physical count.',
    'Stickers: print QR stickers.',
  ],
  marks: [
    page.getByRole('link', { name: 'Dashboard' }), page.getByRole('link', { name: 'New issuance' }).first(), page.getByRole('link', { name: 'ICS and PAR' }),
    page.getByRole('link', { name: 'Cards', exact: true }), page.getByRole('link', { name: 'Registry' }), page.getByRole('link', { name: 'Reports' }),
    page.getByRole('link', { name: 'Stickers' }),
  ],
  prefer: 'right',
  note: 'Officers, property types and office units are kept by the IT administrator. Ask them when a person or a unit is missing from a list.',
})

const itCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const it = await itCtx.newPage()
watch(it, 'it')
await login(it, ADMIN)
{
const page = it
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
await page.goto(`${BASE}/units`)
await page.getByRole('button', { name: 'Add unit' }).click()
await page.locator('#u-code').fill('SARAi')
await page.locator('#u-name').fill('Smarter Approaches to Reinvigorate Agriculture as an Industry')
await shot(page, {
  section: S.officers, title: 'Office units: the code inside ICS and PAR numbers',
  steps: ['Code: the letters inside the slip numbers, like SARAi in 2026-11SARAi-001. It cannot be changed later.', 'Name: the unit written out.', 'Click Add unit. The unit can then be chosen on the issuance form.'],
  marks: ['#u-code', '#u-name', page.getByRole('dialog').getByRole('button', { name: 'Add unit' })],
})
await page.getByRole('dialog').getByRole('button', { name: 'Add unit' }).click()
await page.getByRole('cell', { name: 'SARAi', exact: true }).waitFor()
}
await itCtx.close()

await page.goto(`${BASE}/issue`)
await shot(page, {
  section: S.issue, title: 'New issuance: the four parts of the form',
  steps: [
    'Part 1, Property card: one row for each kind of item you are handing over. Every unit gets its own card.',
    'Each row is a box like this one. You can add as many rows as you need.',
    'Parts 2 to 4 are further down: Registry (who receives it), Report (a preview) and ICS/PAR (the slip numbers).',
  ],
  marks: [page.getByRole('heading', { name: '1. Property card' }), row(1), null],
  note: 'Nothing is saved until you press a Save button at the bottom. If the page is closed by accident, your typing is kept on this computer and comes back when you open the form again.',
})
const DESC = 'Description (model and specifications, as printed)'
await row(1).getByLabel('Row 1, property type', { exact: true }).selectOption({ label: 'ICT · Information and Communications Technology Equipment' })
await row(1).getByLabel('Row 1, article', { exact: true }).fill('Laptop')
await row(1).getByLabel('Row 1, unit', { exact: true }).fill('unit')
await row(1).getByLabel(DESC).fill('Acer TravelMate P2\nSpecification:\n- Intel Core i7, 16GB RAM, 512GB SSD')
await shot(page, {
  section: S.issue, title: 'Step 1: describe the item',
  steps: [
    'Property type: pick from the list. It decides the letters in the property number.',
    'Article: the general name, like Laptop.',
    'Unit: how it is counted, like unit or set.',
    'Description: the model and its specifications, exactly as they should be printed. The serial numbers are added after it by TRACES.',
  ],
  marks: [row(1).getByLabel('Row 1, property type', { exact: true }), row(1).getByLabel('Row 1, article', { exact: true }), row(1).getByLabel('Row 1, unit', { exact: true }), row(1).getByLabel(DESC)],
})
await row(1).getByLabel('Quantity').fill('2')
await row(1).getByLabel('Unit cost (₱)').fill('62,500.00')
await row(1).getByLabel('Date acquired').fill('2026-11-03')
await row(1).getByLabel('Useful life (years)').fill('5')
await shot(page, {
  section: S.issue, title: 'Step 2: what was bought',
  steps: [
    'Quantity: how many units.',
    'Unit cost in pesos. At ₱50,000 or more the item is PPE and goes on a PAR; below that it goes on an ICS.',
    'The label shows the result: here PPE, so a PAR for each unit.',
    'Date acquired: the delivery date. The month goes into the property number.',
  ],
  marks: [row(1).getByLabel('Quantity'), row(1).getByLabel('Unit cost (₱)'), row(1).getByText('PPE · PC · PAR'), row(1).getByLabel('Date acquired')],
})
await row(1).getByLabel('Row 1, unit 1, serial number').fill('NXVPKSP00123')
await shot(page, {
  section: S.issue, title: 'Step 3: property numbers and serial numbers',
  steps: [
    'One box per unit. The grey number is TRACES\'s suggestion: the next free number for this type and year. Type a number to use another one.',
    'The serial number of that unit. It is printed after the description, like "Acer TravelMate P2 (S/N: NXVPKSP00123)".',
    'N/A is filled in for you. Leave it when the item has no serial number.',
  ],
  marks: [row(1).getByLabel('Row 1, unit 1, property number'), row(1).getByLabel('Row 1, unit 1, serial number'), row(1).getByLabel('Row 1, unit 2, serial number')],
  scrollTo: row(1).getByText('Property numbers'),
})
await page.getByRole('button', { name: 'Add a row' }).click()
await row(2).getByLabel('Row 2, property type', { exact: true }).selectOption({ label: 'ICT · Information and Communications Technology Equipment' })
await row(2).getByLabel('Row 2, article', { exact: true }).fill('Desktop computer')
await row(2).getByLabel('Row 2, unit', { exact: true }).fill('set')
await row(2).getByLabel(DESC).fill('Desktop computer set\nwith monitor and keyboard')
await row(2).getByLabel('Unit cost (₱)').fill('38,500.00')
await row(2).getByLabel('Date acquired').fill('2026-11-03')
await row(2).getByRole('button', { name: 'Add component' }).click()
await row(2).getByRole('button', { name: 'Add component' }).click()
await row(2).getByLabel('Row 2, component 1, label').fill('Monitor')
await row(2).getByLabel('Row 2, component 2, label').fill('Keyboard')
await shot(page, {
  section: S.issue, title: 'Sets: one row, a sticker for every part',
  steps: [
    'Click Add a row for the next item. For a set, click Add component once for each part.',
    'Name the part, like Monitor.',
    'Its number is the main number plus a letter (a, b, c…), with its own serial number. Each part gets its own QR sticker and is listed on the set\'s card.',
    'Copy row (or Ctrl+D) repeats a row; Make copies repeats it as many times as the number beside it. Remove deletes the row.',
  ],
  marks: [row(2).getByRole('button', { name: 'Add component' }), row(2).getByLabel('Row 2, component 1, label'), row(2).getByLabel('Row 2, component 1, property number'), row(2).getByRole('button', { name: 'Copy row' })],
  scrollTo: row(2),
  note: 'A set is entered one per row (quantity 1), so that each set has its own card.',
})
await page.locator('#rcv').fill('SARAi')
await page.getByRole('listbox', { name: 'Officers' }).getByRole('option').first().click()
await page.locator('#date').fill('2026-11-14')
await page.locator('#purpose').fill('Equipment for the SARAi project team')
await shot(page, {
  section: S.issue, title: 'Part 2, Registry: who receives the items',
  steps: [
    'Received by: click the box and type part of a name or a program (for example SARAi), then click the officer in the list. Only officers allowed to receive property are listed.',
    'Date issued: the date on the slip.',
    'Fund cluster: filled in for you.',
    'Purpose: printed in the registry\'s Remarks column.',
  ],
  marks: ['#rcv', '#date', '#fund', '#purpose'],
  scrollTo: page.getByRole('heading', { name: '2. Registry' }),
})
await shot(page, {
  section: S.issue, title: 'Part 3, Report: a preview, nothing to type',
  steps: ['This is how the rows will look on the receiver\'s physical count report (RPCSP or RPCPPE).', 'Balance per card is filled in; the count columns stay empty until the physical count.'],
  marks: [page.locator('section[aria-labelledby="s3"] table'), page.locator('section[aria-labelledby="s3"] th', { hasText: 'Balance per card' })],
  scrollTo: page.locator('#s3'),
})
await page.getByLabel('Office unit').selectOption('SARAi')
await page.locator('#parNo-1').waitFor()
await page.waitForFunction(() => /SARAi-\d{3}$/.test(document.querySelector('#parNo-1')?.value ?? ''))
const icsNo = await page.locator('#icsNo').inputValue()
const firstPar = await page.locator('#parNo-0').inputValue()
await shot(page, {
  section: S.issue, title: 'Part 4, ICS/PAR: the slip numbers, then save',
  steps: [
    'TRACES tells you which slips this makes: one ICS for all the semi-expendable rows, and one PAR for each PPE unit.',
    'Office unit: its code goes inside the slip numbers. The numbers are then suggested for you (year, month, unit, running number).',
    'The ICS number, and one PAR number per laptop, each labelled with the property number it is for. Change any of them if needed.',
    'Save and generate ICS/PAR: saves everything and makes the slips ready to print.',
    'Use "Save, I\'ll upload the PDF" only when encoding an old paper form that already exists.',
  ],
  marks: [page.getByTestId('summary'), '#doc-unit', '#parNo-0', page.getByRole('button', { name: 'Save and generate ICS/PAR' }), page.getByRole('button', { name: "Save, I'll upload the PDF" })],
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
  marks: [page.getByRole('listitem').filter({ hasText: firstPar }), page.getByRole('link', { name: 'Print' }).first(), page.getByRole('link', { name: 'Open' }).first(), page.getByRole('button', { name: 'Enter another issuance' })],
})
await page.goto(`${BASE}/issue`)
await page.getByRole('button', { name: 'Save and generate ICS/PAR' }).click()
await page.waitForTimeout(800)
await shot(page, {
  section: S.issue, title: 'When something is missing',
  steps: ['A row with a problem gets a red border.', 'The red list under it says exactly what to fix. Nothing is saved until every problem is fixed.'],
  marks: [row(1), row(1).getByRole('alert')],
  scrollTo: row(1),
  note: 'Other messages you may see: "already used or repeated" (a property number is taken: type another), "Enter the ICS number" or "Enter 2 PAR number(s)" (part 4), "already exists" (that slip number was used before).',
})

await page.goto(`${BASE}/documents`)
await shot(page, {
  section: S.docs, title: 'ICS and PAR: the list of slips',
  steps: [
    'Search by slip number.',
    'Show only ICS or only PAR.',
    'Show only slips that still need their signed copy.',
    'The PDF column: No PDF, Generated (printed, not yet signed) or Signed.',
    'Click a number to open the slip. No. is the slip\'s place among all ICS (or all PAR), the same on paper.',
    'Export to Excel prints the list, 20 slips per sheet.',
  ],
  marks: [page.getByLabel('Search by document number'), page.getByLabel('Document type'), page.getByLabel('Signed copy'), page.getByRole('columnheader', { name: 'PDF' }), page.getByRole('link', { name: firstPar }), page.getByRole('button', { name: /^Export/ })],
})
await page.getByRole('link', { name: firstPar }).click()
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
await page.getByRole('heading', { name: 'History' }).scrollIntoViewIfNeeded()
await shot(page, {
  section: S.docs, title: 'History: everything done to a slip',
  steps: ['Every action on the slip, its rows, its property numbers and their cards: who did it and when, newest first.', 'For a change, the old and the new value.'],
  marks: [page.getByRole('heading', { name: 'History' }), page.locator('section[aria-labelledby="history-title"] li').first()],
  scrollTo: page.getByRole('heading', { name: 'History' }),
})

await page.goto(`${BASE}/documents`)
await page.getByRole('link', { name: icsNo }).click()
await page.getByText('Page 1 of 1').waitFor()
await page.locator('.ag-row').first().click()
await page.getByRole('heading', { name: 'Edit line' }).waitFor()
await shot(page, {
  section: S.docs, title: 'Correcting a row (before it is signed)',
  steps: [
    'Correct the property type, article or unit here.',
    'Correct the quantity, cost, description or dates here.',
    'Each property number with its serial number, old number and condition.',
    'Save line. The card, registry and report change with it.',
  ],
  marks: [page.locator('#article'), page.locator('#qty'), page.getByLabel('Property number 1', { exact: true }), page.getByRole('button', { name: 'Save line' })],
  note: 'After a correction, open the slip again: TRACES asks you to regenerate it so the printed slip matches.',
})
await page.goBack()
await page.getByRole('link', { name: 'Add lines' }).waitFor()
await shot(page, {
  section: S.docs, title: 'Adding rows to a slip that is not signed yet',
  steps: ['Add lines opens the issuance form for this slip only. Use it to encode a long old slip over several sittings.', 'Regenerate makes the printable slip again after rows were added or corrected.'],
  marks: [page.getByRole('link', { name: 'Add lines' }), page.getByRole('button', { name: 'Regenerate' })],
})

const reg = await (await page.request.get(`${BASE}/api/views/registry?category=ppe`)).json()
const laptopNo = reg.find((r) => r.reference === `PAR ${firstPar}`).propertyNos[0]
await page.goto(`${BASE}/cards`)
await page.getByLabel('Search cards').fill('TravelMate')
await page.getByRole('link', { name: laptopNo, exact: true }).waitFor()
await shot(page, {
  section: S.cards, title: 'Cards: one property card per property number',
  steps: ['Search by property number, serial number, description or the officer who holds it.', 'Show SPC (semi-expendable) or PC (PPE) cards, or one property type.', 'Each property number has its own card. Click it to open the card.', 'The ICS or PAR it was issued on. Click to open the slip.'],
  marks: [page.getByLabel('Search cards'), page.getByLabel('Category'), page.getByRole('link', { name: laptopNo, exact: true }), page.getByRole('link', { name: `PAR ${firstPar}` })],
})
await page.getByRole('link', { name: laptopNo, exact: true }).click()
await page.getByRole('heading', { name: 'PROPERTY CARD', level: 1 }).waitFor()
await shot(page, {
  section: S.cards, title: 'A property card',
  steps: ['The card heading: the article, the description with its serial number, and the property number.', 'Its rows: the issue now, and later transfers. The date is the date issued, the same as in the registry.', 'Remarks: double-click the cell to type a note, for example about a transfer, and press Enter to save it.', 'Open the PAR (or ICS) it was issued on.', 'Export PC (or SPC) downloads the official form as an Excel file.'],
  marks: [page.getByText('Property Number:'), page.locator('.ag-root-wrapper'), page.locator('.ag-cell[col-id="remarks"]').first(), page.getByRole('link', { name: /^Open PAR/ }), page.getByRole('button', { name: /Export (PC|SPC)/ })],
})
await page.goto(`${BASE}/registry`)
await page.getByRole('radio', { name: 'Property, plant and equipment' }).click()
await page.waitForTimeout(800)
await shot(page, {
  section: S.cards, title: 'Registry of property issued',
  steps: ['Choose semi-expendable or PPE.', 'Choose a property type, or all.', 'Optional dates: only slips issued between them.', 'Export downloads the registry as an Excel file, 20 rows per sheet.', 'No. is the row\'s number in this registry and Sheet No. the printed sheet it is on, so a row is easy to find on paper. Click a row to open its ICS or PAR.'],
  marks: [page.getByRole('radiogroup', { name: 'Category' }), page.getByLabel('Property type'), page.locator('#from'), page.getByRole('button', { name: /^Export/ }), page.getByRole('columnheader', { name: 'No.', exact: true })],
  note: 'The tables show 20 rows per page, like the printed sheets. Use the arrows under a table to turn the pages.',
})
await page.goto(`${BASE}/properties/${encodeURIComponent(laptopNo)}`)
await page.getByRole('tab', { name: 'ICS/PAR' }).waitFor()
await page.waitForTimeout(2500)
await shot(page, {
  section: S.cards, title: 'One property and everything about it',
  steps: ['The link inside its QR sticker.', 'Print sticker prints this one sticker.', 'Replace QR code: use when a sticker is lost or damaged. The old sticker then says "replaced".', 'Serial number, old property number and condition can be changed here.', 'The four forms this property appears on.'],
  marks: [page.getByText('Scan link:'), page.getByRole('link', { name: 'Print sticker' }), page.getByRole('button', { name: 'Replace QR code' }), page.locator('section[aria-label="Edit this property"]'), page.getByRole('tablist')],
  scrollTo: page.locator('main h1'),
})
await page.getByRole('tablist').evaluate((el) => el.scrollIntoView({ block: 'start' }))
await shot(page, {
  section: S.cards, title: 'The four tabs',
  steps: ['ICS/PAR: the slip, with this item\'s row highlighted in yellow.', 'Report: the receiver\'s physical count report.', 'Registry: the registry rows of this kind of property.', 'Card: this property\'s own card.'],
  marks: [page.getByRole('tab', { name: 'ICS/PAR' }), page.getByRole('tab', { name: 'Report' }), page.getByRole('tab', { name: 'Registry' }), page.getByRole('tab', { name: 'Card' })],
})

await page.goto(`${BASE}/reports`)
await page.locator('#r-officer').fill('SARAi')
await page.getByRole('listbox', { name: 'Officers' }).getByRole('option').first().click()
await page.locator('.ag-cell[col-id="article"]').first().waitFor()
await shot(page, {
  section: S.reports, title: 'Report on the physical count',
  steps: [
    'Accountable officer: type part of a name or a program, then click the officer in the list.',
    'RPCPPE (PPE) or RPCSP (semi-expendable).',
    '"As at": the date of the count. Today is filled in.',
    'Everything the officer holds on that date, one numbered row per slip row. Click a row to open its slip.',
    'Print prints the report; Export to Excel downloads the official RPCPPE / RPCSP file.',
  ],
  marks: ['#r-officer', '#r-category', '#r-asat', page.locator('.ag-root-wrapper'), page.getByRole('button', { name: 'Print' })],
  note: 'On Hand per Count and Shortage/Overage are left empty on purpose: print the report and fill them in by hand during the count.',
})
await shot(page, {
  section: S.reports, title: 'Names that sign the report',
  steps: ['Type the names that sign the report, one per line, in each box.', 'Save these names as the default to have them filled in next time. Without it, the names are used only for this print or export.'],
  marks: ['#sig-committee', page.getByRole('button', { name: 'Save these names as the default' })],
  scrollTo: page.locator('#sig-committee'),
})
await page.getByRole('heading', { name: /ICS and PAR held by/ }).waitFor()
await shot(page, {
  section: S.reports, title: 'All the slips of an officer',
  steps: ['Every ICS and PAR of which the officer still holds a property, oldest first. Click one to open it.', 'Download all as one PDF: the signed copies (or the printed ones) in one file, for the inventory folder.'],
  marks: [page.locator('section[aria-labelledby="officer-forms"] ol'), page.getByRole('link', { name: 'Download all as one PDF' })],
  scrollTo: page.getByRole('heading', { name: /ICS and PAR held by/ }),
  note: 'A slip with no PDF yet is named above the list and left out of the file.',
})

await page.goto(`${BASE}/stickers`)
await page.getByLabel('Find a document by number').fill(firstPar)
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
  steps: ['This property\'s own card, with its row highlighted. Names of other people are never shown to the public.'],
  marks: [mob.locator('.traces-highlight').first()],
  scrollTo: mob.getByRole('tablist'),
})
await phone.close()

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
await page.getByRole('dialog').getByLabel('Temporary password').evaluate((el) => { el.value = '•••••• (shown once)'; el.type = 'text' })
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
