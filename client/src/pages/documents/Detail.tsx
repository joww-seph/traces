import { useQuery } from '@tanstack/react-query'
import { formatLongDate, formatPeso } from '@traces/shared'
import type { ColDef, ColGroupDef } from 'ag-grid-community'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Plus, QrCode } from 'lucide-react'
import { api } from '@/api'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { TypeBadge } from '@/components/TypeBadge'
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
  { field: 'qty', headerName: 'Quantity', type: 'rightAligned', width: 116 },
  { field: 'unit', headerName: 'Unit', width: 96 },
  { headerName: 'Amount', children: [
    moneyCol('unitCostCentavos', 'Unit Cost', { width: 130 }) as ColDef<DocLine>,
    moneyCol('total', 'Total Cost', { width: 140, valueGetter: (p) => p.data && p.data.qty * p.data.unitCostCentavos }) as ColDef<DocLine>,
  ] },
  { field: 'description', headerName: 'Description', flex: 2, minWidth: 220, cellClass: 'traces-pre' },
  { headerName: 'Inventory Item No.', valueGetter: (p) => p.data && propertyNos(p.data), cellClass: 'traces-pre', minWidth: 190 },
  { field: 'estUsefulLifeYears', headerName: 'Estimated Useful Life', minWidth: 140 },
]
const parColumns: (ColDef<DocLine> | ColGroupDef<DocLine>)[] = [
  { field: 'qty', headerName: 'Quantity', type: 'rightAligned', width: 116 },
  { field: 'unit', headerName: 'Unit', width: 96 },
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

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading document</p>
  if (error || !doc) {
    return <EmptyState title="Document not found" action={<Button render={<Link to="/documents" />} nativeButton={false}>Back to ICS and PAR</Button>}>
      It may have been deleted, or the link is wrong.
    </EmptyState>
  }
  const officer = (oid: string) => officers.find((o) => o.id === oid)
  const total = doc.lines.reduce((s, l) => s + l.qty * l.unitCostCentavos, 0)
  const signer = (label: string, oid: string, position: string) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{officer(oid)?.fullName ?? ' '}</dd>
      <dd className="truncate text-xs text-muted-foreground">{position}</dd>
    </div>
  )

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'ICS and PAR', to: '/documents' }, { label: doc.docNo }]}
        title={<span className="flex flex-wrap items-center gap-3"><TypeBadge type={doc.type} className="h-7 w-12 text-sm" /><span className="figures">{doc.docNo}</span></span>}
        actions={<>
          <Button variant="outline" render={<Link to={`/stickers?documentId=${doc.id}`} />} nativeButton={false}><QrCode /> Print stickers</Button>
          <Button render={<Link to={`/documents/${doc.id}/lines/new`} />} nativeButton={false}><Plus /> Add line</Button>
        </>}
        meta={
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border bg-card p-4 sm:grid-cols-3 lg:grid-cols-5">
            <div><dt className="text-xs text-muted-foreground">Date issued</dt><dd className="mt-0.5 text-sm font-medium">{formatLongDate(doc.issuedDate)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Fund cluster</dt><dd className="mt-0.5 text-sm font-medium">{doc.fundCluster}</dd></div>
            {signer(doc.type === 'ICS' ? 'Received from' : 'Issued by', doc.issuedByOfficerId, doc.issuedByPosition)}
            {signer('Received by', doc.receivedByOfficerId, doc.receivedByPosition)}
            <div className="col-span-2 sm:col-span-1"><dt className="text-xs text-muted-foreground">Purpose</dt><dd className="mt-0.5 text-sm">{doc.purpose || 'None given'}</dd></div>
          </dl>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section aria-labelledby="pdf-title" className="grid content-start gap-3">
          <h2 id="pdf-title" className="text-base font-semibold">Signed form</h2>
          {doc.hasPdf ? <PdfViewer url={`/api/documents/${doc.id}/pdf`} page={page} onPageChange={setPage} />
            : <p className="text-sm text-muted-foreground">No PDF attached.</p>}
        </section>
        <section aria-labelledby="lines-title" className="grid content-start gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="lines-title" className="text-base font-semibold">Lines</h2>
            {doc.lines.length > 0 && <p className="figures text-sm">Total <span className="font-semibold">{formatPeso(total)}</span></p>}
          </div>
          {doc.lines.length ? (
            <>
              <FormGrid<DocLine> columnDefs={columns} rowData={doc.lines} onRowClicked={(l) => navigate(`/lines/${l.id}/edit`)} />
              <p className="text-xs text-muted-foreground">Select a line to edit it, change its property numbers or redraw its box on the PDF.</p>
            </>
          ) : (
            <EmptyState title="No lines yet" action={<Button render={<Link to={`/documents/${doc.id}/lines/new`} />} nativeButton={false}><Plus /> Add the first line</Button>}>
              Enter each row of the form once; the property card, registry entry and QR sticker come from it.
            </EmptyState>
          )}
        </section>
      </div>
    </>
  )
}
