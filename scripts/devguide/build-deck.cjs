const path = require('node:path')
const pptxgen = require('pptxgenjs')

const OUT = path.resolve(process.env.DEVGUIDE_OUT ?? 'docs/TRACES-Developer-Guide.pptx')

const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE'
pres.title = 'TRACES Developer Guide'
pres.author = 'Supply Unit, DOST Region 1'
pres.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial' }

const INK = '111111'
const RED = 'E0102F'
const NAVY = '1F3A5F'
const MUTED = '5B6770'
const PANEL = 'EEF1F5'
const CODEBG = 'F4F4F4'
const GREEN = '2E7D32'
const LINE = 'B8C0C8'
const MONO = 'Courier New'

pres.defineSlideMaster({
  title: 'CONTENT',
  background: { color: 'FFFFFF' },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.3, w: 12.3, h: 0.75, fontSize: 30, bold: true, color: INK, fontFace: 'Arial', valign: 'middle', margin: 0 }, text: '' } },
    { text: { text: 'TRACES Developer Guide', options: { x: 0.5, y: 7.0, w: 6, h: 0.3, fontSize: 10, color: MUTED, margin: 0 } } },
  ],
  slideNumber: { x: 12.3, y: 7.0, w: 0.5, h: 0.3, fontSize: 10, color: MUTED, align: 'right' },
})
pres.defineSlideMaster({
  title: 'DIVIDER',
  background: { color: NAVY },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.8, y: 2.6, w: 11.7, h: 1.0, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: 'Arial', align: 'left', margin: 0 }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 0.8, y: 3.75, w: 11.7, h: 1.4, fontSize: 20, color: 'DCE3EA', fontFace: 'Arial', align: 'left', valign: 'top', margin: 0 }, text: '' } },
  ],
  slideNumber: { x: 12.3, y: 7.0, w: 0.5, h: 0.3, fontSize: 10, color: 'DCE3EA', align: 'right' },
})

let section = ''
function content(title) {
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: section })
  s.addText(title, { placeholder: 'title' })
  return s
}
function part(title, sub) {
  section = title
  pres.addSection({ title })
  const s = pres.addSlide({ masterName: 'DIVIDER', sectionTitle: section })
  s.addText(title, { placeholder: 'title' })
  if (sub) s.addText(sub, { placeholder: 'body' })
  return s
}

function bullets(s, items, o = {}) {
  const size = o.size ?? 16
  const runs = []
  items.forEach((it, i) => {
    const last = i === items.length - 1
    const para = { bullet: o.numbered ? { type: 'number' } : (o.bullet === false ? false : { indent: 18 }), paraSpaceAfter: o.gap ?? 8 }
    if (typeof it === 'string') runs.push({ text: it, options: { ...para, breakLine: !last } })
    else {
      runs.push({ text: `${it[0]}`, options: { ...para, bold: true, color: o.termColor ?? INK } })
      runs.push({ text: ` ${it[1]}`, options: { breakLine: !last } })
    }
  })
  s.addText(runs, { x: o.x ?? 0.5, y: o.y ?? 1.3, w: o.w ?? 12.3, h: o.h ?? 5.5, fontSize: size, color: INK, valign: 'top', isTextBox: true, margin: 0, objectName: o.name ?? 'body' })
}

function para(s, text, o = {}) {
  s.addText(text, { x: o.x ?? 0.5, y: o.y ?? 1.3, w: o.w ?? 12.3, h: o.h ?? 0.6, fontSize: o.size ?? 16, color: o.color ?? INK, bold: o.bold, italic: o.italic, align: o.align, valign: o.valign ?? 'top', isTextBox: true, margin: 0, fontFace: o.font })
}

function plain(s, text, o = {}) {
  const x = o.x ?? 0.5, y = o.y ?? 5.6, w = o.w ?? 12.3, h = o.h ?? 1.2
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: PANEL }, line: { color: PANEL }, rectRadius: 0.08, objectName: 'plain words panel' })
  s.addText([
    { text: 'In plain words', options: { bold: true, color: RED, breakLine: true, paraSpaceAfter: 4 } },
    { text, options: { color: INK } },
  ], { x: x + 0.2, y: y + 0.12, w: w - 0.4, h: h - 0.24, fontSize: o.size ?? 15, valign: 'top', isTextBox: true, margin: 0 })
}

function box(s, o) {
  const fill = o.fill ?? 'FFFFFF'
  const dark = fill === NAVY || fill === RED || fill === GREEN
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: o.x, y: o.y, w: o.w, h: o.h, fill: { color: fill }, line: { color: o.border ?? (dark ? fill : LINE), width: 1 }, rectRadius: 0.06, objectName: o.title })
  const runs = [{ text: o.title, options: { bold: true, fontSize: o.titleSize ?? 15, color: dark ? 'FFFFFF' : (o.titleColor ?? NAVY), breakLine: !!o.body, paraSpaceAfter: 3 } }]
  if (o.body) runs.push({ text: o.body, options: { fontSize: o.size ?? 13, color: dark ? 'E8EDF2' : INK, fontFace: o.mono ? MONO : undefined } })
  s.addText(runs, { x: o.x + 0.12, y: o.y + 0.08, w: o.w - 0.24, h: o.h - 0.16, valign: o.valign ?? 'middle', align: o.align ?? 'center', isTextBox: true, margin: 0 })
}

function arrow(s, x1, y1, x2, y2, label, o = {}) {
  s.addShape(pres.shapes.LINE, {
    x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) || 0.001, h: Math.abs(y2 - y1) || 0.001,
    flipH: x2 < x1, flipV: y2 < y1, line: { color: o.color ?? MUTED, width: 1.5, endArrowType: 'triangle', dashType: o.dash },
  })
  if (label) s.addText(label, { x: o.lx ?? (Math.min(x1, x2) + Math.abs(x2 - x1) / 2 - 1), y: o.ly ?? (Math.min(y1, y2) + Math.abs(y2 - y1) / 2 - 0.32), w: o.lw ?? 2, h: 0.3, fontSize: 11, color: MUTED, align: 'center', isTextBox: true, margin: 0 })
}

function code(s, text, o = {}) {
  const x = o.x ?? 0.5, y = o.y ?? 1.3, w = o.w ?? 12.3, h = o.h ?? 2
  s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: CODEBG }, line: { color: 'DDDDDD', width: 0.75 }, objectName: 'code' })
  if (o.label) s.addText(o.label, { x: x + 0.15, y: y + 0.08, w: w - 0.3, h: 0.28, fontSize: 11, color: MUTED, isTextBox: true, margin: 0 })
  s.addText(text, { x: x + 0.15, y: y + (o.label ? 0.38 : 0.12), w: w - 0.3, h: h - (o.label ? 0.48 : 0.24), fontSize: o.size ?? 13, fontFace: MONO, color: INK, valign: 'top', isTextBox: true, margin: 0 })
}

function table(s, rows, o = {}) {
  const size = o.size ?? 13
  const data = rows.map((r, i) => r.map((c) => ({
    text: c,
    options: i === 0
      ? { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: size }
      : { color: INK, fontSize: size, fill: { color: i % 2 ? 'FFFFFF' : 'F6F8FA' }, fontFace: o.monoCols?.includes(r.indexOf(c)) ? MONO : undefined },
  })))
  s.addTable(data, { x: o.x ?? 0.5, y: o.y ?? 1.3, w: o.w ?? 12.3, colW: o.colW, border: { type: 'solid', pt: 0.5, color: 'D5DBE1' }, margin: [0.05, 0.08, 0.05, 0.08], valign: 'middle', autoPage: false })
}

section = 'Start here'
pres.addSection({ title: section })
{
  const s = pres.addSlide({ sectionTitle: section })
  s.background = { color: 'FFFFFF' }
  s.addText('TRACES Developer Guide', { x: 0.8, y: 2.0, w: 11.7, h: 1.1, fontSize: 44, bold: true, color: INK, isTextBox: true, margin: 0 })
  s.addText([
    { text: 'The whole system and the whole codebase, explained from zero.', options: { breakLine: true } },
    { text: 'For a new developer who has never seen it, and maybe never built a web app.' },
  ], { x: 0.8, y: 3.2, w: 11.7, h: 1.0, fontSize: 20, color: INK, isTextBox: true, margin: 0, valign: 'top' })
  s.addText('Tagged Records of Accountable Equipment and Supplies   ·   Supply Unit, DOST Region 1', { x: 0.8, y: 5.6, w: 11.7, h: 0.4, fontSize: 14, color: MUTED, isTextBox: true, margin: 0 })
  s.addShape(pres.shapes.OVAL, { x: 0.8, y: 1.45, w: 0.35, h: 0.35, fill: { color: RED }, line: { color: RED } })
}

