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
  id: string; date: string; docType: 'ICS' | 'PAR'; reference: string; propertyNos: string[]; article: string; description: string
  estUsefulLifeYears: number | null; issuedTo: string | null; issuedQty: number; returnedQty: number; reissuedQty: number
  disposedQty: number; balanceQty: number; amountCentavos: number; remarks: string | null; fundCluster: string
}
export type CardRow = {
  id: string; lineId?: string; date: string; reference: string | null; receiptQty: number | null; unitCostCentavos: number; totalCostCentavos: number | null
  issueItemNo: string | null; issueQty: number | null; officer: string | null; officerFullName: string | null
  balanceQty: number; amountCentavos: number; remarks: string | null
}
// RPCSP / RPCPPE row: On Hand per Count and Shortage/Overage are printed blank, so they are not in the data.
export type ReportRow = {
  id: string; article: string; description: string; propertyNos: string[]; unit: string; unitValueCentavos: number
  balancePerCard: number; reference: string; remarks: string | null
}
type Tab<H, R> = { header: H; rows: R[]; highlightRowId: string | null }
export type PropertyView = {
  property: { propertyNo: string; serialNo: string | null; oldPropertyNo: string | null; componentLabel: string | null; partOfSetNo: string | null
    condition: 'serviceable' | 'unserviceable'; category: 'semi' | 'ppe'; token?: string | null }
  line: { itemId?: string; article: string; description: string; qty: number; unit: string; unitCostCentavos: number; totalCostCentavos: number
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
        propertyNoFirst: string | null; propertyNoLast: string | null }
      rows: CardRow[]; highlightRowIds: string[]
    }
  }
}

type Cols<T> = (ColDef<T> | ColGroupDef<T>)[]
const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v))
const num = (headerName: string, field: string, extra: ColDef = {}): ColDef => ({ headerName, field, type: 'rightAligned', width: 96, ...extra })
const date = (field: string): ColDef => ({ headerName: 'Date', field, width: 130, valueFormatter: (p) => (p.value ? formatLongDate(p.value) : '') })

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
export const registryColumns: Cols<RegistryRow> = [
  date('date') as ColDef<RegistryRow>,
  { headerName: 'Reference (ICS/RRSP No.)', field: 'reference', width: 190 },
  { headerName: 'Property No.', valueGetter: (p) => p.data?.propertyNos.join('\n'), cellClass: 'traces-pre', minWidth: 170 },
  { headerName: 'Item Description', field: 'description', flex: 2, minWidth: 220, cellClass: 'traces-pre' },
  { headerName: 'Estimated Useful Life', field: 'estUsefulLifeYears', width: 130, valueFormatter: (p) => dash(p.value) },
  { headerName: 'Issued', children: [num('Qty.', 'issuedQty', { width: 80 }), { headerName: 'Office/Officer', field: 'issuedTo', width: 170 }] },
  { headerName: 'Returned', children: [num('Qty.', 'returnedQty', { width: 90 }), { headerName: 'Office/Officer', width: 170, valueGetter: () => '' }] },
  { headerName: 'Re-issued', children: [num('Qty.', 'reissuedQty', { width: 90 }), { headerName: 'Office/Officer', width: 170, valueGetter: () => '' }] },
  { headerName: 'Disposed', children: [num('Qty.', 'disposedQty', { width: 110 })] },
  { headerName: 'Balance', children: [num('Qty.', 'balanceQty', { width: 110 })] },
  moneyCol('amountCentavos', 'Amount', { width: 140 }) as ColDef<RegistryRow>,
  { headerName: 'Remarks', field: 'remarks', minWidth: 180, flex: 1, cellClass: 'traces-pre' },
]

// SPC (semi-expendable) has an Item No. column in Issue/Transfer/Disposal; the PC (Appendix 69) does not.
export const cardColumns = (category: 'semi' | 'ppe'): Cols<CardRow> => [
  date('date') as ColDef<CardRow>,
  { headerName: category === 'semi' ? 'Reference' : 'Reference/PAR No.', field: 'reference', width: 190, cellClass: 'traces-pre' },
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
      num('Qty.', 'issueQty', { width: 90 }), { headerName: 'Office/Officer', field: 'officer', width: 170 },
    ],
  },
  { headerName: 'Balance', children: [num('Qty.', 'balanceQty', { width: 110 })] },
  moneyCol('amountCentavos', 'Amount', { width: 140 }) as ColDef<CardRow>,
  { headerName: 'Remarks', field: 'remarks', minWidth: 160, flex: 1 },
] as Cols<CardRow>

// The officer report (RPCSP / RPCPPE): "On Hand per Count" and "Shortage/Overage" stay empty, they are filled in by hand when printed.
export const reportColumns: Cols<ReportRow> = [
  { headerName: 'Article', field: 'article', width: 150 },
  { headerName: 'Description', field: 'description', flex: 2, minWidth: 220, cellClass: 'traces-pre' },
  { headerName: 'Property No.', valueGetter: (p) => p.data?.propertyNos.join('
'), cellClass: 'traces-pre', minWidth: 190 },
  { headerName: 'Unit of Measure', field: 'unit', width: 110 },
  moneyCol('unitValueCentavos', 'Unit Value', { width: 140 }) as ColDef<ReportRow>,
  { headerName: 'Balance per Card', children: [num('Qty.', 'balancePerCard', { width: 90 })] },
  { headerName: 'On Hand per Count', children: [{ headerName: 'Qty.', width: 100, valueGetter: () => '' }] },
  { headerName: 'Shortage/Overage', children: [{ headerName: 'Qty.', width: 90, valueGetter: () => '' }, { headerName: 'Value', width: 110, valueGetter: () => '' }] },
  { headerName: 'Remarks', field: 'remarks', minWidth: 200, flex: 1, cellClass: 'traces-pre', valueFormatter: (p) => p.value ?? '' },
]
