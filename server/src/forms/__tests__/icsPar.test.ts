import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { renderIcsPar, wrapText, type FormDoc, type FormFonts, type FormLine } from '../icsPar.js'

const dir = new URL('../../../assets/fonts/', import.meta.url)
const fonts: FormFonts = {
  regular: readFileSync(new URL('DejaVuSansCondensed.ttf', dir)),
  bold: readFileSync(new URL('DejaVuSansCondensed-Bold.ttf', dir)),
}

const SPECS = 'Specification:\n- Memory: 16GB\n- Storage: 512GB Solid State Drive (SSD)\n- Display: 15.6", 144Hz'
const line = (i: number, over: Partial<FormLine> = {}): FormLine => ({
  lineId: `L${i + 1}`, qty: 1, unit: 'unit', unitCostCentavos: 4870000 + i, description: `Laptop Unit ${i + 1}\n${SPECS}`,
  itemNos: [`2026-03ICT-${String(1000 + i).padStart(4, '0')}`], life: 5, dateAcquired: '2026-03-01', ...over,
})
const doc = (n: number, over: Partial<FormDoc> = {}): FormDoc => ({
  type: 'ICS', docNo: '2026-09TEST-003', entityName: 'DEPARTMENT OF SCIENCE AND TECHNOLOGY - REGION 1', fundCluster: 'RAF',
  formCode: 'FM-FAS-SUPPLY-07-10  Rev. 1/07-25-22', issuedDate: '2026-03-19',
  from: { name: 'Juan D. Cruz', position: 'SUPPLY UNIT' }, to: { name: 'Maria S. Santos', position: 'Engineer II' },
  lines: Array.from({ length: n }, (_, i) => line(i)), ...over,
})

// text items of a rendered PDF with their top-left page fractions (pdf.js)
async function textItems(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise
  const out: { page: number; text: string; x: number; y: number }[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const { width: W, height: H } = page.getViewport({ scale: 1 })
    for (const it of (await page.getTextContent()).items) {
      if (!('str' in it) || !it.str.trim()) continue
      out.push({ page: p, text: it.str, x: it.transform[4] / W, y: 1 - it.transform[5] / H }) // y: baseline from the top
    }
  }
  return { items: out, pages: pdf.numPages }
}

