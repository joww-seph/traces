// Pure: turns v_item_card rows (one per event per line, running balance already computed in SQL)
// into the rows of a model card (SPC / PC). BR-07 decides whether a RECEIPT and an ISSUE of the same line share a row.

export type CardEvent = {
  itemId: string
  lineId: string
  type: 'RECEIPT' | 'ISSUE' | 'RETURN' | 'REISSUE' | 'DISPOSE'
  date: string // YYYY-MM-DD
  qty: number // main units only; a component-only event is 0
  itemNos: string // every property number of the event, one per line of text (components included)
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
  balanceQty: number // stock held by the Supply Unit after this event
  balanceAmountCentavos: number
}

export type CardRow = {
  id: string // first movement id; a merged row uses its ISSUE event's id
  lineId: string // the line (ICS/PAR row) this row belongs to: what a QR scan highlights
  date: string
  reference: string | null
  receiptQty: number | null
  unitCostCentavos: number
  totalCostCentavos: number | null
  issueItemNo: string | null // SPC only shows it; the PC ignores it
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
    officer: m.officerShort,
    officerFullName: m.officerName,
    balanceQty: m.balanceQty,
    amountCentavos: m.balanceAmountCentavos,
    remarks: m.remarks ?? (m.type in REMARK ? REMARK[m.type as keyof typeof REMARK] : null),
  }
}

// `events` must be one card's rows ordered by (date, firstMovementId).
export function mergeCardRows(events: CardEvent[], mode: 'merged' | 'split'): CardRow[] {
  if (mode === 'split') return events.map(toRow)
  // a RECEIPT folds into the ISSUE of the same line on the same date; the merged row sits at the ISSUE's place
  const receipts = new Map<string, CardEvent>()
  for (const e of events) if (e.type === 'RECEIPT' && !receipts.has(`${e.lineId}|${e.date}`)) receipts.set(`${e.lineId}|${e.date}`, e)
  const pairOf = new Map<CardEvent, CardEvent>() // ISSUE -> its RECEIPT
  const folded = new Set<CardEvent>() // RECEIPTs shown inside an ISSUE row
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
