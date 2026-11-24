export type CardEvent = {
  itemId: string
  lineId: string
  type: 'RECEIPT' | 'ISSUE' | 'RETURN' | 'REISSUE' | 'DISPOSE'
  date: string
  qty: number
  itemNos: string
  firstMovementId: number
  officerId: string | null
  officerName: string | null
  officerShort: string | null
  referenceDocumentId: string | null
  referenceDocType: 'ICS' | 'PAR' | null
  referenceDocNo: string | null
  referenceText: string | null
  remarks: string | null
  unitCostCentavos: number
  balanceQty: number
  balanceAmountCentavos: number
}

export type CardRow = {
  id: string
  lineId: string
  date: string
  reference: string | null
  receiptQty: number | null
  unitCostCentavos: number
  totalCostCentavos: number | null
  issueItemNo: string | null
  issueQty: number | null
  officer: string | null
  officerFullName: string | null
  balanceQty: number
  amountCentavos: number
  remarks: string | null
}

const REMARK = { RETURN: 'Returned', REISSUE: 'Re-issued', DISPOSE: 'Disposed' } as const

const refOf = (m: CardEvent) => m.referenceText ?? (m.referenceDocNo ? `${m.referenceDocType} ${m.referenceDocNo}` : null)

function toRow(m: CardEvent): CardRow {
  const isReceipt = m.type === 'RECEIPT'
  return {
    id: String(m.firstMovementId),
    lineId: m.lineId,
    date: m.date,
    reference: refOf(m),
    receiptQty: isReceipt ? m.qty : null,
    unitCostCentavos: m.unitCostCentavos,
    totalCostCentavos: isReceipt ? m.qty * m.unitCostCentavos : null,
    issueItemNo: isReceipt ? null : m.itemNos,
    issueQty: isReceipt ? null : m.qty,
    officer: m.officerName,
    officerFullName: m.officerName,
    balanceQty: m.balanceQty,
    amountCentavos: m.balanceAmountCentavos,
    remarks: m.remarks ?? (m.type in REMARK ? REMARK[m.type as keyof typeof REMARK] : null),
  }
}

export function mergeCardRows(events: CardEvent[], mode: 'merged' | 'split'): CardRow[] {
  if (mode === 'split') return events.map(toRow)
  const receipts = new Map<string, CardEvent>()
  for (const e of events) if (e.type === 'RECEIPT' && !receipts.has(`${e.lineId}|${e.date}`)) receipts.set(`${e.lineId}|${e.date}`, e)
  const pairOf = new Map<CardEvent, CardEvent>()
  const folded = new Set<CardEvent>()
  for (const e of events) {
    const r = e.type === 'ISSUE' ? receipts.get(`${e.lineId}|${e.date}`) : undefined
    if (r && !folded.has(r)) { pairOf.set(e, r); folded.add(r) }
  }
  const rows: CardRow[] = []
  for (const e of events) {
    if (folded.has(e)) continue
    const r = pairOf.get(e)
    if (!r) { rows.push(toRow(e)); continue }
    const issue = toRow(e)
    const receiptRef = refOf(r)
    rows.push({
      ...issue,
      receiptQty: r.qty,
      totalCostCentavos: r.qty * r.unitCostCentavos,
      reference: receiptRef && receiptRef !== issue.reference ? [receiptRef, issue.reference].filter(Boolean).join(' / ') : issue.reference,
    })
  }
  return rows
}
