import { useQuery } from '@tanstack/react-query'
import { formatLongDate, formatPeso } from '@traces/shared'
import type { ColDef, ColGroupDef } from 'ag-grid-community'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api } from '@/api'
import { FormGrid, moneyCol } from '@/components/FormGrid'
import { PdfViewer } from '@/components/PdfViewer'
import { Button } from '@/components/ui/button'
import { useOfficers } from '@/lib/queries'

export type DocProperty = { id: string; propertyNo: string; componentLabel: string | null }
export type DocLine = {
  id: string; lineNo: number; qty: number; unit: string; unitCostCentavos: number; article: string; description: string
  estUsefulLifeYears: number | null; dateAcquired: string | null; category: 'semi' | 'ppe'
  region: { page: number } | null; properties: DocProperty[]
}
export type DocDetail = {
  id: string; type: 'ICS' | 'PAR'; docNo: string; fundCluster: string; issuedDate: string; purpose: string | null
  issuedByOfficerId: string; issuedByPosition: string; receivedByOfficerId: string; receivedByPosition: string
  hasPdf: boolean; pdfPageCount: number | null; lines: DocLine[]
}

const propertyNos = (l: DocLine) => l.properties.map((p) => p.propertyNo).join('\n')

// Column maps from design §4: ICS and PAR line layouts.
const icsColumns: (ColDef<DocLine> | ColGroupDef<DocLine>)[] = [
  { field: 'qty', headerName: 'Quantity', type: 'rightAligned', width: 100 },
  { field: 'unit', headerName: 'Unit', width: 90 },
  { headerName: 'Amount', children: [
    moneyCol('unitCostCentavos', 'Unit Cost', { width: 130 }) as ColDef<DocLine>,
    moneyCol('total', 'Total Cost', { width: 140, valueGetter: (p) => p.data && p.data.qty * p.data.unitCostCentavos }) as ColDef<DocLine>,
  ] },
  { field: 'description', headerName: 'Description', flex: 2, minWidth: 220, cellClass: 'traces-pre' },
  { headerName: 'Inventory Item No.', valueGetter: (p) => p.data && propertyNos(p.data), cellClass: 'traces-pre', minWidth: 190 },
  { field: 'estUsefulLifeYears', headerName: 'Estimated Useful Life', minWidth: 140 },
]
const parColumns: (ColDef<DocLine> | ColGroupDef<DocLine>)[] = [
  { field: 'qty', headerName: 'Quantity', type: 'rightAligned', width: 100 },
  { field: 'unit', headerName: 'Unit', width: 90 },
  { field: 'description', headerName: 'Description', flex: 2, minWidth: 220, cellClass: 'traces-pre' },
  { headerName: 'Property Number', valueGetter: (p) => p.data && propertyNos(p.data), cellClass: 'traces-pre', minWidth: 190 },
  { field: 'dateAcquired', headerName: 'Date Acquired', valueFormatter: (p) => (p.value ? formatLongDate(p.value) : ''), minWidth: 150 },
  moneyCol('amount', 'Amount', { valueGetter: (p) => p.data && p.data.qty * p.data.unitCostCentavos, width: 140 }) as ColDef<DocLine>,
]

export default function DocumentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: officers = [] } = useOfficers()
  const { data: doc, isLoading, error } = useQuery({ queryKey: ['document', id], queryFn: () => api.get<DocDetail>(`/api/documents/${id}`) })
  const [page, setPage] = useState(1)
  const columns = useMemo(() => (doc?.type === 'PAR' ? parColumns : icsColumns), [doc?.type])

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (error || !doc) return <p className="text-sm text-destructive">Document not found.</p>
  const nameOf = (oid: string) => officers.find((o) => o.id === oid)?.fullName ?? '…'
  const total = doc.lines.reduce((s, l) => s + l.qty * l.unitCostCentavos, 0)

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{doc.type} {doc.docNo}</h1>
          <p className="text-sm text-muted-foreground">
            Fund cluster {doc.fundCluster} · issued {formatLongDate(doc.issuedDate)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link to={`/stickers?documentId=${doc.id}`} />} nativeButton={false}>Print stickers</Button>
          <Button render={<Link to={`/documents/${doc.id}/lines/new`} />} nativeButton={false}>Add line</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Document PDF">
          {doc.hasPdf ? <PdfViewer url={`/api/documents/${doc.id}/pdf`} page={page} onPageChange={setPage} />
            : <p className="text-sm text-muted-foreground">No PDF attached.</p>}
        </section>
        <section aria-label="Lines" className="grid content-start gap-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border bg-background p-3 text-sm">
            <dt className="text-muted-foreground">{doc.type === 'ICS' ? 'Received from' : 'Issued by'}</dt><dd>{nameOf(doc.issuedByOfficerId)}<br /><span className="text-muted-foreground">{doc.issuedByPosition}</span></dd>
            <dt className="text-muted-foreground">Received by</dt><dd>{nameOf(doc.receivedByOfficerId)}<br /><span className="text-muted-foreground">{doc.receivedByPosition}</span></dd>
            {doc.purpose && <><dt className="text-muted-foreground">Purpose</dt><dd>{doc.purpose}</dd></>}
          </dl>
          <FormGrid<DocLine> columnDefs={columns} rowData={doc.lines} onRowClicked={(l) => navigate(`/lines/${l.id}/edit`)} />
          {!doc.lines.length && <p className="text-sm text-muted-foreground">No lines yet. Use “Add line” to enter the first item.</p>}
          {doc.lines.length > 0 && <p className="text-right text-sm font-medium">Total {formatPeso(total)}</p>}
        </section>
      </div>
    </div>
  )
}
