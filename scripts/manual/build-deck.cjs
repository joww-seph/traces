// Builds the plain user manual from the captured screenshots.
//   node scripts/manual/build-deck.cjs  ->  docs/TRACES-User-Manual.pptx
// No styling on purpose: white slides, black Arial text, the screenshots and the steps.
const fs = require('node:fs')
const path = require('node:path')
const pptxgen = require('pptxgenjs')

const SHOTS = path.resolve('docs/manual/shots')
const OUT = path.resolve('docs/TRACES-User-Manual.pptx')
const { slides } = JSON.parse(fs.readFileSync(path.join(SHOTS, 'steps.json'), 'utf8'))

const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE' // 13.333 x 7.5 in
pres.title = 'TRACES User Manual'
pres.author = 'Supply Unit, DOST Region 1'
pres.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial' }

const BLACK = '000000'
const RED = 'E0102F'
const GREY = '444444'
let pageNo = 0

function footer(slide) {
  pageNo++
  slide.addText(`TRACES User Manual   ·   page ${pageNo}`, { x: 0.4, y: 7.05, w: 12.5, h: 0.3, fontSize: 10, color: GREY, isTextBox: true, margin: 0 })
}

function title(slide, text, y = 0.3) {
  slide.addText(text, { x: 0.4, y, w: 12.5, h: 0.6, fontSize: 26, bold: true, color: BLACK, isTextBox: true, margin: 0, fit: 'shrink' })
}

function textSlide(heading, paragraphs) {
  const s = pres.addSlide()
  title(s, heading)
  const runs = paragraphs.flatMap((p, i) => {
    const last = i === paragraphs.length - 1
    if (typeof p === 'string') return [{ text: p, options: { breakLine: !last, paraSpaceAfter: 10 } }]
    // [term, explanation]
    return [
      { text: `${p[0]}: `, options: { bold: true, paraSpaceAfter: 8 } }, // paragraph spacing goes on a paragraph's first run
      { text: p[1], options: { breakLine: !last } },
    ]
  })
  s.addText(runs, { x: 0.4, y: 1.1, w: 12.5, h: 5.8, fontSize: 16, color: BLACK, valign: 'top', isTextBox: true, margin: 0 })
  footer(s)
  return s
}

function dividerSlide(heading, sub) {
  const s = pres.addSlide()
  s.addText(heading, { x: 0.4, y: 2.8, w: 12.5, h: 0.9, fontSize: 36, bold: true, color: BLACK, isTextBox: true, margin: 0 })
  if (sub) s.addText(sub, { x: 0.4, y: 3.8, w: 12.5, h: 1, fontSize: 18, color: BLACK, isTextBox: true, margin: 0, valign: 'top' })
  footer(s)
}

// The numbered steps, numbers in red to match the marks on the screenshot.
function stepRuns(steps, note) {
  const runs = []
  steps.forEach((t, i) => {
    runs.push({ text: `${i + 1}   `, options: { bold: true, color: RED, paraSpaceAfter: 10 } }) // paragraph spacing goes on a paragraph's first run
    runs.push({ text: t, options: { color: BLACK, breakLine: true } })
  })
  if (note) runs.push({ text: `Good to know: ${note}`, options: { color: GREY, italic: true, paraSpaceBefore: 6 } })
  else runs[runs.length - 1].options.breakLine = false
  return runs
}

function stepSlide(s) {
  const slide = pres.addSlide()
  title(slide, s.title)
  const img = path.join(SHOTS, s.image)
  if (s.phone) {
    // phone screenshot: 390 x 844 at 2x
    const h = 5.9, w = h * (390 / 844)
    slide.addImage({ path: img, x: 0.6, y: 1.0, w, h, altText: `Screenshot: ${s.title}` })
    slide.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 1.0, w, h, line: { color: '999999', width: 0.75 }, fill: { type: 'none' } })
    slide.addText(stepRuns(s.steps, s.note), { x: 4.2, y: 1.0, w: 8.7, h: 5.9, fontSize: 16, valign: 'top', isTextBox: true, margin: 0 })
  } else {
    const w = 8.6, h = w * (900 / 1440)
    slide.addImage({ path: img, x: 0.4, y: 1.0, w, h, altText: `Screenshot: ${s.title}` })
    slide.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 1.0, w, h, line: { color: '999999', width: 0.75 }, fill: { type: 'none' } })
    slide.addText(stepRuns(s.steps, s.note), { x: 9.25, y: 1.0, w: 3.75, h: 5.95, fontSize: 14, valign: 'top', isTextBox: true, margin: 0 })
  }
  footer(slide)
}

// ───────────── front matter ─────────────
{
  const s = pres.addSlide()
  s.addText('TRACES User Manual', { x: 0.4, y: 2.4, w: 12.5, h: 1, fontSize: 40, bold: true, color: BLACK, isTextBox: true, margin: 0 })
  s.addText([
    { text: 'Tagged Records of Accountable Equipment and Supplies', options: { breakLine: true } },
    { text: 'Supply Unit, Department of Science and Technology Region 1', options: { breakLine: true } },
    { text: 'How to use the system, step by step. No experience needed.' },
  ], { x: 0.4, y: 3.5, w: 12.5, h: 1.5, fontSize: 18, color: BLACK, isTextBox: true, margin: 0, valign: 'top' })
  footer(s)
}

