import { formatLongDate, formatPeso } from '@traces/shared'
import type { ColDef, ColGroupDef } from 'ag-grid-community'
import { moneyCol } from '@/components/FormGrid'

// Shapes of GET /api/properties/:no/view and GET /api/public/q/:token (see projections/propertyView.ts).
export type Region = { page: number; x: number; y: number; w: number; h: number }
export type IcsParRow = {
  id: string; lineNo: number; qty: number; unit: string; unitCostCentavos: number; totalCostCentavos: number
  description: string; propertyNos: string[]; estUsefulLifeYears: number | null; dateAcquired: string | null
}
export type RegistryRow = {
  id: string; rowNo: number; documentId?: string; date: string; docType: 'ICS' | 'PAR'; reference: string; propertyNos: string[]; article: string; description: string
  estUsefulLifeYears: number | null; issuedTo: string | null; issuedQty: number; returnedQty: number; reissuedQty: number
  disposedQty: number; balanceQty: number; amountCentavos: number; remarks: string | null; fundCluster: string
}
export type CardRow = {
  id: string; lineId?: string; date: string; reference: string | null; receiptQty: number | null; unitCostCentavos: number; totalCostCentavos: number | null
  issueItemNo: string | null; issueQty: number | null; officer: string | null; officerFullName: string | null
  balanceQty: number; amountCentavos: number; remarks: string | null
}
// RPCSP / RPCPPE row. With a physical count chosen, countedUnits / counted say whether a scan found the row's units; without one both are null.
export type ReportRow = {
  id: string; rowNo: number; documentId?: string; article: string; description: string; propertyNos: string[]; unit: string; unitValueCentavos: number
  balancePerCard: number; reference: string; remarks: string | null; countedUnits?: number | null; counted?: boolean | null
}
// IIRUP / IIRUSP row: unserviceable items; the cost columns are worked out, the disposal side is blank
export type UnserviceableRow = {
  id: string; rowNo: number; documentId?: string; dateAcquired: string; article: string; description: string; propertyNos: string[]; unit: string
  qty: number; unitValueCentavos: number; totalCostCentavos: number; reference: string; remarks: string | null
}
type Tab<H, R> = { header: H; rows: R[]; highlightRowId: string | null }
export type PropertyView = {
  property: { propertyNo: string; serialNo: string | null; oldPropertyNo: string | null; componentLabel: string | null; partOfSetNo: string | null
    condition: 'serviceable' | 'unserviceable'; category: 'semi' | 'ppe'; token?: string | null }
  line: { cardId?: string; article: string; description: string; qty: number; unit: string; unitCostCentavos: number; totalCostCentavos: number
    estUsefulLifeYears: number | null; dateAcquired: string | null }
  document: { type: 'ICS' | 'PAR'; docNo: string; fundCluster: string; issuedDate: string
    issuedBy: { name: string; position: string }; receivedBy: { name: string; position: string }
    pdfUrl: string | null; pdfRegion: Region | null; signed: boolean }
  tabs: {
    icsPar: Tab<{ title: string; type: 'ICS' | 'PAR'; docNo: string; fundCluster: string; entityName: string }, IcsParRow>
    report: Tab<{
      title: string; typeLabel: string; asAt: string; fundCluster: string; entityName: string; officerName: string; officerPosition: string
    }, ReportRow> | { empty: 'NOT_ISSUED' }
    registry: Tab<{ title: string; category: 'semi' | 'ppe'; typeName: string; entityName: string; fundCluster: string }, RegistryRow>
    card: {
      header: { title: string; category: 'semi' | 'ppe'; entityName: string; fundCluster: string; article: string; description: string; typeName: string
        propertyNo: string }
      rows: CardRow[]; highlightRowIds: string[]
    }
  }
}

type Cols<T> = (ColDef<T> | ColGroupDef<T>)[]
const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v))
const num = (headerName: string, field: string, extra: ColDef = {}): ColDef => ({ headerName, field, type: 'rightAligned', width: 96, ...extra })
const date = (field: string): ColDef => ({ headerName: 'Date', field, width: 130, valueFormatter: (p) => (p.value ? formatLongDate(p.value) : '') })
// No.: the row's number in its register or report, the same on screen and on the printed sheet (decision 2026-11-18)
export const ROWS_PER_SHEET = 20
const rowNoCol = (): ColDef => ({ headerName: 'No.', field: 'rowNo', width: 76, type: 'rightAligned', pinned: 'left' })
const sheetCol = (): ColDef => ({ headerName: 'Sheet No.', width: 96, type: 'rightAligned', valueGetter: (p) => (p.data?.rowNo ? Math.floor((p.data.rowNo - 1) / ROWS_PER_SHEET) + 1 : '') })

