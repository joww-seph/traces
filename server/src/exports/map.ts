// Cell addresses of the official templates in ./templates (converted from the COA forms). Rows are the
// template's own; fill.ts shifts the footer addresses down by the number of rows it had to insert.

export const PC = {
  entity: 'B6', fund: 'I6', article: 'B8', propertyNo: 'I9', description: 'B10',
  firstRow: 13, capacity: 18, // table rows 13-30
  cols: { date: 'B', reference: 'C', receiptQty: 'D', issueQty: 'E', officer: 'F', balanceQty: 'H', amount: 'I', remarks: 'J' },
  officerMerge: ['F', 'G'] as [string, string],
}

export const REGISTRY = {
  entity: 'A6', fund: 'L6', title: 'C4', propertyLabel: 'A7', refHeader: 'C10',
  firstRow: 11,
  cols: { date: 'A', reference: 'B', propertyNos: 'C', description: 'D', life: 'E', issuedQty: 'F', issuedTo: 'G',
    returnedQty: 'H', returnedTo: 'I', reissuedQty: 'J', reissuedTo: 'K', disposedQty: 'L', balanceQty: 'M', amount: 'N', remarks: 'O' },
}

export const RPCPPE = {
  type: 'C4', asAt: 'C6', fund: 'C9', accountable: 'C10',
  firstRow: 15, capacity: 20, // table rows 15-34
  cols: { article: 'C', description: 'D', propertyNo: 'E', unit: 'F', unitValue: 'G', balance: 'H', onHand: 'I', shortQty: 'J', shortValue: 'K', remarks: 'L' },
  footerStartRow: 36,
  footer: { committee: 'D38', head: 'G38', coa: 'K38' },
}