describe('renderIcsPar layout', () => {
  it('7 lines fit one page; 21 lines need at least two', async () => {
    expect((await renderIcsPar(doc(7), fonts)).pageCount).toBe(1)
    expect((await renderIcsPar(doc(21), fonts)).pageCount).toBeGreaterThanOrEqual(2)
  })

  it('returns one region per line, inside the page, top to bottom and never overlapping on a page', async () => {
    const r = await renderIcsPar(doc(21), fonts)
    expect(r.regions).toHaveLength(21)
    expect(r.regions.map((x) => x.lineId)).toEqual(Array.from({ length: 21 }, (_, i) => `L${i + 1}`))
    for (const g of r.regions) {
      expect(g.x).toBeGreaterThanOrEqual(0); expect(g.y).toBeGreaterThanOrEqual(0)
      expect(g.x + g.w).toBeLessThanOrEqual(1); expect(g.y + g.h).toBeLessThanOrEqual(1)
      expect(g.page).toBeGreaterThanOrEqual(1); expect(g.page).toBeLessThanOrEqual(r.pageCount)
    }
    for (let i = 1; i < r.regions.length; i++) {
      const a = r.regions[i - 1], b = r.regions[i]
      if (a.page === b.page) expect(b.y).toBeGreaterThanOrEqual(a.y + a.h - 1e-9) // below the previous row
      else expect(b.page).toBe(a.page + 1)
    }
    expect(r.regions.at(-1)!.page).toBe(r.pageCount)
  })

  it('pdf-lib reloads the output and the page count matches', async () => {
    const r = await renderIcsPar(doc(21), fonts)
    const d = await PDFDocument.load(r.bytes)
    expect(d.getPageCount()).toBe(r.pageCount)
    expect(Buffer.from(r.bytes.subarray(0, 5)).toString()).toBe('%PDF-')
  })

  it('TEXT CHECK: every line’s first property number is printed inside that line’s box, on page 1 and on later pages', async () => {
    const d = doc(21)
    const r = await renderIcsPar(d, fonts)
    const { items, pages } = await textItems(r.bytes)
    expect(pages).toBe(r.pageCount)
    for (const [i, g] of r.regions.entries()) {
      const no = d.lines[i].itemNos[0]
      const hit = items.find((t) => t.page === g.page && t.text === no)
      expect(hit, `property number ${no} on page ${g.page}`).toBeDefined()
      expect(hit!.y).toBeGreaterThan(g.y)
      expect(hit!.y).toBeLessThan(g.y + g.h)
      expect(hit!.x).toBeGreaterThan(g.x)
      expect(hit!.x).toBeLessThan(g.x + g.w)
    }
    expect(r.pageCount).toBeGreaterThanOrEqual(2) // the check covered a page-2 row
  })

  it('every page repeats the header; the last page has the signature block; "Page x of y" is printed', async () => {
    const r = await renderIcsPar(doc(21), fonts)
    const { items } = await textItems(r.bytes)
    for (let p = 1; p <= r.pageCount; p++) {
      const txt = items.filter((t) => t.page === p).map((t) => t.text).join(' ')
      expect(txt).toContain('INVENTORY CUSTODIAN SLIP')
      expect(txt).toContain('Entity Name: DEPARTMENT OF SCIENCE AND TECHNOLOGY - REGION 1')
      expect(txt).toContain('ICS No: 2026-09TEST-003')
      expect(txt).toContain(`Page ${p} of ${r.pageCount}`)
    }
    const last = items.filter((t) => t.page === r.pageCount).map((t) => t.text).join(' ')
    expect(last).toContain('Received from:')
    expect(last).toContain('Maria S. Santos') // printed as written, not in capitals
    expect(items.filter((t) => t.page < r.pageCount).map((t) => t.text).join(' ')).not.toContain('Received from:')
  })

  it('the signature block always takes the last row with it', async () => {
    // find a count where the footer would not fit under the last row, and check the last row sits on the last page
    for (const n of [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22]) {
      const r = await renderIcsPar(doc(n), fonts)
      const { items } = await textItems(r.bytes)
      const footerPage = items.find((t) => t.text === 'Received from:')!.page
      expect(footerPage, `${n} lines`).toBe(r.pageCount)
      expect(r.regions.at(-1)!.page, `${n} lines`).toBe(r.pageCount)
    }
  })

  it('PAR layout has the Date Acquired and Amount columns and Issued by / Received by', async () => {
    const r = await renderIcsPar(doc(2, { type: 'PAR', docNo: '2025-RO-68', formCode: 'FM-FAS-SUPPLY-07-09  Rev. 1/07-25-22' }), fonts)
    const txt = (await textItems(r.bytes)).items.map((t) => t.text).join(' ')
    expect(txt).toContain('PROPERTY ACKNOWLEDGMENT RECEIPT')
    expect(txt).toContain('Date Acquired')
    expect(txt).toContain('Amount')
    expect(txt).toContain('PAR No.: 2025-RO-68')
    expect(txt).toContain('Issued by:')
    expect(txt).toContain('March 1, 2026') // the date acquired of each line
    expect(txt).toContain('48,700.00')
  })

  it('all property numbers of a line, components included, are stacked in the item number column', async () => {
    const r = await renderIcsPar(doc(1, { lines: [line(0, { itemNos: ['2026-03ICT-0199', '2026-03ICT-0199a', '2026-03ICT-0199b'] })] }), fonts)
    const txt = (await textItems(r.bytes)).items.map((t) => t.text)
    for (const no of ['2026-03ICT-0199', '2026-03ICT-0199a', '2026-03ICT-0199b']) expect(txt).toContain(no)
  })

  it('a line taller than a page is split across pages but keeps one box and the footer still follows the last row', async () => {
    const many = Array.from({ length: 160 }, (_, i) => `2026-03ICT-${String(2000 + i).padStart(4, '0')}`)
    const r = await renderIcsPar(doc(2, { lines: [line(0, { itemNos: many }), line(1)] }), fonts)
    expect(r.pageCount).toBeGreaterThanOrEqual(3)
    expect(r.regions.map((x) => x.lineId)).toEqual(['L1', 'L2'])
    const { items } = await textItems(r.bytes)
    expect(items.some((t) => t.text === many.at(-1))).toBe(true) // nothing was lost
    expect(items.find((t) => t.text === 'Received from:')!.page).toBe(r.pageCount)
  })
})

describe('wrapText', () => {
  it('breaks a long property number after a hyphen, not in the middle of a word', async () => {
    const pdf = await PDFDocument.create()
    const fontkit = (await import('@pdf-lib/fontkit')).default
    pdf.registerFontkit(fontkit)
    const f = await pdf.embedFont(fonts.regular)
    const no = '1998-05-140-TSE000-RSTL15'
    const w = f.widthOfTextAtSize('1998-05-140-TSE000-', 8) + 1 // fits up to the 3rd hyphen, not the whole number
    const lines = wrapText(no, f, 8, w)
    expect(lines.join('')).toBe(no)
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines.slice(0, -1)) expect(l.endsWith('-')).toBe(true)
    expect(lines.at(-1)).toBe('RSTL15')
  })

  it('falls back to a character break when there is no hyphen to use', async () => {
    const pdf = await PDFDocument.create()
    pdf.registerFontkit((await import('@pdf-lib/fontkit')).default)
    const f = await pdf.embedFont(fonts.regular)
    const lines = wrapText('ABCDEFGHIJKLMNOPQRSTUVWXYZ', f, 8, f.widthOfTextAtSize('ABCDEFGHIJ', 8))
    expect(lines.join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    expect(lines.length).toBeGreaterThan(1)
  })
})
