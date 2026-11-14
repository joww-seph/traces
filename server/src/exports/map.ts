// Cell addresses of the official templates in ./templates (converted from the COA forms). Rows are the
// template's own; fill.ts shifts the footer addresses down by the number of rows it had to insert.

export const ICS = {
  formCode: 'F2',          // merged F2:G3, a cell box because ExcelJS drops drawing shapes
  entity: 'A7', fund: 'A8', docNo: 'E8',
  firstRow: 12, capacity: 5, // table rows 12-16
  cols: { qty: 'A', unit: 'B', unitCost: 'C', totalCost: 'D', description: 'E', itemNos: 'F', life: 'G' },
  footer: { nameLeft: 'A19', nameRight: 'E19', posLeft: 'A21', posRight: 'E21', dateLeft: 'A23', dateRight: 'E23' },
  footerStartRow: 17,
}

export const PAR = {
  formCode: 'E2',          // merged E2:F2
  entity: 'A6', fund: 'A7', docNo: 'E7',
  firstRow: 11, capacity: 33, // table rows 11-43
  cols: { qty: 'A', unit: 'B', description: 'C', propertyNo: 'D', dateAcquired: 'E', amount: 'F' },
  footer: { nameLeft: 'A45', nameRight: 'D45', posLeft: 'A47', posRight: 'D47', dateLeft: 'A49', dateRight: 'D49' },
  footerStartRow: 44,
}

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