{
  const s = content('How to use this guide')
  bullets(s, [
    ['Go in order.', 'Each part builds on the one before it. Part 1 has no code at all.'],
    ['Grey boxes say it again in everyday words.', 'Read the box first if a slide feels hard.'],
    ['Grey code boxes are real code', 'copied from the repository. The file name is written on top so you can open it.'],
    ['A path like server/src/app.ts', 'means: open the folder server, then src, then the file app.ts.'],
    ['Names in examples are made up', '(Juan Dela Cruz, Maria Santos). The repository is public, so real names never go in it.'],
    ['When the guide and the code disagree,', 'the code is right about what happens today, and the spec (docs/plans) is right about what should happen. Ask before you "fix" either.'],
  ], { h: 4.1 })
  plain(s, 'Nobody expects you to understand everything on the first read. Read it once quickly, run the app, then read it again with the code open next to it.')
}

{
  const s = content('Programming words in plain language (1 of 2)')
  table(s, [
    ['Word', 'What it means here'],
    ['Server / back end', 'A program on a computer that waits for requests, does the work, and answers. In TRACES it is server/.'],
    ['Client / front end', 'The screens you see in the browser. In TRACES it is client/. It never touches the database directly.'],
    ['API', 'The list of requests the server understands, like a menu. Example: POST /api/issuances means "save this issuance".'],
    ['Endpoint / route', 'One item on that menu: a method (GET = read, POST = create, PATCH = change, PUT = replace, DELETE = remove) plus an address.'],
    ['JSON', 'The text format the client and server use to send data to each other: { "qty": 1, "unit": "set" }.'],
    ['Database', 'Where everything is stored for good. TRACES uses PostgreSQL. Data lives in tables (like sheets in Excel).'],
    ['Table / row / column', 'Table = one sheet (officers). Row = one record (one officer). Column = one field (full_name).'],
    ['SQL', 'The language used to ask the database for data or change it.'],
  ], { colW: [2.6, 9.7], size: 14 })
}

{
  const s = content('Programming words in plain language (2 of 2)')
  table(s, [
    ['Word', 'What it means here'],
    ['Transaction', 'A group of database changes that succeed together or fail together. Never half saved.'],
    ['Migration', 'A numbered SQL file that changes the database structure (adds a table or a column). Run once, in order.'],
    ['View', 'A saved question to the database that looks like a table but stores nothing. The card and the registry are views.'],
    ['Schema (two meanings)', 'Database schema = the list of tables and columns. Zod schema = the rules a request body must follow.'],
    ['Session / cookie', 'After you log in, the browser keeps a small ticket (cookie). The server looks the ticket up to know who you are.'],
    ['Component', 'A reusable piece of screen in React, written as a function that returns what to draw (a button, a page).'],
    ['Hook', 'A React function whose name starts with use, e.g. useQuery. It gives a component data or memory.'],
    ['Test', 'Code that runs your code and checks the answer. If a test fails, something broke.'],
    ['Commit / push', 'Commit = save a snapshot of your changes in git. Push = send it to GitHub.'],
  ], { colW: [2.6, 9.7], size: 14 })
}

part('Part 1. What TRACES does', 'No code yet. If you understand this part, the code will make sense.')

{
  const s = content('The job in one picture')
  box(s, { x: 0.5, y: 1.5, w: 2.8, h: 1.5, title: 'Supply Unit', body: 'buys property and hands it to staff', fill: NAVY })
  box(s, { x: 5.25, y: 1.5, w: 2.8, h: 1.5, title: 'Accountable officer', body: 'receives it and is responsible for it', fill: NAVY })
  box(s, { x: 10.0, y: 1.5, w: 2.8, h: 1.5, title: 'COA / inventory', body: 'counts everything once in a while', fill: NAVY })
  arrow(s, 3.3, 2.25, 5.25, 2.25, 'hands over a laptop', { lw: 2 })
  arrow(s, 8.05, 2.25, 10.0, 2.25, 'asks: where is it?', { lw: 2 })
  box(s, { x: 0.5, y: 3.5, w: 3.9, h: 1.7, title: 'Paper before TRACES', body: 'ICS / PAR slips, cards and registries typed by hand in Excel. Easy to lose, slow to count.', titleColor: RED })
  box(s, { x: 4.7, y: 3.5, w: 3.9, h: 1.7, title: 'TRACES records it once', body: 'One form entry fills the slip, the card, the registry and the count report.' })
  box(s, { x: 8.9, y: 3.5, w: 3.9, h: 1.7, title: 'A QR sticker on the item', body: 'Scan it with any phone to see what it is, who holds it and the signed slip.' })
  plain(s, 'TRACES is a record book for government property. It remembers who received what, prints the official forms, and puts a QR sticker on each item so anyone can check it.')
}

{
  const s = content('Words from the supply office')
  table(s, [
    ['Word', 'Meaning', 'Where in the code'],
    ['ICS', 'Inventory Custodian Slip: given for semi-expendable property (cost below ₱50,000)', "documents.type = 'ICS'"],
    ['PAR', 'Property Acknowledgment Receipt: the same for PPE (₱50,000 or more)', "documents.type = 'PAR'"],
    ['Semi / PPE', 'The two categories. The cost decides it (business rule BR-01)', "lines.category: 'semi' | 'ppe'"],
    ['Card (SPC / PC)', 'Property card of one property, e.g. laptop 2026-11ICT-0017', 'view v_property_card'],
    ['Registry', 'List of everything issued, per category and property type', 'view v_registry'],
    ['RPCSP / RPCPPE', 'Physical count report: what one officer holds on a date', 'function fn_officer_report'],
    ['Property number', 'Number of one physical unit, e.g. 2026-05ICT-0017', 'properties.property_no'],
    ['Component', 'A part of a set (the mouse of a laptop set). Own number and sticker', 'properties.component_label'],
    ['Accountable officer', 'The person who received and answers for the item', 'officers (can_receive = true)'],
  ], { colW: [2.3, 6.4, 3.6], size: 13, monoCols: [2] })
}

{
  const s = content('The life of one laptop')
  const steps = [
    ['1  Bought', 'Supply receives it (date acquired)'],
    ['2  Entered', 'New issuance page: model, cost, numbers, receiver'],
    ['3  Form made', 'TRACES makes the PAR PDF'],
    ['4  Signed', 'Printed, signed by both sides'],
    ['5  Uploaded', 'Scan uploaded; the PAR is now locked'],
    ['6  Stickered', 'QR sticker printed and stuck on'],
    ['7  Counted', 'Count report printed, items counted'],
  ]
  const w = 1.6, gap = 0.18
  steps.forEach(([t, b], i) => {
    const x = 0.5 + i * (w + gap)
    box(s, { x, y: 1.6, w, h: 1.9, title: t, body: b, fill: i === 1 ? RED : (i === 4 ? NAVY : 'FFFFFF'), size: 12, titleSize: 14 })
    if (i < steps.length - 1) arrow(s, x + w, 2.55, x + w + gap, 2.55)
  })
  bullets(s, [
    ['Step 2 is the only data entry.', 'Everything after it is made from that one save.'],
    ['In the database, step 2 writes two movements per unit:', 'RECEIPT (supply got it) and ISSUE (officer got it).'],
    ['Step 5 is the lock.', 'Once a signed copy exists, nothing on that form can change (error 409 DOCUMENT_SIGNED).'],
  ], { y: 3.9, h: 1.5 })
  plain(s, 'Think of a parcel: it arrives, it is logged, the receiver signs, the signed paper is filed, and a label goes on the box so anyone can look it up later.')
}

{
  const s = content('Who uses TRACES')
  box(s, { x: 0.5, y: 1.5, w: 3.9, h: 2.4, title: 'Supply admin', body: 'Staff of the Supply Unit. Enters issuances, uploads signed copies, prints stickers and reports. Reads (does not change) officers and property types.\nrole: supply_admin', valign: 'top', align: 'left' })
  box(s, { x: 4.7, y: 1.5, w: 3.9, h: 2.4, title: 'Superadmin', body: 'Everything a supply admin can do, plus officers, property types, office units, user accounts, settings and the audit log.\nrole: superadmin', valign: 'top', align: 'left' })
  box(s, { x: 8.9, y: 1.5, w: 3.9, h: 2.4, title: 'Anyone with a phone', body: 'Scans a sticker and opens /q/<token>. No login. Sees only the public fields of that one item (BR-12).', valign: 'top', align: 'left' })
  bullets(s, [
    ['Officers do not log in.', 'They are records (the officers table), not users. Only Supply staff have accounts.'],
    ['Account email is made from the name:', 'short name + @region1.dost.gov.ph, e.g. Juan Dela Cruz -> jdelacruz@region1.dost.gov.ph.'],
  ], { y: 4.2, h: 1.2 })
  plain(s, 'Two kinds of staff accounts, one public page. The public page shows one item at a time and never lists or searches anything.')
}

part('Part 2. The big picture', 'The four programs that make TRACES, and how the folders are arranged.')

