import { formatLongDate } from '@traces/shared'
import ExcelJS from 'exceljs'
import type { CardData, CountData } from './fill.js'
import { MONEY, asDate, pesos, sizeRow, toBuffer } from './xlsx.js'

// SPC and RPCSP have no official Excel template, so they are drawn here to match the blank forms
// (Semi-Expendable Property Card, Report on Physical Count of Semi-Expendable Property).

const thin = { style: 'thin' as const }
const BOX = { top: thin, left: thin, bottom: thin, right: thin }
const FONT = { name: 'Times New Roman', size: 10 }
const MIN_BLANK_ROWS = 14 // blank ruled rows, as on the paper form

function cell(ws: ExcelJS.Worksheet, addr: string, value: ExcelJS.CellValue, o: Partial<ExcelJS.Style> & { merge?: string; numFmt?: string } = {}) {
  if (o.merge) ws.mergeCells(o.merge)
  const c = ws.getCell(addr)
  c.value = value
  c.font = o.font ?? FONT
  c.alignment = o.alignment ?? { vertical: 'middle', wrapText: true }
  if (o.border) c.border = o.border
  if (o.numFmt) c.numFmt = o.numFmt
  return c
}

function newSheet(name: string, widths: number[]) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(name, { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } })
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  return { wb, ws }
}

const boxRange = (ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number) => {
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = BOX
}
const center = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true }
const heading = { ...FONT, bold: true }

// ───────────────────────── SPC ─────────────────────────
export async function buildSpc(entityName: string, d: CardData) {
  const { wb, ws } = newSheet('SPC', [12, 22, 7, 13, 14, 24, 7, 18, 9, 14, 24])
  cell(ws, 'A1', 'SEMI-EXPENDABLE PROPERTY CARD', { merge: 'A1:K1', font: { ...heading, size: 12, underline: true }, alignment: center })
  cell(ws, 'A3', `Entity Name: ${entityName}`, { merge: 'A3:G3', font: heading })
  cell(ws, 'H3', `Fund Cluster: ${d.fundCluster}`, { merge: 'H3:K3', font: heading })
  cell(ws, 'A4', `Semi-expendable Property: ${d.article}`, { merge: 'A4:G4', font: heading, border: BOX })
  cell(ws, 'H4', `Semi-expendable Property Number: ${d.propertyNo}`, { merge: 'H4:K4', font: heading, border: BOX })
  cell(ws, 'A5', `Description: ${d.description.replace(/\n+/g, '; ')}`, { merge: 'A5:K5', font: heading, border: BOX, alignment: { vertical: 'top', wrapText: true } })
  ws.getRow(5).height = Math.max(18, Math.ceil(d.description.length / 120) * 14 + 4)

  const head = (addr: string, text: string, merge?: string) => cell(ws, addr, text, { merge, font: heading, alignment: center })
  head('A6', 'Date', 'A6:A7'); head('B6', 'Reference', 'B6:B7')
  head('C6', 'Receipt', 'C6:E6'); head('C7', 'Qty.'); head('D7', 'Unit Cost'); head('E7', 'Total Cost')
  head('F6', 'Issue/Transfer/Disposal', 'F6:H6'); head('F7', 'Item No.'); head('G7', 'Qty.'); head('H7', 'Office/Officer')
  head('I6', 'Balance'); head('I7', 'Qty.')
  head('J6', 'Amount', 'J6:J7'); head('K6', 'Remarks', 'K6:K7')
  const last = 7 + Math.max(MIN_BLANK_ROWS, d.rows.length)
  boxRange(ws, 6, 1, last, 11)

  d.rows.forEach((x, i) => {
    const r = 8 + i
    const set = (col: string, v: ExcelJS.CellValue, numFmt?: string, align?: Partial<ExcelJS.Alignment>) =>
      cell(ws, `${col}${r}`, v, { border: BOX, numFmt, alignment: { vertical: 'middle', wrapText: true, ...align } })
    set('A', asDate(x.date), 'mmm d, yyyy'); set('B', x.reference ?? '')
    set('C', x.receiptQty ?? ''); set('D', x.receiptQty ? pesos(x.unitCostCentavos) : '', MONEY); set('E', x.totalCostCentavos === null ? '' : pesos(x.totalCostCentavos), MONEY)
    set('F', x.issueItemNo ?? ''); set('G', x.issueQty ?? ''); set('H', x.officer ?? '')
    set('I', x.balanceQty); set('J', pesos(x.amountCentavos), MONEY); set('K', x.remarks ?? '')
    sizeRow(ws, r, ['B', 'K'], { perLine: 12.5 })
  })
  ws.pageSetup.printArea = `A1:K${last}`
  return toBuffer(wb)
}

