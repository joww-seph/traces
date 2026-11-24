import { formatLongDate } from '@traces/shared'
import { PC, REGISTRY, RPCPPE } from './map.js'
import { MONEY, asDate, insertRows, loadTemplate, numberColumns, pageEvery, pesos, put, ruleAndNumber, sizeRow, toBuffer, wrap } from './xlsx.js'

type Settings = { entityName: string; ppeRegistryTitle: string }
const entityLine = (s: Settings) => `Entity Name: ${s.entityName}`

export type CardData = {
  category: 'semi' | 'ppe'; propertyNo: string ; article: string; description: string; fundCluster: string
  rows: { date: string; reference: string | null; receiptQty: number | null; unitCostCentavos: number; totalCostCentavos: number | null
    issueItemNo: string | null; issueQty: number | null; officer: string | null; balanceQty: number; amountCentavos: number; remarks: string | null }[]
}

export async function buildPc(s: Settings, d: CardData) {
  const { wb, ws } = await loadTemplate('pc')
  ws.getColumn('B').width = 12.5
  ws.getColumn('C').width = 19
  put(ws, PC.entity, entityLine(s))
  put(ws, PC.fund, `Fund Cluster: ${d.fundCluster}`)
  put(ws, PC.article, `Property, Plant and Equipment : ${d.article}`)
  put(ws, PC.propertyNo, `Property Number: ${d.propertyNo}`)
  put(ws, PC.description, `Description : ${d.description.replace(/\n+/g, '; ')}`)
  wrap(ws, PC.description, { vertical: 'top' })
  ws.getRow(10).height = Math.max(27, Math.ceil(d.description.length / 70) * 14 + 4)

  const last = PC.firstRow + PC.capacity - 1
  const extra = Math.max(0, d.rows.length - PC.capacity)
  insertRows(ws, last + 1, extra, last, [PC.officerMerge])
  d.rows.forEach((x, i) => {
    const r = PC.firstRow + i
    const c = PC.cols
    put(ws, `${c.date}${r}`, asDate(x.date), 'dd-mmm-yy')
    put(ws, `${c.reference}${r}`, x.reference ?? '')
    put(ws, `${c.receiptQty}${r}`, x.receiptQty ?? '')
    put(ws, `${c.issueQty}${r}`, x.issueQty ?? '')
    put(ws, `${c.officer}${r}`, x.officer ?? '')
    put(ws, `${c.balanceQty}${r}`, x.balanceQty)
    put(ws, `${c.amount}${r}`, pesos(x.amountCentavos), MONEY)
    put(ws, `${c.remarks}${r}`, x.remarks ?? '')
    sizeRow(ws, r, [c.reference, c.remarks], { perLine: 11.5, font: { name: 'Times New Roman', size: 9 } })
  })
  ruleAndNumber(ws, 11, 2, last + extra, 10)
  return toBuffer(wb)
}

export type RegistryData = {
  category: 'semi' | 'ppe'; fundCluster: string; typeName: string | null
  rows: { rowNo: number; date: string; reference: string; propertyNos: string[]; description: string; estUsefulLifeYears: number | null; issuedTo: string | null
    issuedQty: number; returnedQty: number; reissuedQty: number; disposedQty: number; balanceQty: number; amountCentavos: number; remarks: string | null }[]
}

export async function buildRegistry(s: Settings, d: RegistryData) {
  const { wb, ws } = await loadTemplate('registry')
  put(ws, REGISTRY.entity, entityLine(s))
  put(ws, REGISTRY.fund, `Fund Cluster: ${d.fundCluster}`)
  const typeName = d.typeName ?? 'All types'
  if (d.category === 'ppe') {
    put(ws, REGISTRY.title, s.ppeRegistryTitle)
    put(ws, REGISTRY.propertyLabel, `Property, Plant and Equipment: ${typeName}`)
    put(ws, REGISTRY.refHeader, 'Property No.')
  } else put(ws, REGISTRY.propertyLabel, `Semi-expendable Property: ${typeName}`)
  insertRows(ws, REGISTRY.firstRow + 1, Math.max(0, d.rows.length - 1), REGISTRY.firstRow)
  d.rows.forEach((x, i) => {
    const r = REGISTRY.firstRow + i
    const c = REGISTRY.cols
    put(ws, `${c.date}${r}`, asDate(x.date), 'mmm d, yyyy')
    put(ws, `${c.reference}${r}`, x.reference)
    put(ws, `${c.propertyNos}${r}`, x.propertyNos.join('\n'))
    put(ws, `${c.description}${r}`, x.description)
    put(ws, `${c.life}${r}`, x.estUsefulLifeYears ?? '')
    put(ws, `${c.issuedQty}${r}`, x.issuedQty)
    put(ws, `${c.issuedTo}${r}`, x.issuedTo ?? '')
    put(ws, `${c.returnedQty}${r}`, x.returnedQty || '')
    put(ws, `${c.reissuedQty}${r}`, x.reissuedQty || '')
    put(ws, `${c.disposedQty}${r}`, x.disposedQty || '')
    put(ws, `${c.balanceQty}${r}`, x.balanceQty)
    put(ws, `${c.amount}${r}`, pesos(x.amountCentavos), MONEY)
    put(ws, `${c.remarks}${r}`, x.remarks ?? '')
    sizeRow(ws, r, [c.propertyNos, c.description, c.remarks, c.reference], { perLine: 11.5, charsPerWidth: 1.0, font: { name: 'Arial', size: 9 } })
  })
  if (!d.rows.length) ws.getRow(REGISTRY.firstRow).getCell(1).value = null
  const nos = d.rows.map((x) => x.rowNo)
  numberColumns(ws, [9, 10], REGISTRY.firstRow, 16, nos, true)
  pageEvery(ws, [9, 10], REGISTRY.firstRow, nos)
  ruleAndNumber(ws, 9, 1, REGISTRY.firstRow + Math.max(1, d.rows.length) - 1, 17)
  return toBuffer(wb)
}

