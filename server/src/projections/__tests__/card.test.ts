import { describe, expect, it } from 'vitest'
import { mergeCardRows, type CardEvent } from '../card.js'

const base = {
  itemId: 'i1', lineId: 'l1', unitCostCentavos: 3709200, qty: 1, itemNos: '2026-03ICT-0001',
  officerId: null, officerName: null, officerShort: null, referenceDocumentId: null, referenceDocType: null, referenceDocNo: null,
  referenceText: null, remarks: null,
}
const receipt = (over: Partial<CardEvent> = {}): CardEvent =>
  ({ ...base, firstMovementId: 1, type: 'RECEIPT', date: '2026-03-01', balanceQty: 2, balanceAmountCentavos: 7418400, ...over })
const issue = (over: Partial<CardEvent> = {}): CardEvent =>
  ({ ...base, firstMovementId: 2, type: 'ISSUE', date: '2026-03-01', balanceQty: 1, balanceAmountCentavos: 3709200,
    officerId: 'o1', officerName: 'Maria Santos', officerShort: 'MSantos',
    referenceDocumentId: 'd1', referenceDocType: 'ICS', referenceDocNo: '2026-03SARAi-005', ...over })

describe('mergeCardRows', () => {
  it("merged: a RECEIPT and an ISSUE of the same line on the same day become one row keyed by the ISSUE's id", () => {
    const rows = mergeCardRows([receipt(), issue()], 'merged')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: '2', lineId: 'l1', date: '2026-03-01', receiptQty: 1, unitCostCentavos: 3709200, totalCostCentavos: 3709200,
      issueQty: 1, issueItemNo: '2026-03ICT-0001', officer: 'MSantos', officerFullName: 'Maria Santos',
      balanceQty: 1, amountCentavos: 3709200, reference: 'ICS 2026-03SARAi-005',
    })
  })

  it('split: one row per event', () => {
    const rows = mergeCardRows([receipt(), issue()], 'split')
    expect(rows.map((r) => r.id)).toEqual(['1', '2'])
    expect(rows[0]).toMatchObject({ receiptQty: 1, issueQty: null, officer: null, balanceQty: 2 })
    expect(rows[1]).toMatchObject({ receiptQty: null, issueQty: 1, officer: 'MSantos', balanceQty: 1 })
  })

  it('different dates stay two rows', () => {
    expect(mergeCardRows([receipt({ date: '2026-02-10' }), issue()], 'merged')).toHaveLength(2)
  })

  it('events of different lines on the same day do not merge, even when interleaved', () => {
    const rows = mergeCardRows([
      receipt({ lineId: 'a', firstMovementId: 1 }), receipt({ lineId: 'b', firstMovementId: 2 }),
      issue({ lineId: 'a', firstMovementId: 3 }), issue({ lineId: 'b', firstMovementId: 4 }),
    ], 'merged')
    expect(rows.map((r) => [r.lineId, r.id])).toEqual([['a', '3'], ['b', '4']])
    expect(rows.every((r) => r.receiptQty === 1 && r.issueQty === 1)).toBe(true)
  })

  it('keeps the receipt reference (IAR no.) next to the document when they differ', () => {
    expect(mergeCardRows([receipt({ referenceText: 'IAR-77' }), issue()], 'merged')[0].reference).toBe('IAR-77 / ICS 2026-03SARAi-005')
  })

  it('a set is one row listing every item number; a component-only event has quantity 0', () => {
    const rows = mergeCardRows([
      receipt({ itemNos: 'S-1\nS-1a\nS-1b' }), issue({ itemNos: 'S-1\nS-1a\nS-1b' }),
      { ...issue({ firstMovementId: 9, date: '2026-06-01', itemNos: 'S-1b', qty: 0 }), type: 'DISPOSE' },
    ], 'merged')
    expect(rows[0].issueItemNo).toBe('S-1\nS-1a\nS-1b')
    expect(rows[1]).toMatchObject({ issueQty: 0, issueItemNo: 'S-1b', remarks: 'Disposed' })
  })

  it('RETURN and REISSUE are labelled in remarks unless the event has its own', () => {
    const rows = mergeCardRows([
      receipt(), issue(),
      { ...issue({ firstMovementId: 4, date: '2026-04-01' }), type: 'RETURN' },
      { ...issue({ firstMovementId: 5, date: '2026-04-02', remarks: 'to Lab' }), type: 'REISSUE' },
    ], 'split')
    expect(rows[2].remarks).toBe('Returned')
    expect(rows[3].remarks).toBe('to Lab')
  })

  it('empty in, empty out', () => {
    expect(mergeCardRows([], 'merged')).toEqual([])
  })
})