// ───────────────────────── RPCSP ─────────────────────────
export async function buildRpcsp(entityName: string, d: CountData) {
  const { wb, ws } = newSheet('RPCSP', [18, 38, 22, 11, 14, 11, 11, 10, 14, 26])
  cell(ws, 'A1', 'REPORT ON THE PHYSICAL COUNT OF SEMI-EXPENDABLE PROPERTY', { merge: 'A1:J1', font: { ...heading, size: 12 }, alignment: center })
  cell(ws, 'A2', d.typeLabel, { merge: 'A2:J2', font: { ...FONT, underline: true }, alignment: center })
  cell(ws, 'A3', '(Type of Semi-Expendable Property)', { merge: 'A3:J3', font: { ...FONT, size: 9 }, alignment: center })
  cell(ws, 'A4', `As at ${formatLongDate(d.asAt)}`, { merge: 'A4:J4', alignment: center })
  cell(ws, 'A6', `Fund Cluster: ${d.fundCluster}`, { merge: 'A6:J6', font: heading })
  cell(ws, 'A7',
    `For which ${d.officerName}, ${d.officerPosition}, ${entityName} is accountable, having assumed such accountability on ${d.assumptionDate ? formatLongDate(d.assumptionDate) : '________'}`,
    { merge: 'A7:J7', alignment: { vertical: 'middle', wrapText: true } })
  ws.getRow(7).height = 30

  const head = (addr: string, text: string, merge?: string) => cell(ws, addr, text, { merge, font: heading, alignment: center })
  head('A9', 'Article', 'A9:A10'); head('B9', 'Description', 'B9:B10'); head('C9', 'Semi-expendable Property No.', 'C9:C10')
  head('D9', 'Unit of Measure', 'D9:D10'); head('E9', 'Unit Value', 'E9:E10')
  head('F9', 'Balance Per Card'); head('F10', '(Quantity)')
  head('G9', 'On Hand Per Count'); head('G10', '(Quantity)')
  head('H9', 'Shortage/Overage', 'H9:I9'); head('H10', 'Quantity'); head('I10', 'Value')
  head('J9', 'Remarks', 'J9:J10')
  const last = 10 + Math.max(MIN_BLANK_ROWS - 2, d.rows.length)
  boxRange(ws, 9, 1, last, 10)

  d.rows.forEach((x, i) => {
    const r = 11 + i
    const set = (col: string, v: ExcelJS.CellValue, numFmt?: string) => cell(ws, `${col}${r}`, v, { border: BOX, numFmt })
    set('A', x.article); set('B', x.description); set('C', x.propertyNo); set('D', x.unit)
    set('E', pesos(x.unitValueCentavos), MONEY); set('F', x.balancePerCard); set('G', x.qtyOnHand ?? '')
    set('H', x.shortageOverageQty ?? ''); set('I', x.shortageOverageValueCentavos === null ? '' : pesos(x.shortageOverageValueCentavos), MONEY)
    set('J', x.remarks ?? '')
    sizeRow(ws, r, ['A', 'B', 'C', 'J'], { perLine: 12.5 })
  })

  // signature block: Certified Correct / Approved / Witnessed
  const sig = last + 2
  const names = (role: string) => d.signatories.filter((s) => s.role === role).map((s) => s.name).join('\n')
  const block = (c1: string, c2: string, label: string, role: string, caption: string) => {
    cell(ws, `${c1}${sig}`, label, { merge: `${c1}${sig}:${c2}${sig}`, font: FONT })
    cell(ws, `${c1}${sig + 2}`, names(role), { merge: `${c1}${sig + 2}:${c2}${sig + 2}`, alignment: { horizontal: 'center', vertical: 'bottom', wrapText: true }, border: { bottom: thin } })
    cell(ws, `${c1}${sig + 3}`, caption, { merge: `${c1}${sig + 3}:${c2}${sig + 3}`, font: { ...FONT, size: 9 }, alignment: center })
  }
  block('A', 'C', 'Certified Correct by:', 'committee', 'Signature over Printed Name of Inventory Committee Chair and Members')
  block('D', 'G', 'Approved by:', 'head_of_agency', 'Signature over Printed Name of Head of Agency/Entity or Authorized Representative')
  block('H', 'J', 'Witnessed by:', 'coa_representative', 'Signature over Printed Name of COA Representative')
  ws.getRow(sig + 2).height = Math.max(36, 15 * Math.max(1, names('committee').split('\n').length, names('head_of_agency').split('\n').length, names('coa_representative').split('\n').length))
  ws.getRow(sig + 3).height = 28
  ws.pageSetup.printArea = `A1:J${sig + 3}`
  return toBuffer(wb)
}