export type CountData = {
  category: 'semi' | 'ppe'; typeLabel: string; asAt: string; fundCluster: string; officerName: string; officerPosition: string
  signatories: { role: string; name: string; position: string | null }[]
  rows: { article: string; description: string; propertyNos: string[]; unit: string; unitValueCentavos: number; balancePerCard: number; remarks: string | null; countedUnits?: number | null }[]
}
const namesOf = (d: CountData, role: string) => d.signatories.filter((x) => x.role === role).map((x) => x.name).join('\n')

export async function buildRpcppe(s: Settings, d: CountData) {
  const { wb, ws } = await loadTemplate('rpcppe')
  for (const [col, w] of Object.entries({ E: 26, F: 10, G: 14, K: 13, L: 22 })) ws.getColumn(col).width = w
  ws.pageSetup.fitToPage = true
  ws.pageSetup.fitToWidth = 1
  ws.pageSetup.fitToHeight = 0
  put(ws, RPCPPE.type, d.typeLabel)
  put(ws, RPCPPE.asAt, `As at ${formatLongDate(d.asAt)}`)
  put(ws, RPCPPE.fund, `Fund Cluster : ${d.fundCluster}`)
  put(ws, RPCPPE.accountable,
    `For which ${d.officerName}, ${d.officerPosition}, ${s.entityName} is accountable, having assumed such accountability on ________`)
  wrap(ws, RPCPPE.accountable, { horizontal: 'left' })
  ws.getRow(10).height = 32

  const extra = Math.max(0, d.rows.length - RPCPPE.capacity)
  insertRows(ws, RPCPPE.footerStartRow, extra, RPCPPE.firstRow + RPCPPE.capacity - 1)
  d.rows.forEach((x, i) => {
    const r = RPCPPE.firstRow + i
    const c = RPCPPE.cols
    put(ws, `${c.article}${r}`, x.article)
    put(ws, `${c.description}${r}`, x.description)
    put(ws, `${c.propertyNo}${r}`, x.propertyNos.join('\n'))
    put(ws, `${c.unit}${r}`, x.unit)
    put(ws, `${c.unitValue}${r}`, pesos(x.unitValueCentavos), MONEY)
    put(ws, `${c.balance}${r}`, x.balancePerCard)
    if (x.countedUnits !== null && x.countedUnits !== undefined) put(ws, `${c.onHand}${r}`, x.countedUnits)
    put(ws, `${c.remarks}${r}`, x.remarks ?? '')
    sizeRow(ws, r, [c.article, c.description, c.propertyNo, c.remarks], { perLine: 12 })
  })
  const f = (addr: string) => addr.replace(/\d+/, (n) => String(Number(n) + extra))
  for (const [addr, role] of [[RPCPPE.footer.committee, 'committee'], [RPCPPE.footer.head, 'head_of_agency'], [RPCPPE.footer.coa, 'coa_representative']] as const) {
    put(ws, f(addr), namesOf(d, role))
    wrap(ws, f(addr), { horizontal: 'center', vertical: 'bottom' })
  }
  const nos = d.rows.map((_x, i) => i + 1)
  numberColumns(ws, [12, 14], RPCPPE.firstRow, 13, nos, false)
  pageEvery(ws, [12, 14], RPCPPE.firstRow, nos)
  ruleAndNumber(ws, 12, 3, RPCPPE.firstRow + RPCPPE.capacity - 1 + extra, 13)
  ws.getRow(38 + extra).height = Math.max(45.75, 15 * Math.max(1, ...['committee', 'head_of_agency', 'coa_representative'].map((r) => namesOf(d, r).split('\n').length)) + 4)
  return toBuffer(wb)
}
