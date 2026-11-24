import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'

const TEMPLATE_DIRS = [new URL('./templates/', import.meta.url), new URL('../src/exports/templates/', import.meta.url)].map((u) => fileURLToPath(u))

export async function loadTemplate(name: string) {
  const dir = TEMPLATE_DIRS.find((d) => existsSync(path.join(d, `${name}.xlsx`)))
  if (!dir) throw new Error(`Export template ${name}.xlsx not found`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.join(dir, `${name}.xlsx`))
  return { wb, ws: wb.worksheets[0] }
}

export const toBuffer = async (wb: ExcelJS.Workbook) => Buffer.from(await wb.xlsx.writeBuffer())

export const pesos = (centavos: number) => Number((centavos / 100).toFixed(2))
export const MONEY = '#,##0.00'

export function asDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const parse = (range: string) => {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range)!
  return { c1: m[1], r1: Number(m[2]), c2: m[3], r2: Number(m[4]) }
}

export function insertRows(ws: ExcelJS.Worksheet, at: number, count: number, styleRow: number, rowMerges: [string, string][] = []) {
  if (count <= 0) return
  const kept: string[] = []
  for (const m of [...ws.model.merges]) {
    const { c1, r1, c2, r2 } = parse(m)
    if (r2 < at) continue
    ws.unMergeCells(m)
    kept.push(r1 >= at ? `${c1}${r1 + count}:${c2}${r2 + count}` : `${c1}${r1}:${c2}${r2 + count}`)
  }
  const src = ws.getRow(styleRow)
  const colCount = usedCols(ws)
  ws.spliceRows(at, 0, ...Array.from({ length: count }, () => [] as unknown[]))
  for (let i = 0; i < count; i++) {
    const row = ws.getRow(at + i)
    if (src.height) row.height = src.height
    for (let c = 1; c <= colCount; c++) row.getCell(c).style = { ...src.getCell(c).style }
  }
  for (const m of kept) ws.mergeCells(m)
  for (let i = 0; i < count; i++) for (const [a, b] of rowMerges) ws.mergeCells(`${a}${at + i}:${b}${at + i}`)
  const area = ws.pageSetup.printArea
  if (area) {
    const { c1, r1, c2, r2 } = parse(area)
    ws.pageSetup.printArea = `${c1}${r1}:${c2}${r2 + count}`
  }
}

export function put(ws: ExcelJS.Worksheet, addr: string, value: ExcelJS.CellValue, numFmt?: string) {
  const c = ws.getCell(addr)
  c.value = value
  if (numFmt) c.style = { ...c.style, numFmt }
  return c
}

export function ruleAndNumber(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number) {
  const thin = { style: 'thin' as const }
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
    const cell = ws.getCell(r, c)
    const b = cell.border ?? {}
    cell.style = { ...cell.style, border: { top: b.top?.style ? b.top : thin, bottom: b.bottom?.style ? b.bottom : thin, left: b.left?.style ? b.left : thin, right: b.right?.style ? b.right : thin } }
  }
  ws.headerFooter = { ...ws.headerFooter, oddFooter: '&CPage &P of &N' }
}

export const ROWS_PER_SHEET = 20
export const sheetOf = (rowNo: number) => Math.floor((rowNo - 1) / ROWS_PER_SHEET) + 1
export function pageEvery(ws: ExcelJS.Worksheet, titleRows: [number, number], firstRow: number, rowNos: number[]) {
  ws.pageSetup = { ...ws.pageSetup, printTitlesRow: `${titleRows[0]}:${titleRows[1]}` }
  rowNos.forEach((n, i) => { if (i < rowNos.length - 1 && n % ROWS_PER_SHEET === 0) ws.getRow(firstRow + i).addPageBreak() })
}

export function numberColumns(ws: ExcelJS.Worksheet, headRows: [number, number], firstRow: number, col: number, rowNos: number[], withSheet: boolean) {
  const head = (c: number, text: string) => {
    ws.mergeCells(headRows[0], c, headRows[1], c)
    const h = ws.getCell(headRows[0], c)
    h.value = text
    h.style = { font: { name: 'Arial', size: 9, bold: true }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } }
    ws.getColumn(c).width = 7
  }
  head(col, 'No.')
  if (withSheet) head(col + 1, 'Sheet No.')
  rowNos.forEach((n, i) => {
    const put1 = (c: number, v: number) => {
      const cell = ws.getCell(firstRow + i, c)
      cell.value = v
      cell.style = { font: { name: 'Arial', size: 9 }, alignment: { horizontal: 'center', vertical: 'middle' } }
    }
    put1(col, n)
    if (withSheet) put1(col + 1, sheetOf(n))
  })
}

export function wrap(ws: ExcelJS.Worksheet, addr: string, alignment: Partial<ExcelJS.Alignment> = {}) {
  const c = ws.getCell(addr)
  c.style = { ...c.style, alignment: { ...c.alignment, wrapText: true, vertical: 'middle', ...alignment } }
}

export const usedCols = (ws: ExcelJS.Worksheet) => ws.dimensions?.right || Math.min(ws.columnCount, 30)

const colName = (n: number) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }

export function sizeRow(
  ws: ExcelJS.Worksheet, rowNo: number, wrapCols: string[],
  o: { perLine?: number; min?: number; charsPerWidth?: number; widths?: Record<string, number>; font?: Partial<ExcelJS.Font> } = {},
) {
  const { perLine = 13, min = 15.75, charsPerWidth = 1.15 } = o
  const row = ws.getRow(rowNo)
  for (let c = 1; c <= usedCols(ws); c++) {
    const cell = row.getCell(c)
    const name = colName(c)
    cell.style = {
      ...cell.style,
      alignment: { ...cell.alignment, vertical: 'middle', ...(wrapCols.includes(name) ? { wrapText: true } : {}) },
      ...(o.font ? { font: { ...cell.font, ...o.font } } : {}),
    }
  }
  let most = 1
  for (const col of wrapCols) {
    const width = o.widths?.[col] ?? ws.getColumn(col).width ?? 9
    const perRow = Math.max(4, Math.floor(width * charsPerWidth))
    const text = String(row.getCell(col).value ?? '')
    most = Math.max(most, text.split('\n').reduce((n, seg) => n + Math.max(1, Math.ceil(seg.length / perRow)), 0))
  }
  row.height = Math.max(min, most * perLine + 3)
}