{
  const s = content('PERN: the four parts, as an office')
  const parts = [
    ['PostgreSQL', 'The filing cabinet', 'Keeps every record. Refuses papers that break the rules.'],
    ['Express', 'The clerk at the counter', 'Takes each request, checks it, does the work, answers.'],
    ['React', 'The forms and screens', 'What you click in the browser. Asks the clerk for data.'],
    ['Node.js', 'The building', 'The program that runs the clerk (Express) and our tools.'],
  ]
  parts.forEach(([name, as, what], i) => {
    const x = 0.5 + i * 3.1
    box(s, { x, y: 1.5, w: 2.9, h: 0.8, title: name, fill: NAVY, titleSize: 18 })
    para(s, as, { x, y: 2.45, w: 2.9, h: 0.4, bold: true, color: RED, align: 'center' })
    para(s, what, { x, y: 2.9, w: 2.9, h: 1.0, size: 15, align: 'center' })
  })
  bullets(s, [
    ['TypeScript', 'is JavaScript with types: it checks before running that you pass a number where a number is expected. All code here is TypeScript (.ts / .tsx).'],
    ['Drizzle', 'is how TypeScript talks to PostgreSQL. Zod checks the shape of data. Vite runs the React app while you develop.'],
  ], { y: 4.2, h: 1.3 })
  plain(s, 'Browser (React) asks, server (Express on Node) answers, database (PostgreSQL) remembers. That is the whole architecture.')
}

{
  const s = content('How a click becomes a saved record')
  box(s, { x: 0.5, y: 1.6, w: 2.7, h: 1.4, title: 'Browser', body: 'React app\nhttp://<laptop>:5173', fill: NAVY })
  box(s, { x: 3.9, y: 1.6, w: 2.4, h: 1.4, title: 'Vite dev server', body: 'serves the screens, passes /api on' })
  box(s, { x: 7.0, y: 1.6, w: 2.7, h: 1.4, title: 'Express API', body: 'server/ on :3000', fill: NAVY })
  box(s, { x: 10.4, y: 1.6, w: 2.4, h: 1.4, title: 'PostgreSQL', body: 'traces_dev on :5432 (Docker)', fill: NAVY })
  arrow(s, 3.2, 2.3, 3.9, 2.3)
  arrow(s, 6.3, 2.3, 7.0, 2.3, '/api/...', { lw: 1.2, lx: 6.05 })
  arrow(s, 9.7, 2.3, 10.4, 2.3, 'SQL', { lw: 1, lx: 9.55 })
  box(s, { x: 7.0, y: 3.6, w: 2.7, h: 1.0, title: 'storage/pdfs', body: 'PDF files on disk' })
  arrow(s, 8.35, 3.0, 8.35, 3.6)
  bullets(s, [
    ['In development', 'two programs run: Vite (5173) and the API (3000). Vite forwards every /api request to the API (client/vite.config.ts, "proxy").'],
    ['In production', 'one Node process serves both the built screens and the API from one address, so there is no CORS (server/src/app.ts, bottom).'],
  ], { y: 4.85, w: 6.3, h: 1.9, size: 14 })
  plain(s, 'The browser only ever talks to one address. Anything starting with /api goes to the server; everything else is a screen.', { x: 7.0, y: 4.85, w: 5.8, h: 1.9 })
}

{
  const s = content('The repository: three apps in one')
  const cols = [
    ['shared/', 'Rules both sides need', 'Zod schemas (what a valid request looks like) and small helpers: money, dates, category, property numbers, names.'],
    ['server/', 'The API', 'Express routes, services (the real work), database schema, migrations, PDF and Excel makers, scripts, tests.'],
    ['client/', 'The screens', 'React pages, components, the router and data hooks. Built with Vite and Tailwind.'],
  ]
  cols.forEach(([name, what, body], i) => {
    const x = 0.5 + i * 4.15
    box(s, { x, y: 1.5, w: 3.95, h: 0.7, title: name, fill: i === 0 ? RED : NAVY, titleSize: 18 })
    para(s, what, { x, y: 2.35, w: 3.95, h: 0.4, bold: true })
    para(s, body, { x, y: 2.8, w: 3.95, h: 1.4, size: 14 })
  })
  para(s, 'server/ and client/ both import shared/ under the name @traces/shared. shared/ imports neither.', { y: 4.25, h: 0.4, size: 14, color: MUTED })
  table(s, [
    ['Also at the top', 'What is in it'],
    ['e2e/', 'Browser tests (Playwright): click through the real app in Chrome'],
    ['docs/', 'The spec and plans (docs/plans), DEPLOY.md, the user manual and this guide'],
    ['scripts/', 'Builders for the manual and this deck'],
    ['package.json', 'npm "workspaces": one npm install for all three apps, and the npm run commands'],
  ], { y: 4.85, colW: [2.3, 10.0], size: 13 })
}

{
  const s = content('Inside server/src')
  table(s, [
    ['Folder', 'What lives there', 'Example'],
    ['index.ts, app.ts', 'Starts the server; app.ts plugs every middleware and route together', 'createApp()'],
    ['routes/', 'Thin files: one per area. Check login and role, validate, call a service, send the answer', 'routes/issuances.ts'],
    ['services/', 'The real work. Database reads and writes, inside transactions, with audit rows', 'services/issuances.ts'],
    ['middleware/', 'Things every request passes through: session, auth, Origin check, upload, errors', 'middleware/error.ts'],
    ['db/', 'schema.ts (tables), views.ts (views as TypeScript), client.ts (the connection)', 'db/schema.ts'],
    ['projections/', 'Pure functions that reshape view rows for display, no database', 'projections/card.ts'],
    ['forms/', 'Draws the ICS / PAR PDF (Appendix 59 / 71) with pdf-lib', 'forms/icsPar.ts'],
    ['exports/', 'Fills the Excel templates (card, registry, count report) with exceljs', 'exports/templates/*.xlsx'],
    ['scripts/', 'Command-line jobs: seed, backup, reset password, set LAN address', 'scripts/seed-dev.ts'],
    ['test/', 'API tests (Vitest + supertest) against the traces_test database', 'test/issuances.test.ts'],
  ], { colW: [2.2, 7.1, 3.0], size: 13, monoCols: [2] })
  para(s, 'server/drizzle/ (outside src) holds the numbered migrations 0000 to 0008.', { y: 6.45, h: 0.35, size: 14, color: MUTED })
}

{
  const s = content('Inside client/src')
  table(s, [
    ['Folder / file', 'What lives there'],
    ['main.tsx', 'Starts React; wraps the app in React Query, the login provider and the toast popups'],
    ['router.tsx', 'Which address opens which page, and which role may see it'],
    ['api.ts', 'The one function that calls the server (fetch). Turns error answers into ApiError'],
    ['auth/', 'AuthProvider (who is logged in) and RequireRole (the door guard for pages)'],
    ['layouts/AdminLayout.tsx', 'The frame around every staff page: the dark side menu and the page area'],
    ['pages/', 'One folder per area: issue, documents, cards, registry, reports, stickers, officers, admin, public'],
    ['components/', 'Our own pieces: OfficerPicker, PdfViewer, PageHeader, Loading skeletons...'],
    ['components/ui/', 'Basic building blocks from shadcn (button, input, dialog, table). Do not edit lightly'],
    ['lib/', 'queries.ts (data hooks like useOfficers), propertyView.ts (grid columns), utils.ts'],
  ], { colW: [3.2, 9.1], size: 14 })
}

part('Part 3. Running it on your laptop', 'From an empty computer to the login page.')

{
  const s = content('First-time setup, step by step')
  bullets(s, [
    'Install Node.js 22 or newer, Git, Docker Desktop and Google Chrome.',
    'Get the code: git clone <repository address>, then open the traces folder.',
    'Copy server/.env.example to server/.env (settings for your laptop, never committed).',
    'Start the database: docker compose up -d db',
    'Install the libraries for all three apps: npm install',
    'Create the tables: npm run db:migrate',
    'Make your login: npm run seed:superadmin -- --email you@example.com --password <10+ characters>',
    'Optional sample data with made-up names: npm run seed:dev -- --reset',
    'Start everything: npm run dev, then open http://localhost:5173',
  ], { numbered: true, h: 4.3, size: 16, gap: 7 })
  plain(s, 'Docker runs PostgreSQL in a box so you do not install it yourself. If the page does not load, check that Docker Desktop is running and that nothing else uses ports 3000, 5173 or 5432.')
}

