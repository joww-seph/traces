import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

const MM = 72 / 25.4
const A4 = { w: 210 * MM, h: 297 * MM }
const M = { l: 15 * MM, r: 15 * MM, t: 12 * MM, b: 14 * MM }

type Align = 'left' | 'center' | 'right'
type Col = { key: string; label: string; w: number; align: Align; group?: string }

const LAYOUT = {
  ICS: {
    appendix: 'Appendix 59', title: 'INVENTORY CUSTODIAN SLIP', noLabel: 'ICS No',
    cols: [
      { key: 'qty', label: 'Quantity', w: 0.09, align: 'center' },
      { key: 'unit', label: 'Unit', w: 0.08, align: 'center' },
      { key: 'unitCost', label: 'Unit Cost', group: 'Amount', w: 0.11, align: 'right' },
      { key: 'totalCost', label: 'Total Cost', group: 'Amount', w: 0.11, align: 'right' },
      { key: 'description', label: 'Description', w: 0.33, align: 'left' },
      { key: 'itemNos', label: 'Inventory Item No.', w: 0.18, align: 'center' },
      { key: 'life', label: 'Estimated Useful Life', w: 0.10, align: 'center' },
    ] as Col[],
    from: 'Received from:', to: 'Received by:',
  },
  PAR: {
    appendix: 'Appendix 71', title: 'PROPERTY ACKNOWLEDGMENT RECEIPT', noLabel: 'PAR No.',
    cols: [
      { key: 'qty', label: 'Quantity', w: 0.09, align: 'center' },
      { key: 'unit', label: 'Unit', w: 0.08, align: 'center' },
      { key: 'description', label: 'Description', w: 0.37, align: 'left' },
      { key: 'itemNos', label: 'Property Number', w: 0.18, align: 'center' },
      { key: 'dateAcquired', label: 'Date Acquired', w: 0.14, align: 'center' },
      { key: 'totalCost', label: 'Amount', w: 0.14, align: 'right' },
    ] as Col[],
    from: 'Issued by:', to: 'Received by:',
  },
} as const

export type FormLine = {
  lineId: string; qty: number; unit: string; unitCostCentavos: number; description: string
  itemNos: string[]
  life?: number | null; dateAcquired?: string | null
}
export type FormDoc = {
  type: 'ICS' | 'PAR'; docNo: string; entityName: string; fundCluster: string
  formCode?: string
  issuedDate: string; from: { name: string; position: string }; to: { name: string; position: string }
  lines: FormLine[]
}
export type FormFonts = { regular: Uint8Array; bold: Uint8Array }
export type FormRegion = { lineId: string; page: number; x: number; y: number; w: number; h: number }

const peso = (c: number) => (c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

function breakLongWord(word: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = []
  let w = word
  while (font.widthOfTextAtSize(w, size) > maxW) {
    let k = w.length
    while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > maxW) k--
    const at = w.lastIndexOf('-', k - 1)
    const cut = at > 0 ? at + 1 : k
    out.push(w.slice(0, cut))
    w = w.slice(cut)
  }
  return [...out, w]
}

export function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = []
  for (const para of String(text ?? '').split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(t, size) <= maxW) { line = t; continue }
      if (line) out.push(line)
      const parts = breakLongWord(word, font, size, maxW)
      out.push(...parts.slice(0, -1))
      line = parts.at(-1)!
    }
    out.push(line)
  }
  return out
}