textSlide('How to read this manual', [
  'Every picture in this manual is a real TRACES screen.',
  'A red number with an arrow points at the part of the screen to look at or click. The numbered steps beside the picture say what to do, in the same order as the red numbers.',
  'Words in bold or in "quotes" are written exactly as they appear on the screen, so you can find them.',
  'The names, slip numbers and amounts in the pictures are made up for training. Your screens show your office\'s own records.',
  'You cannot break anything by looking around. Nothing changes until you press a button such as Save, Upload or Remove, and every change is recorded in the audit log.',
])

textSlide('Words used in TRACES', [
  ['ICS (Inventory Custodian Slip)', 'the slip given when semi-expendable property (costing less than ₱50,000) is handed to an officer.'],
  ['PAR (Property Acknowledgment Receipt)', 'the same for property, plant and equipment (PPE) costing ₱50,000 or more.'],
  ['Accountable officer', 'the person who receives the property and is responsible for it ("Received by").'],
  ['Card (SPC or PC)', 'the property card of one model, for example "Laptop, Acer TravelMate P2". Every time that model is received or issued, a row is added to its card.'],
  ['Registry', 'the list of everything issued (RegSPI for semi-expendable property, the PPE registry for PPE).'],
  ['Report (RPCSP or RPCPPE)', 'the physical count report: everything one officer holds on a date, printed for the inventory count.'],
  ['Property number', 'the number that identifies one item, like 2026-11ICT-0017 (year, month, type, running number). TRACES suggests it.'],
  ['Component', 'a part of a set, like the monitor of a desktop set. It has its own number (main number plus a letter) and its own sticker.'],
  ['QR sticker', 'the sticker on the item. Scanning it with a phone opens the item\'s records.'],
  ['Signed copy', 'the scan of the slip after it was signed. Once it is uploaded, the slip cannot be changed any more.'],
])

textSlide('The usual order of work', [
  '1.  Enter the issuance on the "New issuance" page: what was bought, who receives it, and the slip numbers. TRACES fills the card, the registry and the report, and makes the ICS or PAR.',
  '2.  Print the ICS or PAR and have it signed.',
  '3.  Scan the signed slip and upload it ("Upload signed copy"). The slip is now locked.',
  '4.  Print the QR stickers and put them on the items.',
  '5.  At inventory time, open "Reports", print the report of each officer and count the items by hand.',
  'Old paper slips can be encoded the same way: use "Save, I\'ll upload the PDF" and upload the existing scan.',
])

// contents
const sections = []
for (const s of slides) if (!sections.includes(s.section)) sections.push(s.section)
textSlide('Contents', sections.map((s, i) => `Part ${i + 1}.  ${s}`))

// ───────────── the steps ─────────────
let current = ''
for (const s of slides) {
  if (s.section !== current) {
    current = s.section
    dividerSlide(`Part ${sections.indexOf(current) + 1}. ${current}`)
  }
  stepSlide(s)
}

// ───────────── help ─────────────
textSlide('If something goes wrong', [
  ['"Invalid email or password"', 'check the email and the password (capital letters count). After many tries, wait 15 minutes.'],
  ['A row has a red border', 'read the red list under it: it says exactly what is missing. Nothing was saved yet.'],
  ['"…is already used or repeated on this form"', 'that property number exists already. Leave the box empty to use the suggestion, or type another number.'],
  ['"…already exists" next to the ICS or PAR number', 'that slip number was used before. Check the number on the paper form.'],
  ['"This form has a signed copy, so its entries are locked"', 'the slip was signed. To correct it, use "Remove signed copy" (it asks for a reason), correct, print and sign again.'],
  ['"The entries changed after this form was generated"', 'click "Regenerate now" before printing, so the printed slip matches the records.'],
  ['"Test stickers only" on the sticker page', 'do not stick those stickers on items yet. Ask the IT administrator to set the real address first.'],
  ['"This sticker was replaced" after a scan', 'a newer sticker exists for that item. Scan the newer one.'],
  ['Anything else', 'ask the ITSM Unit. Tell them the page, what you clicked and the exact message.'],
])

// pptxgenjs writes folder entries into the ZIP; OneDrive/SharePoint refuse to open such files, so drop them
pres.write({ outputType: 'nodebuffer' }).then(async (buf) => {
  const JSZip = require('jszip')
  const src = await JSZip.loadAsync(buf)
  const out = new JSZip() // copy the files only (removing a folder entry from src would remove its files too)
  for (const f of Object.values(src.files)) if (!f.dir) out.file(f.name, await f.async('nodebuffer'), { createFolders: false })
  fs.writeFileSync(OUT, await out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  console.log(`${OUT} (${pageNo} slides)`)
})