{
  const s = content('The commands you will use every day')
  table(s, [
    ['Command', 'What it does'],
    ['npm run dev', 'Database + API (:3000) + screens (:5173). Ctrl+C stops both'],
    ['npm test', 'Unit and API tests (shared + server) on the traces_test database'],
    ['npm run test:e2e', 'Browser tests in Chrome on ports 3100 / 5273, with accessibility checks'],
    ['npm run db:generate', 'After you change db/schema.ts: writes the next migration file'],
    ['npm run db:migrate', 'Applies migrations that have not run yet'],
    ['npm run db:studio', 'Opens a web page to look at the tables'],
    ['npm run seed:dev -- --reset', 'Wipes and refills sample data (add --more for a bigger set)'],
    ['npm run seed:officers -- <file.csv>', 'Loads the officers list from a CSV (real names: keep the file out of git)'],
    ['npm run lan', 'Finds the laptop address so phones on the same Wi-Fi can open the app'],
    ['npm run reset:password -- --email ... --generate', 'Gives a user a new temporary password'],
    ['npm run backup', 'Dumps the database and PDFs to a backup'],
    ['npm run build  then  npm start', 'Production: build everything, then run one Node process'],
  ], { colW: [4.6, 7.7], size: 13, monoCols: [0] })
}

{
  const s = content('server/.env: the settings file')
  code(s, [
    'PORT=3000',
    'DATABASE_URL=postgres://traces:traces@127.0.0.1:5432/traces_dev',
    'TEST_DATABASE_URL=postgres://traces:traces@127.0.0.1:5432/traces_test',
    'SESSION_SECRET=change-me-to-64-random-chars',
    'APP_ORIGIN=http://localhost:5173',
    'STORAGE_DIR=./storage',
    'PUBLIC_RATE_LIMIT_PER_MIN=60',
    'LOGIN_RATE_LIMIT=10',
  ].join('\n'), { label: 'server/.env.example (copy it to server/.env)', w: 6.6, h: 3.6, size: 13 })
  bullets(s, [
    ['DATABASE_URL', 'where the dev database is.'],
    ['TEST_DATABASE_URL', 'the separate database tests wipe and refill. Tests never use the other one.'],
    ['SESSION_SECRET', 'signs the login cookie. Long and random in production.'],
    ['APP_ORIGIN', 'addresses allowed to send changes (the Origin check).'],
    ['STORAGE_DIR', 'folder for the PDF files.'],
  ], { x: 7.4, w: 5.4, h: 4.0, size: 14 })
  plain(s, '.env holds secrets and is ignored by git. Never commit it, never paste its contents anywhere public.')
}

part('Part 4. The database', 'Where the truth lives. Learn this part well: the rest of the code follows from it.')

{
  const s = content('Rule number one: the database is the boss')
  bullets(s, [
    ['Foreign key (FK):', 'a line must point to a real document and a real card. You cannot save a line for a document that does not exist.'],
    ['UNIQUE:', 'no two properties may have the same number (case ignored); no two ICS with the same number.'],
    ['CHECK:', 'quantity > 0, cost >= 0, property type code is 2 to 8 capital letters, settings has exactly one row.'],
    ['Partial unique index:', 'each property has at most one active QR token (revoked ones do not count).'],
  ], { h: 2.9 })
  code(s, "check('lines_qty_positive', sql`${t.qty} > 0`),\nuniqueIndex('properties_property_no_uq').on(sql`upper(${t.propertyNo})`),", { label: 'server/src/db/schema.ts', y: 4.15, h: 1.15, size: 13 })
  plain(s, 'Even if our code has a bug, the database refuses bad data. So never loosen a rule to make a test pass. Fix the code instead.')
}

{
  const s = content('The tables and how they connect')
  const B = (x, y, title, body, fill) => box(s, { x, y, w: 2.35, h: 0.95, title, body, size: 11, titleSize: 13, fill })
  B(0.5, 1.4, 'officers', 'who receives / issues', NAVY)
  B(0.5, 3.1, 'documents', 'one ICS or PAR', NAVY)
  B(3.6, 3.1, 'lines', 'one row of the form', NAVY)
  B(3.6, 1.4, 'v_property_card', 'the card: a view, one per property')
  B(6.7, 1.4, 'property_types', 'ICT, FF, OE ...')
  B(6.7, 3.1, 'properties', 'one physical unit', NAVY)
  B(9.8, 3.1, 'qr_tokens', 'the sticker code')
  B(6.7, 4.8, 'movements', 'RECEIPT, ISSUE ... (ledger)', RED)
  B(0.5, 4.8, 'document_files', 'generated / uploaded PDF')
  B(3.6, 4.8, 'line_pdf_regions', 'box of a line on the PDF')
  B(9.8, 1.4, 'officer_designations', 'programs of an officer (-> officers)')
  arrow(s, 1.675, 3.1, 1.675, 2.35, 'received by / issued by', { lw: 2.6, lx: 1.8, ly: 2.55 })
  arrow(s, 3.6, 3.575, 2.85, 3.575)
  arrow(s, 5.95, 3.4, 6.7, 2.1, 'property_type_id', { lw: 1.6, lx: 6.45, ly: 2.75 })
  arrow(s, 6.7, 3.575, 5.95, 3.575)
  arrow(s, 9.8, 3.575, 9.05, 3.575)
  arrow(s, 7.875, 4.8, 7.875, 4.05)
  arrow(s, 1.675, 4.8, 1.675, 4.05)
  arrow(s, 4.775, 4.8, 4.775, 4.05)
  para(s, 'An arrow points from the table that holds the link to the table it points at. Not drawn: users, session, settings, report_signatories, audit_logs.', { x: 0.5, y: 5.95, w: 12.3, h: 0.7, size: 13, color: MUTED })
  plain(s, 'A document has lines; a line carries its item and has properties; each property has a sticker, a history and its own card.', { x: 9.8, y: 4.7, w: 3.0, h: 1.2, size: 12 })
}

{
  const s = content('The main tables in one sentence each')
  table(s, [
    ['Table', 'One row is ...'],
    ['users', 'a staff login (email, argon2id password hash, role, must_change_password)'],
    ['officers', 'a person who can be "Received by" or "Issued by"; short_name is computed from full_name'],
    ['documents', 'an ICS or PAR header: number, date, fund cluster, who issued, who received, positions as printed'],
    ['lines', 'one row of a form: property type, category, article, unit, one description, quantity, unit cost (centavos), date acquired'],
    ['properties', 'one physical unit: property number, serial, condition; component_label set = part of a set'],
    ['qr_tokens', 'the 10-character sticker code of a property; revoked_at set when replaced'],
    ['movements', 'one event in a property\'s life: RECEIPT, ISSUE, RETURN, REISSUE or DISPOSE, with a date'],
    ['document_files', 'a PDF of a document: kind generated (TRACES drew it) or uploaded (the signed scan)'],
    ['settings', 'the one row of office settings: PPE threshold, default fund cluster, public address, form codes'],
    ['units', 'office units whose code goes inside ICS/PAR numbers (2026-11SARAi-001); kept by the IT officer'],
    ['audit_logs', 'one change anyone made: who, what, before, after, IP address, when'],
  ], { colW: [2.3, 10.0], size: 13, monoCols: [0] })
}

{
  const s = content('Movements: a bank statement for every item')
  table(s, [
    ['date', 'type', 'officer', 'what it means'],
    ['2026-05-01', 'RECEIPT', '', 'Supply received the laptop (balance on the card goes up by 1)'],
    ['2026-05-12', 'ISSUE', 'Maria Santos', 'Maria received it (who holds it changes, balance stays)'],
  ], { colW: [1.8, 1.7, 2.4, 6.4], size: 14, monoCols: [0, 1] })
  bullets(s, [
    ['Balance on the card (BR-08)', '= all RECEIPT minus all DISPOSE, added up in date order. Who holds it = the latest ISSUE.'],
    ['RETURN, REISSUE and DISPOSE', 'also exist in the database, only because the official registry and cards print Returned, Re-issued and Disposed columns. TRACES never records them (out of scope), so those columns stay 0.'],
    ['Nothing is ever overwritten.', 'History is added, row by row, like a ledger.'],
  ], { y: 2.6, h: 2.8 })
  plain(s, 'You never store "Maria has 4 laptops". You store what happened, and the database adds it up when you ask.')
}

{
  const s = content('Never store a total (3NF)')
  bullets(s, [
    ['3NF ("third normal form")', 'means each fact is stored once, in one place. Anything that can be worked out is worked out, not saved.'],
    ['So the three "sheets" are not tables.', 'They are calculated every time from the real tables:'],
  ], { h: 1.6 })
  box(s, { x: 0.5, y: 3.0, w: 3.9, h: 1.5, title: 'Card', body: 'view v_property_card\none card per property', fill: NAVY })
  box(s, { x: 4.7, y: 3.0, w: 3.9, h: 1.5, title: 'Registry', body: 'view v_registry\none row per line', fill: NAVY })
  box(s, { x: 8.9, y: 3.0, w: 3.9, h: 1.5, title: 'Count report', body: 'fn_officer_report(as_at)\nwhat each officer holds on a date', fill: NAVY })
  bullets(s, [
    'No column for totals, amounts, balances or shortages. No "count" tables. The count columns of the report are printed blank for hand counting.',
    'Example: the registry\'s No. column is row_number() in v_registry, worked out on every read; nothing stores it.',
  ], { y: 4.75, h: 1.0, size: 14 })
  plain(s, 'If you save a total, sooner or later it disagrees with the rows it came from. If you always calculate it, it can never be wrong.', { y: 5.85, h: 1.0 })
}