export async function renderIcsPar(doc: FormDoc, fonts: FormFonts): Promise<{ bytes: Uint8Array; pageCount: number; regions: FormRegion[] }> {
  const L = LAYOUT[doc.type]
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(fonts.regular, { subset: true })
  const bold = await pdf.embedFont(fonts.bold, { subset: true })
  const tableW = A4.w - M.l - M.r
  const cols = L.cols.map((c) => ({ ...c, wpt: c.w * tableW }))
  const FS = 8, LH = 10, PAD = 3
  const black = rgb(0, 0, 0)
  const regions: FormRegion[] = []
  const pages: PDFPage[] = []

  const cell = (page: PDFPage, text: string, x: number, w: number, yTop: number, align: Align, f: PDFFont = font, size = FS) => {
    const tw = f.widthOfTextAtSize(text, size)
    const tx = align === 'right' ? x + w - PAD - tw : align === 'center' ? x + (w - tw) / 2 : x + PAD
    page.drawText(text, { x: tx, y: yTop, size, font: f, color: black })
  }

  function newPage() {
    const page = pdf.addPage([A4.w, A4.h])
    pages.push(page)
    let y = A4.h - M.t
    cell(page, L.appendix, M.l, tableW, y - 8, 'right', font, 8)
    if (doc.formCode) cell(page, doc.formCode, M.l, tableW, y - 18, 'right', font, 6.5)
    y -= 34
    cell(page, L.title, M.l, tableW, y, 'center', bold, 12); y -= 18
    page.drawText(`Entity Name: ${doc.entityName}`, { x: M.l, y, size: 8.5, font: bold }); y -= 11
    page.drawText(`Fund Cluster: ${doc.fundCluster}`, { x: M.l, y, size: 8.5, font })
    cell(page, `${L.noLabel}: ${doc.docNo}`, M.l, tableW, y, 'right', bold, 8.5); y -= 8
    const hTop = y, hH = 26
    page.drawRectangle({ x: M.l, y: hTop - hH, width: tableW, height: hH, borderColor: black, borderWidth: 0.8 })
    let x = M.l
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]
      if (c.group && cols[i + 1]?.group === c.group) {
        const gw = c.wpt + cols[i + 1].wpt
        cell(page, c.group, x, gw, hTop - 10, 'center', bold)
        page.drawLine({ start: { x, y: hTop - 13 }, end: { x: x + gw, y: hTop - 13 }, thickness: 0.5 })
      }
      const labelLines = wrapText(c.label, bold, FS, c.wpt - 2 * PAD)
      const ly = c.group ? hTop - 22 : hTop - (hH - labelLines.length * LH) / 2 - 7
      labelLines.forEach((t, k) => cell(page, t, x, c.wpt, ly - k * LH, 'center', bold))
      if (i > 0) page.drawLine({ start: { x, y: c.group && cols[i - 1].group === c.group ? hTop - 13 : hTop }, end: { x, y: hTop - hH }, thickness: 0.5 })
      x += c.wpt
    }
    return { page, y: hTop - hH }
  }

  const half = tableW / 2
  const NAME_LH = 11, POS_LH = 10
  const sides = [{ label: L.from, ...doc.from }, { label: L.to, ...doc.to }].map((side) => ({
    ...side,
    nameLines: wrapText(side.name, bold, 9, half - 4 * PAD),
    positionLines: wrapText(side.position, bold, 8.5, half - 4 * PAD),
  }))
  const FOOTER_H = 106 + Math.max(...sides.map((s) => (s.nameLines.length - 1) * NAME_LH + (s.positionLines.length - 1) * POS_LH))
  let { page, y } = newPage()
  const bottomLimit = M.b + 12

  for (let li = 0; li < doc.lines.length; li++) {
    const ln = doc.lines[li]
    const values: Record<string, string> = {
      qty: String(ln.qty), unit: ln.unit,
      unitCost: peso(ln.unitCostCentavos), totalCost: peso(ln.unitCostCentavos * ln.qty),
      description: ln.description, itemNos: ln.itemNos.join('\n'),
      life: ln.life != null ? String(ln.life) : '', dateAcquired: ln.dateAcquired ? longDate(ln.dateAcquired) : '',
    }
    const wrapped = cols.map((c) => wrapText(values[c.key], font, FS, c.wpt - 2 * PAD))
    const total = Math.max(...wrapped.map((w) => w.length))
    const isLast = li === doc.lines.length - 1
    const reserve = (last: boolean) => bottomLimit + (last ? FOOTER_H : 0)
    const fits = (lines: number, atY: number, last: boolean) => atY - (lines * LH + 2 * PAD) >= reserve(last)
    const pageCapacity = (last: boolean) => Math.floor((A4.h - M.t - 34 - 18 - 11 - 8 - 26 - reserve(last) - 2 * PAD) / LH)

    let from = 0
    let first = true
    while (from < total) {
      const remaining = total - from
      if (!fits(remaining, y, isLast) && first && remaining <= pageCapacity(isLast)) ({ page, y } = newPage())
      let take = remaining
      if (!fits(remaining, y, isLast)) {
        take = Math.max(1, Math.min(remaining - 1, Math.floor((y - reserve(false) - 2 * PAD) / LH)))
        if (take < 1 || y - (take * LH + 2 * PAD) < reserve(false)) { ({ page, y } = newPage()); continue }
      }
      const rowH = take * LH + 2 * PAD
      page.drawRectangle({ x: M.l, y: y - rowH, width: tableW, height: rowH, borderColor: black, borderWidth: 0.5 })
      let x = M.l
      cols.forEach((c, i) => {
        if (i > 0) page.drawLine({ start: { x, y }, end: { x, y: y - rowH }, thickness: 0.5 })
        const ws = wrapped[i].slice(from, from + take)
        const startY = c.align === 'left' ? y - PAD - FS : y - (rowH - ws.length * LH) / 2 - FS + 1
        ws.forEach((t, k) => cell(page, t, x, c.wpt, startY - k * LH, c.align, from + k === 0 && c.key === 'description' ? bold : font))
        x += c.wpt
      })
      if (first) regions.push({ lineId: ln.lineId, page: pages.length, x: M.l / A4.w, y: (A4.h - y) / A4.h, w: tableW / A4.w, h: rowH / A4.h })
      first = false
      y -= rowH
      from += take
      if (from < total) ({ page, y } = newPage())
    }
  }

  const fy = y - 6
  page.drawRectangle({ x: M.l, y: fy - FOOTER_H + 8, width: tableW, height: FOOTER_H - 8, borderColor: black, borderWidth: 0.8 })
  page.drawLine({ start: { x: M.l + half, y: fy }, end: { x: M.l + half, y: fy - FOOTER_H + 8 }, thickness: 0.5 })
  sides.forEach((side, i) => {
    const x = M.l + i * half
    page.drawText(side.label, { x: x + PAD, y: fy - 11, size: 8, font })
    side.nameLines.forEach((t, k) => cell(page, t, x, half, fy - 38 - k * NAME_LH, 'center', bold, 9))
    const nameEnd = fy - 38 - (side.nameLines.length - 1) * NAME_LH
    cell(page, 'Signature Over Printed Name', x, half, nameEnd - 10, 'center', font, 7.5)
    side.positionLines.forEach((t, k) => cell(page, t, x, half, nameEnd - 22 - k * POS_LH, 'center', bold, 8.5))
    const positionEnd = nameEnd - 22 - (side.positionLines.length - 1) * POS_LH
    cell(page, 'Position/Office', x, half, positionEnd - 10, 'center', font, 7.5)
    cell(page, longDate(doc.issuedDate), x, half, positionEnd - 23, 'center', bold, 8.5)
    cell(page, 'Date', x, half, positionEnd - 33, 'center', font, 7.5)
  })
  pages.forEach((p, i) => cell(p, `Page ${i + 1} of ${pages.length}`, M.l, tableW, M.b - 4, 'center', font, 7.5))

  return { bytes: await pdf.save(), pageCount: pages.length, regions }
}