// Column maps from design §4: they must match the official forms exactly.
export const icsParColumns = (type: 'ICS' | 'PAR'): Cols<IcsParRow> =>
  type === 'ICS'
    ? [
        num('Quantity', 'qty', { width: 112 }), { headerName: 'Unit', field: 'unit', width: 96 },
        { headerName: 'Amount', children: [moneyCol('unitCostCentavos', 'Unit Cost', { width: 132 }), moneyCol('totalCostCentavos', 'Total Cost', { width: 140 })] },
        { headerName: 'Description', field: 'description', flex: 2, minWidth: 220, cellClass: 'traces-pre' },
        { headerName: 'Inventory Item No.', valueGetter: (p) => p.data?.propertyNos.join('\n'), cellClass: 'traces-pre', minWidth: 190 },
        { headerName: 'Estimated Useful Life', field: 'estUsefulLifeYears', minWidth: 140 },
      ] as Cols<IcsParRow>
    : [
        num('Quantity', 'qty', { width: 112 }), { headerName: 'Unit', field: 'unit', width: 96 },
        { headerName: 'Description', field: 'description', flex: 2, minWidth: 220, cellClass: 'traces-pre' },
        { headerName: 'Property Number', valueGetter: (p) => p.data?.propertyNos.join('\n'), cellClass: 'traces-pre', minWidth: 190 },
        { headerName: 'Date Acquired', field: 'dateAcquired', valueFormatter: (p) => (p.value ? formatLongDate(p.value) : ''), minWidth: 150 },
        moneyCol('totalCostCentavos', 'Amount', { width: 140 }),
      ] as Cols<IcsParRow>

// RegSPI (Annex A.4) and the PPE registry share one layout.
// Date and reference stay pinned on the left so a row is still identifiable when the wide form is scrolled sideways.
export const registryColumns: Cols<RegistryRow> = [
  rowNoCol() as ColDef<RegistryRow>,
  { ...date('date'), pinned: 'left' } as ColDef<RegistryRow>,
  { headerName: 'Reference (ICS/RRSP No.)', field: 'reference', width: 190, pinned: 'left' },
  { headerName: 'Property No.', valueGetter: (p) => p.data?.propertyNos.join('\n'), cellClass: 'traces-pre', minWidth: 170 },
  { headerName: 'Item Description', field: 'description', flex: 2, minWidth: 220, cellClass: 'traces-pre' },
  { headerName: 'Estimated Useful Life', field: 'estUsefulLifeYears', width: 130, valueFormatter: (p) => dash(p.value) },
  { headerName: 'Issued', children: [num('Qty.', 'issuedQty', { width: 80 }), { headerName: 'Office/Officer', field: 'issuedTo', width: 210 }] },
  { headerName: 'Returned', children: [num('Qty.', 'returnedQty', { width: 90 }), { headerName: 'Office/Officer', width: 170, valueGetter: () => '' }] },
  { headerName: 'Re-issued', children: [num('Qty.', 'reissuedQty', { width: 90 }), { headerName: 'Office/Officer', width: 170, valueGetter: () => '' }] },
  { headerName: 'Disposed', children: [num('Qty.', 'disposedQty', { width: 110 })] },
  { headerName: 'Balance', children: [num('Qty.', 'balanceQty', { width: 110 })] },
  moneyCol('amountCentavos', 'Amount', { width: 140 }) as ColDef<RegistryRow>,
  { headerName: 'Remarks', field: 'remarks', minWidth: 180, flex: 1, cellClass: 'traces-pre' },
  sheetCol() as ColDef<RegistryRow>,
]