{
  const s = content('Money and dates: two traps avoided')
  box(s, { x: 0.5, y: 1.5, w: 6.0, h: 2.5, title: 'Money = whole centavos', body: '₱96,450.00 is stored as 9645000\n(bigint, never a decimal number)\n\nComputers round 0.1 + 0.2 to 0.30000000000000004. Whole numbers never round.', valign: 'top', align: 'left' })
  box(s, { x: 6.8, y: 1.5, w: 6.0, h: 2.5, title: 'Dates = plain text "YYYY-MM-DD"', body: 'issued_date: "2026-05-12"\n(Postgres date, read as a string)\n\nA JavaScript Date carries a time zone and can slip to the day before. A string cannot.', valign: 'top', align: 'left' })
  code(s, "pesoToCentavos('96,450.00')   // 9645000\nformatPeso(9645000)           // '₱96,450.00'\ncategorize(9645000, 5000000)  // 'ppe'  (at or above ₱50,000)", { label: 'shared/src/utils/money.ts and category.ts', y: 4.3, h: 1.45 })
  plain(s, 'Pesos travel as whole centavos and dates as text. Convert only when showing them on screen.', { y: 6.0, h: 0.85 })
}

{
  const s = content('Changing the database: migrations')
  const st = [
    ['1  Edit', 'server/src/db/schema.ts'],
    ['2  Generate', 'npm run db:generate'],
    ['3  Read it', 'drizzle/0009_*.sql'],
    ['4  Apply', 'npm run db:migrate'],
    ['5  Commit', 'schema, .sql, meta/'],
  ]
  st.forEach(([t, b], i) => {
    const x = 0.5 + i * 2.5
    box(s, { x, y: 1.5, w: 2.2, h: 1.3, title: t, body: b, fill: i === 0 ? NAVY : 'FFFFFF', mono: true, size: 10 })
    if (i < st.length - 1) arrow(s, x + 2.2, 2.15, x + 2.5, 2.15)
  })
  bullets(s, [
    ['Views and functions are written by hand', 'in SQL inside the migrations (0001, 0005, 0008). db/views.ts only describes their columns to TypeScript.'],
    ['To change a view:', 'write a new migration that drops it and creates it again. Never edit an old migration that already ran.'],
    ['The reference DDL', 'docs/plans/traces-schema.sql is the tested design. Do not redesign it; raise a question first.'],
  ], { y: 3.15, h: 2.3 })
  plain(s, 'A migration is a numbered instruction like "add a column". Every laptop and server runs the same list in the same order, so all databases end up identical.')
}

part('Part 5. The server', 'What happens between a click and a saved row.')

{
  const s = content('The journey of one request')
  const st = [
    ['helmet', 'safe headers'],
    ['originCheck', 'came from our page?'],
    ['express.json', 'read the body'],
    ['session', 'who is this cookie?'],
    ['requireRole', 'logged in, right role?'],
    ['validate(zod)', 'body shaped right?'],
    ['service', 'do the work in a transaction'],
  ]
  st.forEach(([t, b], i) => {
    const x = 0.5 + i * 1.78
    box(s, { x, y: 1.5, w: 1.58, h: 1.3, title: t, body: b, fill: i === 6 ? RED : NAVY, size: 11, titleSize: 13 })
    if (i < st.length - 1) arrow(s, x + 1.58, 2.15, x + 1.78, 2.15)
  })
  box(s, { x: 0.5, y: 3.25, w: 12.3, h: 0.8, title: 'errorHandler (middleware/error.ts)', body: 'any step can throw: the error is turned into { error: { code, message, details } } with the right status number', fill: 'FFFFFF' })
  arrow(s, 6.65, 2.8, 6.65, 3.25, '', { dash: 'dash' })
  code(s, [
    "r.use('/issuances', requireRole('supply_admin', 'superadmin'))",
    "r.post('/issuances', validate(issuanceInput), async (req, res) =>",
    '  res.status(201).json(await createIssuance(req.body, ctx(req))))',
  ].join('\n'), { label: 'server/src/routes/issuances.ts: a whole route file is this small', y: 4.3, h: 1.35 })
  plain(s, 'Every request walks past the same row of guards. A route only connects the guards to one service function.', { y: 5.9, h: 0.95 })
}

{
  const s = content('Layers: who is allowed to do what')
  table(s, [
    ['Layer', 'Its job', 'Must not'],
    ['routes/', 'Pick the guard (requireRole), validate the body, call one service, send the status', 'contain business logic or SQL'],
    ['services/', 'Read and write the database, run business rules (BR-xx), add audit rows', 'know about req / res'],
    ['projections/, forms/', 'Pure functions: rows in, shaped rows or PDF bytes out', 'touch the database or files'],
    ['db/', 'Describe tables and views to TypeScript', 'contain logic'],
    ['shared/', 'Schemas and helpers used by both server and client', 'import from server or client'],
  ], { colW: [2.5, 6.4, 3.4], size: 14 })
  plain(s, 'Like a restaurant: the waiter (route) takes the order, the cook (service) cooks, the recipe card (projection) is just instructions. A waiter who cooks makes a mess.', { y: 4.6, h: 1.2 })
}

{
  const s = content('The most important function: createIssuance')
  bullets(s, [
    'Opens one transaction. Everything below is saved together or not at all.',
    'Sorts every row: below the PPE threshold -> ICS, at or above -> PAR (BR-01).',
    'Needs the ICS number if any row is semi, the PAR number if any row is PPE (else 400 DOC_NO_REQUIRED). The form fills both in from GET /api/document-numbers/next for the chosen office unit (YYYY-MM{UNIT}-NNN, e.g. 2026-11SARAi-001); the user can change them.',
    'Checks the receiver may receive (officers.can_receive).',
    'Checks every property number of the whole form before writing anything (409 DUPLICATE_PROPERTY_NO lists them all).',
    'Inserts the document(s), then each row with insertLineTx (next slide), plus audit rows.',
    'After the commit: draws the PDFs. If drawing fails the data stays and the answer carries a warning.',
  ], { numbered: true, w: 7.4, h: 5.3, size: 15 })
  box(s, { x: 8.2, y: 1.3, w: 4.6, h: 1.2, title: 'Where', body: 'server/src/services/issuances.ts\ncalled by POST /api/issuances', valign: 'top', align: 'left', mono: false })
  plain(s, 'One form on the screen can become several papers: one ICS for the cheap items and one PAR for each expensive unit. All are saved in one go.', { x: 8.2, y: 2.8, w: 4.6, h: 2.0 })
}

{
  const s = content('What one row of the form writes')
  box(s, { x: 0.5, y: 1.5, w: 2.6, h: 1.0, title: 'lines', body: '1 row', fill: NAVY })
  box(s, { x: 3.6, y: 1.5, w: 2.6, h: 1.0, title: 'the card', body: 'a view: nothing to write' })
  box(s, { x: 0.5, y: 3.0, w: 2.6, h: 1.0, title: 'properties', body: '1 per unit and component', fill: NAVY })
  box(s, { x: 3.6, y: 3.0, w: 2.6, h: 1.0, title: 'qr_tokens', body: '1 per property' })
  box(s, { x: 0.5, y: 4.5, w: 2.6, h: 1.0, title: 'movements', body: 'RECEIPT + ISSUE per property', fill: RED })
  box(s, { x: 3.6, y: 4.5, w: 2.6, h: 1.0, title: 'audit_logs', body: "'line.create'" })
  arrow(s, 3.6, 2.0, 3.1, 2.0)
  arrow(s, 1.8, 2.5, 1.8, 3.0)
  arrow(s, 3.1, 3.5, 3.6, 3.5)
  arrow(s, 1.8, 4.0, 1.8, 4.5)
  para(s, 'Example: 1 laptop set with a mouse', { x: 6.8, y: 1.5, w: 6.0, h: 0.4, bold: true })
  bullets(s, [
    '1 line (qty 1: the mouse does not count)',
    '2 properties: 2026-05ICT-0199 and 2026-05ICT-0199a (component "Mouse")',
    '2 QR tokens, so 2 stickers',
    '4 movements: RECEIPT on the date acquired, ISSUE on the form date, for each',
  ], { x: 6.8, y: 2.0, w: 6.0, h: 2.6, size: 15 })
  code(s, 'server/src/services/lines.ts\n  insertLineTx()  -> insertProperties()', { x: 6.8, y: 4.6, w: 6.0, h: 0.9, size: 13 })
  plain(s, 'Quantities count main units only. Components ride on their main unit\'s row everywhere but still get their own number and sticker.', { y: 5.8, h: 1.0 })
}

