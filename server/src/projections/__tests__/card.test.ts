import { describe, expect, it } from 'vitest'
import { mergeCardRows, type CardMovement } from '../card.js'

const base = {
  propertyId: 'p1', propertyNo: '2026-09ICT-0199', category: 'ppe' as const, unitCostCentavos: 9645000,
  officerId: null, officerName: null, officerShort: null, referenceDocumentId: null, referenceDocType: null, referenceDocNo: null,
  referenceText: null, remarks: null, qty: 1,
}
const receipt = (over: Partial<CardMovement> = {}): CardMovement =>
  ({ ...base, movementId: 1, type: 'RECEIPT', date: '2026-03-01', balanceQty: 1, ...over })
const issue = (over: Partial<CardMovement> = {}): CardMovement =>
  ({ ...base, movementId: 2, type: 'ISSUE', date: '2026-03-01', balanceQty: 1, officerId: 'o1', officerName: 'Maria Santos', officerShort: 'MSantos',
    referenceDocumentId: 'd1', referenceDocType: 'ICS', referenceDocNo: '2026-03SARAi-005', ...over })
const dispose = (over: Partial<CardMovement> = {}): CardMovement =>
  ({ ...base, movementId: 3, type: 'DISPOSE', date: '2026-06-01', balanceQty: 0, ...over })

describe('mergeCardRows', () => {
  it("merged: a RECEIPT and an ISSUE on the same day become one row keyed by the ISSUE's id", () => {
    const rows = mergeCardRows([receipt(), issue()], 'merged')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: '2', date: '2026-03-01', receiptQty: 1, unitCostCentavos: 9645000, totalCostCentavos: 9645000,
      issueQty: 1, issueItemNo: '2026-09ICT-0199', officer: 'MSantos', officerFullName: 'Maria Santos',
      balanceQty: 1, amountCentavos: 9645000, reference: 'ICS 2026-03SARAi-005',
    })
  })

  it('split: one row per movement', () => {
    const rows = mergeCardRows([receipt(), issue()], 'split')
    expect(rows.map((r) => r.id)).toEqual(['1', '2'])
    expect(rows[0]).toMatchObject({ receiptQty: 1, issueQty: null, officer: null })
    expect(rows[1]).toMatchObject({ receiptQty: null, issueQty: 1, officer: 'MSantos' })
  })

  it('keeps the receipt reference (IAR no.) next to the document when they differ', () => {
    const rows = mergeCardRows([receipt({ referenceText: 'IAR-77' }), issue()], 'merged')
    expect(rows[0].reference).toBe('IAR-77 / ICS 2026-03SARAi-005')
  })

  it('does not merge across different days', () => {
    expect(mergeCardRows([receipt({ date: '2026-02-10' }), issue()], 'merged')).toHaveLength(2)
  })

  it('does not merge an ISSUE that is not preceded by a RECEIPT', () => {
    expect(mergeCardRows([issue({ movementId: 5 }), issue({ movementId: 6 })], 'merged')).toHaveLength(2)
  })

  it('a DISPOSE row shows balance 0 and amount 0, with the disposal as remarks', () => {
    const rows = mergeCardRows([receipt(), issue(), dispose()], 'merged')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ id: '3', issueQty: 1, balanceQty: 0, amountCentavos: 0, remarks: 'Disposed', officer: null })
  })

  it('RETURN and REISSUE are labelled in remarks unless the movement has its own', () => {
    const rows = mergeCardRows([
      receipt(), issue(),
      { ...issue({ movementId: 4, date: '2026-04-01' }), type: 'RETURN' },
      { ...issue({ movementId: 5, date: '2026-04-02', remarks: 'to Lab' }), type: 'REISSUE' },
    ], 'split')
    expect(rows[2].remarks).toBe('Returned')
    expect(rows[3].remarks).toBe('to Lab')
  })

  it('empty in, empty out', () => {
    expect(mergeCardRows([], 'merged')).toEqual([])
  })
})