// SPC (semi-expendable) has an Item No. column in Issue/Transfer/Disposal; the PC (Appendix 69) does not.
// editRemarks: staff can type the Remarks of a row (for later transfers)
export const cardColumns = (category: 'semi' | 'ppe', editRemarks = false): Cols<CardRow> => [
  { ...date('date'), pinned: 'left' } as ColDef<CardRow>,
  { headerName: category === 'semi' ? 'Reference' : 'Reference/PAR No.', field: 'reference', width: 190, cellClass: 'traces-pre', pinned: 'left' },
  {
    headerName: 'Receipt',
    children: category === 'semi'
      ? [num('Qty.', 'receiptQty', { width: 90 }), moneyCol('unitCostCentavos', 'Unit Cost', { width: 130, valueFormatter: (p) => (p.data?.receiptQty ? formatPeso(p.value) : '') }), moneyCol('totalCostCentavos', 'Total Cost', { width: 140 })]
      : [num('Qty.', 'receiptQty', { width: 110 })],
  },
  {
    headerName: 'Issue/Transfer/Disposal',
    children: [
      ...(category === 'semi' ? [{ headerName: 'Item No.', field: 'issueItemNo', width: 170 } as ColDef] : []),
      num('Qty.', 'issueQty', { width: 90 }), { headerName: 'Office/Officer', field: 'officer', width: 210 },
    ],
  },
  { headerName: 'Balance', children: [num('Qty.', 'balanceQty', { width: 110 })] },
  moneyCol('amountCentavos', 'Amount', { width: 140 }) as ColDef<CardRow>,
  { headerName: editRemarks ? 'Remarks (edit)' : 'Remarks', field: 'remarks', minWidth: 180, flex: 1, editable: editRemarks, cellClass: editRemarks ? 'traces-editable' : undefined },
] as Cols<CardRow>

// The officer report (RPCSP / RPCPPE): "On Hand per Count" shows what a QR count found (empty with no count); "Shortage/Overage" stays empty, it is filled in by hand.
export const reportColumns: Cols<ReportRow> = [
  rowNoCol() as ColDef<ReportRow>,
  { headerName: 'Article', field: 'article', width: 150 },
  { headerName: 'Description', field: 'description', flex: 2, minWidth: 220, cellClass: 'traces-pre' },
  { headerName: 'Property No.', valueGetter: (p) => p.data?.propertyNos.join('\n'), cellClass: 'traces-pre', minWidth: 190 },
  { headerName: 'Unit of Measure', field: 'unit', width: 110 },
  moneyCol('unitValueCentavos', 'Unit Value', { width: 140 }) as ColDef<ReportRow>,
  { headerName: 'Balance per Card', children: [num('Qty.', 'balancePerCard', { width: 90 })] },
  { headerName: 'On Hand per Count', children: [{ headerName: 'Qty.', width: 100, valueGetter: (p) => p.data?.countedUnits ?? '' }] },
  { headerName: 'Shortage/Overage', children: [{ headerName: 'Qty.', width: 90, valueGetter: () => '' }, { headerName: 'Value', width: 110, valueGetter: () => '' }] },
  { headerName: 'Remarks', field: 'remarks', minWidth: 200, flex: 1, cellClass: 'traces-pre', valueFormatter: (p) => p.value ?? '' },
]

// the Counted / Not counted column, only when a physical count is chosen; a row with several units reads "Not counted (1 of 2)" until all are found
export const countStatus = (r: ReportRow) =>
  r.counted === null || r.counted === undefined ? '' : r.counted ? 'Counted' : r.countedUnits ? `Not counted (${r.countedUnits} of ${r.balancePerCard})` : 'Not counted'
export const reportColumnsWithCount: Cols<ReportRow> = [
  ...reportColumns,
  { headerName: 'Count', width: 190, valueGetter: (p) => (p.data ? countStatus(p.data) : ''), cellClass: (p) => (p.data?.counted ? 'font-medium text-emerald-700' : 'font-medium text-amber-700') },
]

// IIRUP (Appendix 74) / IIRUSP: accumulated depreciation, impairment, carrying amount and the disposal columns are not stored, so they are left out here and print blank
export const unserviceableColumns: Cols<UnserviceableRow> = [
  rowNoCol() as ColDef<UnserviceableRow>,
  { ...date('dateAcquired'), headerName: 'Date Acquired' } as ColDef<UnserviceableRow>,
  { headerName: 'Particulars/Articles', valueGetter: (p) => (p.data ? `${p.data.article}, ${p.data.description}` : ''), flex: 2, minWidth: 240, cellClass: 'traces-pre' },
  { headerName: 'Property No.', valueGetter: (p) => p.data?.propertyNos.join('\n'), cellClass: 'traces-pre', minWidth: 190 },
  num('Qty', 'qty', { width: 80 }),
  moneyCol('unitValueCentavos', 'Unit Cost', { width: 130 }) as ColDef<UnserviceableRow>,
  moneyCol('totalCostCentavos', 'Total Cost', { width: 140 }) as ColDef<UnserviceableRow>,
  { headerName: 'Remarks', field: 'remarks', minWidth: 180, flex: 1, cellClass: 'traces-pre', valueFormatter: (p) => p.value ?? '' },
]