{
  const s = content('When something goes wrong: errors')
  table(s, [
    ['Cause', 'Status', 'code in the answer'],
    ['Body does not match the zod schema', '400', 'VALIDATION (with the list of problems)'],
    ['Postgres 23505: a UNIQUE rule broke', '409', 'DUPLICATE'],
    ['Postgres 23503: points at something missing (FK)', '400', 'BAD_REFERENCE'],
    ['Postgres 23514: a CHECK rule broke', '400', 'CONSTRAINT_FAILED'],
    ['Not logged in / wrong role', '401 / 403', 'UNAUTHENTICATED / FORBIDDEN'],
    ['Form has a signed copy', '409', 'DOCUMENT_SIGNED'],
    ['Our own rule, thrown in a service', 'any', "new AppError('DOC_NO_REQUIRED', 400, '...')"],
  ], { colW: [5.4, 1.4, 5.5], size: 14, monoCols: [2] })
  plain(s, 'Services throw; one place (middleware/error.ts) turns every error into the same JSON shape. The client reads error.code to show the right message.', { y: 5.4, h: 1.1 })
}

{
  const s = content('Logging in and staying safe')
  bullets(s, [
    ['Passwords', 'are stored only as argon2id hashes (services/users.ts). Nobody can read them back.'],
    ['Sessions', 'live in the session table (connect-pg-simple). The cookie traces.sid is httpOnly and lasts 8 hours of activity.'],
    ['Role read fresh', 'on every request from the users table, so a deactivated user is out at once (middleware/auth.ts).'],
    ['Temporary password', 'forces a change first: every route except /api/me and /api/me/password answers 403.'],
    ['Origin check', 'every change (POST, PATCH, PUT, DELETE) must come from an address in APP_ORIGIN (middleware/origin.ts).'],
    ['Rate limits', 'on login attempts (LOGIN_RATE_LIMIT per address + email in 15 minutes) and on the public QR page (60 a minute per address).'],
    ['No string-built SQL.', 'Only Drizzle or sql`...` with parameters, so typed text can never become a command.'],
  ], { h: 4.4, size: 15 })
  plain(s, 'Locked door (password), visitor badge (cookie), guard who checks the badge every time (role from the database), and a rule that orders only come from inside the building (Origin).')
}

{
  const s = content('PDFs: the generated form and the signed copy')
  box(s, { x: 0.5, y: 1.5, w: 3.6, h: 1.6, title: 'generated', body: 'TRACES draws the ICS / PAR (forms/icsPar.ts, pdf-lib). Can be drawn again until signed.', fill: NAVY })
  box(s, { x: 4.85, y: 1.5, w: 3.6, h: 1.6, title: 'printed and signed', body: 'on paper, outside TRACES' })
  box(s, { x: 9.2, y: 1.5, w: 3.6, h: 1.6, title: 'uploaded', body: 'the scan. Its presence locks the entries: 409 DOCUMENT_SIGNED', fill: RED })
  arrow(s, 4.1, 2.3, 4.85, 2.3)
  arrow(s, 8.45, 2.3, 9.2, 2.3)
  bullets(s, [
    ['document_files', 'holds at most two rows per document: kind generated and kind uploaded.'],
    ['Files sit in STORAGE_DIR/pdfs', 'and are only sent through routes that check access. A replaced or removed signed copy moves to archive/, never deleted.'],
    ['Uploads are checked:', 'size limit 20 MB, PDF content type and the %PDF- header (middleware/upload.ts).'],
    ['line_pdf_regions', 'stores where each line sits on the page (fractions 0 to 1), so the viewer can highlight that row.'],
    ['To correct a signed form:', 'remove the signed copy with a reason, fix, print, sign and upload again.'],
    ['Delete form', 'removes an unsigned ICS / PAR (soft delete). A signed one must have its signed copy removed first. Its numbers stay used.'],
  ], { y: 3.45, h: 3.3, size: 15 })
}

{
  const s = content('QR stickers')
  code(s, "// 10 base62 chars from a CSPRNG: 62^10 ≈ 8e17, so tokens can't be guessed (BR-11).\nexport const newToken = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(62)]).join('')", { label: 'server/src/services/qr.ts', h: 1.3, size: 13 })
  box(s, { x: 0.5, y: 2.9, w: 3.0, h: 1.2, title: 'Sticker', body: 'QR of public_base_url/q/Ab3dE6gH9k' })
  box(s, { x: 4.2, y: 2.9, w: 3.0, h: 1.2, title: 'Phone opens', body: '/q/:token (client QrView)', fill: NAVY })
  box(s, { x: 7.9, y: 2.9, w: 4.9, h: 1.2, title: 'Server answers', body: 'GET /api/public/q/:token\npublic fields only (BR-12)', fill: NAVY })
  arrow(s, 3.5, 3.5, 4.2, 3.5)
  arrow(s, 7.2, 3.5, 7.9, 3.5)
  bullets(s, [
    ['Unknown token:', '404. Replaced (rotated) or removed: 410 Gone.'],
    ['Rotating', 'revokes the old token and makes a new one in one transaction (old sticker stops working).'],
    ['public_base_url', 'in Settings is the address printed in the QR. Print real stickers only after it is the production address.'],
  ], { y: 4.4, h: 1.4, size: 15 })
  plain(s, 'The sticker holds a random 10-letter key, not the property number, so nobody can guess other stickers.', { y: 5.9, h: 0.95 })
}

{
  const s = content('All API routes, grouped')
  table(s, [
    ['Area', 'Routes (all start with /api)'],
    ['Login', 'POST /auth/login · POST /auth/logout · GET /me · POST /me/password'],
    ['Issue', 'POST /issuances · GET /property-numbers/next · GET /document-numbers/next?parCount='],
    ['ICS / PAR', 'GET, POST /documents · GET, PATCH, DELETE /documents/:id · POST /documents/:id/generate'],
    ['PDF files', 'GET, PUT, DELETE /documents/:id/pdf'],
    ['Lines', 'POST /documents/:id/lines(/batch) · GET, PATCH, DELETE /lines/:id · PUT /lines/:id/region'],
    ['Properties', 'GET /properties/:no(/view) · PATCH /properties/:no · POST /properties/:no/qr/rotate · GET /stickers'],
    ['Sheets', 'GET /views/registry · /views/cards · /views/card/:propertyId · PATCH /views/card-rows/:id · /reports/rpc · /reports/forms(.pdf) · /exports/:form · /dashboard'],
    ['Lists', 'GET, POST /officers · PATCH, DELETE /officers/:id · GET, POST /property-types · PATCH /property-types/:id'],
    ['Report footer', 'GET, PUT /report-signatories · GET /settings'],
    ['Public', 'GET /public/q/:token · GET /public/q/:token/pdf   (no login, rate limited)'],
    ['Superadmin', 'GET, POST /admin/users · PATCH /admin/users/:id · GET, PATCH /admin/settings · GET /admin/audit-logs'],
  ], { colW: [2.0, 10.3], size: 13 })
}

part('Part 6. The shared rules', 'shared/: why a rule is written once and used by both the server and the client.')

{
  const s = content('Zod schemas: the shape of a valid request')
  code(s, [
    'export const issuanceHeader = z.strictObject({',
    '  receivedByOfficerId: uuid,',
    '  issuedByOfficerId: uuid,',
    '  issuedDate: isoDate,',
    '  fundCluster: nonEmpty,',
    '  purpose: z.string().trim().optional(),',
    '  icsNo: nonEmpty.optional(), // if a row is semi',
    '  parNos: z.array(nonEmpty).optional(), // one per PPE unit',
    '})',
  ].join('\n'), { label: 'shared/src/schemas/issuance.ts (shortened)', w: 7.3, h: 3.7, size: 13 })
  bullets(s, [
    ['The server', 'runs validate(issuanceInput) on every body. A bad body never reaches a service: 400 VALIDATION.'],
    ['The client', 'can use the same schema to check a form before sending.'],
    ['strictObject', 'refuses unknown fields, so a typo is an error, not silently ignored.'],
  ], { x: 8.1, w: 4.7, h: 3.8, size: 15 })
  plain(s, 'A zod schema is a checklist for a request: "must have a receiver, a date in YYYY-MM-DD, a fund cluster". Written once in shared/, so both sides check the same list.', { y: 5.3, h: 1.4 })
}

