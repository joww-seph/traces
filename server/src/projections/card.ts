// Pure: turns v_card_movements rows (one per movement, with the running balance already computed in SQL)
// into the rows of a property card (SPC / PC). BR-07 decides whether a RECEIPT and an ISSUE share a row.

export type CardMovement = {
  movementId: number
  propertyId: string
  propertyNo: string
  category: 'semi' | 'ppe'
  type: 'RECEIPT' | 'ISSUE' | 'RETURN' | 'REISSUE' | 'DISPOSE'
  qty: number
  date: string // YYYY-MM-DD
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
}

export type CardRow = {
  id: string // movement id; a merged row uses its ISSUE movement's id
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
  amountCentavos: number // balance x unit cost, derived here, never stored
  remarks: string | null
}

const REMARK = { RETURN: 'Returned', REISSUE: 'Re-issued', DISPOSE: 'Disposed' } as const

const refOf = (m: CardMovement) => m.referenceText ?? (m.referenceDocNo ? `${m.referenceDocType} ${m.referenceDocNo}` : null)

function toRow(m: CardMovement): CardRow {
  const isReceipt = m.type === 'RECEIPT'
  return {
    id: String(m.movementId),
    date: m.date,
    reference: refOf(m),
    receiptQty: isReceipt ? m.qty : null,
    unitCostCentavos: m.unitCostCentavos,
    totalCostCentavos: isReceipt ? m.qty * m.unitCostCentavos : null,
    issueItemNo: isReceipt ? null : m.propertyNo,
    issueQty: isReceipt ? null : m.qty,
    officer: m.officerShort,
    officerFullName: m.officerName,
    balanceQty: m.balanceQty,
    amountCentavos: m.balanceQty * m.unitCostCentavos,
    remarks: m.remarks ?? (m.type in REMARK ? REMARK[m.type as keyof typeof REMARK] : null),
  }
}

// `movements` must be one property's rows ordered by (date, movementId).
export function mergeCardRows(movements: CardMovement[], mode: 'merged' | 'split'): CardRow[] {
  const rows: CardRow[] = []
  for (let i = 0; i < movements.length; i++) {
    const m = movements[i]
    const next = movements[i + 1]
    if (mode === 'merged' && m.type === 'RECEIPT' && next?.type === 'ISSUE' && next.date === m.date) {
      const issue = toRow(next)
      const receiptRef = refOf(m)
      rows.push({
        ...issue,
        receiptQty: m.qty,
        totalCostCentavos: m.qty * m.unitCostCentavos,
        reference: receiptRef && receiptRef !== issue.reference ? [receiptRef, issue.reference].filter(Boolean).join(' / ') : issue.reference,
      })
      i++
    } else rows.push(toRow(m))
  }
  return rows
}