{
  const s = content('shared/src/utils: small helpers with big rules')
  table(s, [
    ['File', 'Function', 'What it does'],
    ['money.ts', 'pesoToCentavos, formatPeso', "'96,450.00' -> 9645000 and back to '₱96,450.00'"],
    ['category.ts', 'categorize', 'cost at or above the threshold -> ppe, else semi (BR-01)'],
    ['dates.ts', 'isIsoDate, formatLongDate', 'checks "YYYY-MM-DD" and prints "May 12, 2026"'],
    ['propertyNo.ts', 'formatPropertyNo, normalizePropertyNo', 'YYYY-MM{TYPE}-NNNN, e.g. 2026-05ICT-0017'],
    ['names.ts', 'shortNameOf', "'Juan Dela Cruz' -> 'JDelaCruz' (first given name + middle initial + surname)"],
    ['names.ts', 'accountEmailOf', "'Juan Dela Cruz' -> 'jdelacruz@region1.dost.gov.ph'"],
    ['names.ts', 'spellOutPosition', "'SRS II' -> 'Science Research Specialist II'"],
  ], { colW: [1.9, 4.0, 6.4], size: 14, monoCols: [0, 1] })
  plain(s, 'Property numbers are only suggested (GET /api/property-numbers/next). The user may type another one; the UNIQUE index is the real guard.', { y: 5.4, h: 1.1 })
}

part('Part 7. The client', 'How the screens get their data and talk back.')

{
  const s = content('How a page gets its data')
  box(s, { x: 0.5, y: 1.5, w: 2.8, h: 1.2, title: 'Page component', body: 'pages/officers/List.tsx', fill: NAVY })
  box(s, { x: 3.9, y: 1.5, w: 2.8, h: 1.2, title: 'Hook', body: 'useOfficers() in lib/queries.ts' })
  box(s, { x: 7.3, y: 1.5, w: 2.6, h: 1.2, title: 'api.get', body: 'api.ts (fetch)' })
  box(s, { x: 10.5, y: 1.5, w: 2.3, h: 1.2, title: 'Server', body: 'GET /api/officers', fill: NAVY })
  arrow(s, 3.3, 2.1, 3.9, 2.1)
  arrow(s, 6.7, 2.1, 7.3, 2.1)
  arrow(s, 9.9, 2.1, 10.5, 2.1)
  code(s, [
    'export const useOfficers = (activeOnly = false) =>',
    "  useQuery({ queryKey: ['officers', activeOnly],",
    "             queryFn: () => api.get<Officer[]>(`/api/officers${activeOnly ? '?active=true' : ''}`) })",
  ].join('\n'), { label: 'client/src/lib/queries.ts', y: 3.0, h: 1.35, size: 13 })
  bullets(s, [
    ['React Query', 'remembers answers by their queryKey, shows loading and error states, and refetches when told (invalidateQueries) after a save.'],
    ['While loading,', 'pages show grey skeleton shapes (components/Loading.tsx), not a spinner.'],
  ], { y: 4.6, h: 1.1, size: 15 })
  plain(s, 'The page says "I need the officers". The hook fetches them once, keeps them, and gives the page the list or "still loading".', { y: 5.85, h: 1.0 })
}

{
  const s = content('Router and the door guards')
  code(s, [
    "{ path: '/q/:token', element: <QrView /> },          // public, no login",
    "{ path: '/login', element: <Login /> },",
    "{ element: <RequireRole roles={['supply_admin', 'superadmin']} />,",
    '  children: [{ element: <AdminLayout />, children: [ ...staff pages...,',
    "    { element: <RequireRole roles={['superadmin']} />,",
    "      children: [ /admin/users, /admin/settings, /admin/audit ] } ] }] }",
  ].join('\n'), { label: 'client/src/router.tsx (shortened)', h: 2.6, size: 13 })
  bullets(s, [
    ['RequireRole', 'shows a skeleton while it asks GET /api/me, sends you to /login if nobody is logged in, and to /account/password if the password is temporary.'],
    ['AdminLayout', 'draws the side menu once; the page inside changes (Outlet).'],
    ['The real guard is the server.', 'Hiding a page in the client is only for comfort; every API route checks the role again.'],
  ], { y: 4.1, h: 2.7, size: 15 })
}

{
  const s = content('The pages and their files')
  table(s, [
    ['Address', 'File in client/src/pages', 'What it is for'],
    ['/', 'Dashboard.tsx', 'Tiles: counts, unsigned forms, quick links'],
    ['/issue', 'issue/IssueForm.tsx', 'New issuance: the only data entry form'],
    ['/documents, /documents/:id', 'documents/List.tsx, Detail.tsx', 'ICS and PAR list; one form with its PDF and lines'],
    ['/lines/:lineId/edit', 'lines/LineForm.tsx', 'Fix one row (locked when signed)'],
    ['/cards, /cards/:propertyId', 'cards/List.tsx, Card.tsx', 'Property cards, one per property'],
    ['/registry', 'registry/Registry.tsx', 'Registry, Excel export'],
    ['/reports', 'reports/Reports.tsx', 'RPCSP / RPCPPE for one officer on a date'],
    ['/stickers', 'stickers/StickerSheet.tsx', 'Print QR stickers'],
    ['/properties/:no', 'properties/Detail.tsx', 'One property: everything about it'],
    ['/officers, /property-types', 'officers/List.tsx, types/...', 'Manage the lists'],
    ['/admin/users, settings, audit', 'admin/*.tsx', 'Superadmin only'],
    ['/q/:token', 'public/QrView.tsx', 'What a phone sees after scanning'],
  ], { colW: [3.3, 4.2, 4.8], size: 13, monoCols: [0, 1] })
}

{
  const s = content('Deep dive: the New issuance form')
  bullets(s, [
    ['Header', 'once: Received by and Issued by (OfficerPicker, a searchable list), date, fund cluster, purpose, office unit, ICS no., one PAR no. per PPE unit.'],
    ['Rows', 'one per item: property type, article, unit, description, quantity, unit cost, property and serial numbers (serial default N/A).'],
    ['Category badge', 'per row shows ICS or PAR from the cost, using the same categorize() as the server.'],
    ['Property numbers', 'are pre-filled from GET /api/property-numbers/next; you may type others.'],
    ['Draft', 'saved in the browser (localStorage key traces:draft:issue) while you type, so a reload loses nothing. "Discard draft" clears it.'],
    ['Save', 'sends one POST /api/issuances. Row errors come back with details.rowIndex so the right row turns red.'],
  ], { w: 7.6, h: 5.4, size: 15 })
  box(s, { x: 8.5, y: 1.3, w: 4.3, h: 1.3, title: 'Files', body: 'pages/issue/IssueForm.tsx\npages/issue/model.ts\ncomponents/OfficerPicker.tsx', mono: true, size: 11, align: 'left', valign: 'top' })
  plain(s, 'This one screen replaces typing the slip, the card, the registry and the count report by hand. Read IssueForm.tsx slowly: it uses almost every idea in this guide.', { x: 8.5, y: 2.9, w: 4.3, h: 2.4 })
}

{
  const s = content('The building blocks of the screens')
  table(s, [
    ['Library', 'Used for', 'Where'],
    ['Tailwind CSS v4', 'Styling with class names, e.g. "flex gap-2 text-sm"', 'every .tsx, index.css'],
    ['shadcn (base-nova)', 'Ready-made buttons, inputs, dialogs, tabs, tables', 'components/ui/'],
    ['AG Grid', 'The big spreadsheet-like tables (registry, cards, reports)', 'lib/propertyView.ts'],
    ['react-pdf', 'Shows a PDF inside the page and highlights a row', 'components/PdfViewer.tsx'],
    ['qrcode', 'Draws the QR images for the sticker sheet in the browser', 'pages/stickers/'],
    ['React Hook Form', 'Form state and errors on login, password, users, officers and line forms', 'pages/lines/LineForm.tsx'],
    ['sonner', 'The small pop-up messages ("Saved")', 'components/ui/sonner.tsx'],
    ['lucide-react', 'The icons in the menu and buttons', 'layouts/AdminLayout.tsx'],
  ], { colW: [3.0, 5.9, 3.4], size: 14, monoCols: [2] })
  plain(s, 'Write text on screens for Supply staff, not for developers: no "how it works" notes, no hints that read like code comments. Pages must pass the accessibility test and fit a 360 px phone.', { y: 5.4, h: 1.3 })
}

part('Part 8. Tests', 'How we know a change did not break anything.')

{
  const s = content('Three kinds of tests')
  box(s, { x: 0.5, y: 1.5, w: 3.9, h: 2.4, title: 'shared unit tests', body: 'Vitest. Pure functions: money, names, categories.\n\nshared/src/__tests__/', valign: 'top', align: 'left' })
  box(s, { x: 4.7, y: 1.5, w: 3.9, h: 2.4, title: 'server API tests', body: 'Vitest + supertest. Real HTTP requests to the app, real traces_test database, wiped before each test.\n\nserver/src/test/', valign: 'top', align: 'left', fill: NAVY })
  box(s, { x: 8.9, y: 1.5, w: 3.9, h: 2.4, title: 'browser tests (e2e)', body: 'Playwright in Chrome. Clicks the real app on :3100 / :5273. Also checks accessibility (axe) and phone width.\n\ne2e/*.spec.ts', valign: 'top', align: 'left' })
  bullets(s, [
    ['npm test', 'runs the first two (about 300 tests). npm run test:e2e runs the 45 browser tests in order.'],
    ['The e2e files share one database and run in order:', 'app.spec.ts first. Run the whole suite; one test alone may lack the officers an earlier test created.'],
    ['Tests use TEST_DATABASE_URL only.', 'They can never touch your dev data.'],
  ], { y: 4.2, h: 1.8, size: 15 })
  plain(s, 'Before you say "done", run both commands and read the result. A green run is the proof.', { y: 6.05, h: 0.8 })
}

{
  const s = content('Write the test first (TDD)')
  code(s, [
    "it('makes the short name from the first given name, middle initial and surname', async () => {",
    "  expect(shortNameOf('Juan Dela Cruz')).toBe('JDelaCruz') // a surname particle stays with the surname",
    "  expect(shortNameOf('Ana Marie B. Dela Cruz')).toBe('ABDelaCruz') // only the first given name counts",
    '})',
  ].join('\n'), { label: 'like shared/src/__tests__/utils.test.ts', h: 1.75, size: 12 })
  const st = [['1  Red', 'Write a test for the new behaviour. Run it. It must fail.'], ['2  Green', 'Write the smallest code that makes it pass.'], ['3  Clean', 'Tidy the code. Tests stay green.'], ['4  Commit', 'One commit per task.']]
  st.forEach(([t, b], i) => {
    const x = 0.5 + i * 3.1
    box(s, { x, y: 3.35, w: 2.9, h: 1.5, title: t, body: b, fill: i === 0 ? RED : (i === 1 ? GREEN : 'FFFFFF'), size: 13 })
    if (i < 3) arrow(s, x + 2.9, 4.1, x + 3.1, 4.1)
  })
  plain(s, 'If you never saw the test fail, you do not know it tests anything. For a bug: first write a test that shows the bug, then fix it.', { y: 5.3, h: 1.1 })
}

part('Part 9. Doing real work', 'Recipes, rules, and where to look things up.')

{
  const s = content('Recipe: add a new field (example: an officer\'s phone number)')
  bullets(s, [
    'Read the spec (docs/plans) and ask whether the field is wanted. If the spec says nothing, ask the Supply Unit.',
    'Database: add the column in server/src/db/schema.ts, run npm run db:generate, read the new .sql, run npm run db:migrate.',
    'shared: add it to the zod schema (shared/src/schemas/officer.ts).',
    'Test: write a failing API test in server/src/test/officers.test.ts.',
    'Server: save and return it in services/officers.ts (inside the transaction, with the audit row).',
    'Client: add the type in lib/queries.ts and the input on pages/officers/List.tsx.',
    'Run npm test and npm run test:e2e. Both green? Commit with a clear message.',
  ], { numbered: true, h: 4.4, size: 15 })
  plain(s, 'A field travels from the bottom up: database, rules, server, screen. Skip a step and it is either not saved, refused, or not shown.', { y: 5.85, h: 1.0 })
}

{
  const s = content('Recipe: add a new page')
  bullets(s, [
    'Make the file: client/src/pages/<area>/<Name>.tsx with a default-exported component.',
    'Give it an address in client/src/router.tsx, inside the RequireRole that fits.',
    'Add a menu entry in layouts/AdminLayout.tsx (RECORDS or ADMIN list) if people should find it there.',
    'Get data through a hook in lib/queries.ts (or useQuery next to the page) using api.get.',
    'Use PageHeader, components/ui and the Loading skeletons like the other pages.',
    'If it needs new data, add the route and service first (previous recipe).',
    'Add or extend an e2e test that opens the page, and run the accessibility check.',
  ], { numbered: true, h: 4.4, size: 15 })
  plain(s, 'Copy the closest existing page and change it. The codebase is consistent on purpose; matching it is better than inventing a new style.', { y: 5.85, h: 1.0 })
}

{
  const s = content('The rules you must never break')
  const rules = [
    ['Never weaken a database rule', 'to make a test pass.'],
    ['Never store a calculated value', '(totals, balances, amounts).'],
    ['Money is whole centavos;', 'dates are "YYYY-MM-DD" text.'],
    ['Many writes = one db.transaction,', 'and each write adds an audit_logs row inside it.'],
    ['Validate every request body', 'with the zod schemas in shared/.'],
    ['No string-built SQL.', 'Drizzle or sql`` with parameters only.'],
    ['Public routes return public fields only:', 'no UUIDs, no user data (BR-12).'],
    ['A signed form is locked.', 'Remove the signed copy (with a reason) to correct it.'],
  ]
  rules.forEach(([a, b], i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.5 + col * 6.25, y = 1.35 + row * 1.15
    s.addShape(pres.shapes.OVAL, { x, y: y + 0.12, w: 0.5, h: 0.5, fill: { color: RED }, line: { color: RED } })
    s.addText(String(i + 1), { x, y: y + 0.12, w: 0.5, h: 0.5, fontSize: 16, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', isTextBox: true, margin: 0 })
    s.addText([{ text: a, options: { bold: true, breakLine: true } }, { text: b }], { x: x + 0.7, y, w: 5.3, h: 0.95, fontSize: 15, color: INK, valign: 'middle', isTextBox: true, margin: 0 })
  })
  para(s, 'These come from CLAUDE.md "Hard rules". When the code and the spec disagree, the spec wins: raise it, do not guess.', { y: 6.1, h: 0.6, size: 14, color: MUTED })
}

{
  const s = content('The repository is public')
  bullets(s, [
    ['Never commit:', 'passwords, .env files, real PDFs, signatures, real names or other personal data.'],
    ['Ignored by git on purpose:', 'docs/ACCOUNTS.md (logins), docs/references/ (real office files), .env*, storage* (PDFs), the officers CSV.'],
    ['In code, tests and samples', 'use made-up people: Juan Dela Cruz, Maria Santos, Sam Staffer.'],
    ['Before every commit', 'run git status and read the list. If a file looks private, stop and ask.'],
    ['Commit and push per task,', 'with a message that says what changed and why.'],
  ], { h: 3.9, size: 16 })
  plain(s, 'Anything pushed to GitHub can be copied by anyone, forever, even if you delete it later. When in doubt, leave it out.', { y: 5.4, h: 1.1 })
}

{
  const s = content('Where to look things up')
  table(s, [
    ['Question', 'Open'],
    ['What should the system do? What is BR-07?', 'docs/plans/2026-11-13-traces-design.md (the spec)'],
    ['What did the updates change?', 'docs/plans/2026-11-14-update-01-*.md, update-02-*.md, update-NOTES.md'],
    ['Which update wins on conflict?', 'Update 02 > Update 01 > v1'],
    ['What does the database look like?', 'docs/plans/traces-schema.sql, server/src/db/schema.ts, server/drizzle/*.sql'],
    ['How do I deploy, back up, set up phones?', 'docs/DEPLOY.md'],
    ['Commands and hard rules in one page', 'CLAUDE.md'],
    ['How do staff use it?', 'docs/TRACES-User-Manual.pptx'],
    ['Who has which login?', 'docs/ACCOUNTS.md (only on the office laptop, not in git)'],
    ['Why was something decided?', 'the "Decisions log" at the end of the spec, and git log'],
  ], { colW: [4.6, 7.7], size: 14 })
}

{
  const s = content('Before TRACES goes live')
  bullets(s, [
    ['Production hosting.', 'HTTPS, nginx, the address (on hold), scheduled backups and real staff accounts (docs/DEPLOY.md).'],
    ['Clear the sample forms', 'from the database before entering real records.'],
    ['Set public_base_url', 'to the production address before printing real stickers.'],
    ['Fill in the report footer names', '(Reports page, "Save these names as the default").'],
  ], { h: 3.0, size: 16 })
  plain(s, "Features outside the spec's scope (transfers, returns, disposal, Excel import) are not planned. A new one needs a written decision from the Supply Unit in the spec first.", { y: 5.6, h: 1.1 })
}

{
  const s = pres.addSlide({ masterName: 'DIVIDER', sectionTitle: section })
  s.addText('Your first day', { placeholder: 'title' })
  s.addText([
    { text: 'Run the app and click through every page with the user manual open.', options: { bullet: { type: 'number' }, breakLine: true } },
    { text: 'Run npm test and npm run test:e2e and watch them pass.', options: { bullet: { type: 'number' }, breakLine: true } },
    { text: 'Read services/issuances.ts and pages/issue/IssueForm.tsx from top to bottom.', options: { bullet: { type: 'number' }, breakLine: true } },
    { text: 'Change one small thing, write its test, commit. Then ask for a review.', options: { bullet: { type: 'number' } } },
  ], { placeholder: 'body' })
}

pres.write({ outputType: 'nodebuffer' }).then(async (buf) => {
  const JSZip = require('jszip')
  const zip = await JSZip.loadAsync(buf)
  for (const name of Object.keys(zip.files)) if (zip.files[name].dir) delete zip.files[name]
  require('node:fs').writeFileSync(OUT, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  console.log(`wrote ${OUT}`)
})
