import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatLongDate, formatPeso } from '@traces/shared'
import type { ColDef, ColGroupDef } from 'ag-grid-community'
import { FileUp, Highlighter, Plus, Printer, QrCode, RefreshCw, ShieldOff } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ApiError, api } from '@/api'
import { FormGrid, moneyCol } from '@/components/FormGrid'
import { PageHeader, EmptyState } from '@/components/PageHeader'
import { PdfRegionPicker, type Region } from '@/components/PdfRegionPicker'
import { PdfViewer } from '@/components/PdfViewer'
import { NativeSelect } from '@/components/NativeSelect'
import { TypeBadge } from '@/components/TypeBadge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useOfficers } from '@/lib/queries'
import { StatusBadge, type DocStatus } from '@/pages/documents/List'

export type DocProperty = { id: string; propertyNo: string; componentLabel: string | null }
export type DocLine = {
  id: string; lineNo: number; qty: number; unit: string; unitCostCentavos: number; article: string; description: string
  estUsefulLifeYears: number | null; dateAcquired: string | null; category: 'semi' | 'ppe'
  region: Region | null; generatedRegion: Region | null; properties: DocProperty[]
}
export type DocDetail = {
  id: string; type: 'ICS' | 'PAR'; docNo: string; fundCluster: string; issuedDate: string; purpose: string | null
  issuedByOfficerId: string; issuedByPosition: string; receivedByOfficerId: string; receivedByPosition: string
  hasPdf: boolean; status: DocStatus; generatedOutdated: boolean
  files: { generated: { pageCount: number } | null; uploaded: { originalName: string | null; pageCount: number } | null }
  lines: DocLine[]
}
type Kind = 'generated' | 'uploaded'

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

function RemoveSignedDialog({ doc, open, onClose }: { doc: DocDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/documents/${doc.id}/pdf`, { reason: reason.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['document', doc.id] }); qc.invalidateQueries({ queryKey: ['documents'] }); toast.success('Signed copy removed. The entries can be corrected now.'); setReason(''); onClose() },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not remove the signed copy'),
  })
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove the signed copy?</DialogTitle>
          <DialogDescription>
            The file is kept in the archive, never deleted, and the reason is written to the audit log. The entries unlock so they can be corrected;
            then print the form again, have it signed and upload the new scan.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="reason">Why is it being removed?</Label>
          <Textarea id="reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong receiver typed on the form" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Keep the signed copy</Button>
          <Button variant="destructive" disabled={!reason.trim() || remove.isPending} onClick={() => remove.mutate()}>Remove signed copy</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Draw or nudge the highlight box of one line on the PDF being shown. Allowed even when the form is signed.
function HighlightEditor({ doc, kind }: { doc: DocDetail; kind: Kind }) {
  const qc = useQueryClient()
  const [lineId, setLineId] = useState(doc.lines[0]?.id ?? '')
  const line = doc.lines.find((l) => l.id === lineId)
  const value = kind === 'generated' ? line?.generatedRegion ?? null : line?.region ?? null
  const save = useMutation({
    mutationFn: (r: Region | null) => (r
      ? api.put(`/api/lines/${lineId}/region`, { kind, ...r })
      : api.patch(`/api/lines/${lineId}`, { region: null })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['document', doc.id] }); toast.success('Highlight saved') },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the highlight'),
  })
  if (!line) return null
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-3">
      <div className="grid gap-1.5">
        <Label htmlFor="hl-line">Line to highlight</Label>
        <NativeSelect id="hl-line" className="h-9" value={lineId} onChange={(e) => setLineId(e.target.value)}>
          {doc.lines.map((l) => <option key={l.id} value={l.id}>{l.lineNo}. {l.description.split('\n')[0]}</option>)}
        </NativeSelect>
      </div>
      <PdfRegionPicker key={`${kind}-${lineId}`} url={`/api/documents/${doc.id}/pdf?kind=${kind}`} value={value} onChange={(r) => save.mutate(r)} />
    </div>
  )
}

export default function DocumentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const { data: officers = [] } = useOfficers()
  const { data: doc, isLoading, error } = useQuery({ queryKey: ['document', id], queryFn: () => api.get<DocDetail>(`/api/documents/${id}`) })
  const [page, setPage] = useState(1)
  const [shown, setShown] = useState<Kind | null>(null)
  const [highlighting, setHighlighting] = useState(false)
  const [removing, setRemoving] = useState(false)
  const columns = useMemo(() => (doc?.type === 'PAR' ? parColumns : icsColumns), [doc?.type])

  const refresh = () => { qc.invalidateQueries({ queryKey: ['document', id] }); qc.invalidateQueries({ queryKey: ['documents'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }
  const generate = useMutation({
    mutationFn: () => api.post(`/api/documents/${id}/generate`),
    onSuccess: () => { refresh(); toast.success('Form generated. It is ready to print.') },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not generate the form'),
  })
  const upload = useMutation({
    mutationFn: (file: File) => { const body = new FormData(); body.append('pdf', file); return api.put<{ regionsCopied: number }>(`/api/documents/${id}/pdf`, body) },
    onSuccess: (r) => { refresh(); setShown(null); toast.success(r.regionsCopied ? `Signed copy attached. ${r.regionsCopied} highlight boxes were copied from the generated form; check them.` : 'PDF attached. Draw the highlight boxes next.') },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not attach the PDF'),
  })

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading document</p>
  if (error || !doc) {
    return <EmptyState title="Document not found" action={<Link to="/documents" className={buttonVariants()}>Back to ICS and PAR</Link>}>
      It may have been deleted, or the link is wrong.
    </EmptyState>
  }
  const signed = !!doc.files.uploaded
  const kind: Kind | null = shown ?? (doc.files.uploaded ? 'uploaded' : doc.files.generated ? 'generated' : null)
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
        title={<span className="flex flex-wrap items-center gap-3"><TypeBadge type={doc.type} className="h-7 w-12 text-sm" /><span className="figures">{doc.docNo}</span><StatusBadge status={doc.status} /></span>}
        actions={<>
          {doc.files.generated && (
            <a href={`/api/documents/${doc.id}/pdf?kind=generated`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline' })}><Printer /> Print generated</a>
          )}
          {!signed && doc.lines.length > 0 && (
            <Button variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending}><RefreshCw /> {doc.files.generated ? 'Regenerate' : 'Generate form'}</Button>
          )}
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
            <FileUp /> {signed ? 'Replace signed copy' : doc.files.generated ? 'Upload signed copy' : 'Upload existing PDF'}
          </Button>
          {doc.hasPdf && doc.lines.length > 0 && <Button variant="outline" onClick={() => setHighlighting((h) => !h)}><Highlighter /> {highlighting ? 'Hide highlights' : 'Adjust highlights'}</Button>}
          {signed && <Button variant="outline" onClick={() => setRemoving(true)}><ShieldOff /> Remove signed copy</Button>}
          <Link to={`/stickers?documentId=${doc.id}`} className={buttonVariants({ variant: 'outline' })}><QrCode /> Print stickers</Link>
          {!signed && <Link to={`/issue?documentId=${doc.id}`} className={buttonVariants()}><Plus /> Add lines</Link>}
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
      <input ref={fileRef} type="file" accept="application/pdf" className="sr-only" aria-label="Choose the PDF to attach"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate(f) }} />
      {signed && (
        <p role="status" className="mb-4 rounded-md border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
          This form has a signed copy, so its entries are locked. To correct them, remove the signed copy first; the file is archived and the reason is logged.
        </p>
      )}

      {!signed && doc.generatedOutdated && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
          <span>The entries changed after this form was generated. Regenerate it before printing.</span>
          <Button size="sm" variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending}><RefreshCw /> Regenerate now</Button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section aria-labelledby="pdf-title" className="grid content-start gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="pdf-title" className="text-base font-semibold">{kind === 'generated' ? 'Generated form (unsigned)' : kind === 'uploaded' ? 'Signed copy' : 'Form'}</h2>
            {doc.files.generated && doc.files.uploaded && (
              <div role="group" aria-label="Which copy to show" className="inline-flex rounded-lg bg-muted p-0.5 text-sm">
                {(['uploaded', 'generated'] as const).map((k) => (
                  <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setShown(k); setPage(1) }}
                    className={`rounded-md px-3 py-1 ${kind === k ? 'bg-card font-bold text-primary shadow-sm' : 'text-muted-foreground'}`}>{k === 'uploaded' ? 'Signed' : 'Generated'}</button>
                ))}
              </div>
            )}
          </div>
          {kind && !highlighting && <PdfViewer key={kind} url={`/api/documents/${doc.id}/pdf?kind=${kind}`} page={page} onPageChange={setPage} />}
          {kind && highlighting && <HighlightEditor doc={doc} kind={kind} />}
          {!kind && (
            <EmptyState title="No PDF yet" action={doc.lines.length && !signed
              ? <Button onClick={() => generate.mutate()} disabled={generate.isPending}>Generate the form</Button> : undefined}>
              {doc.lines.length ? 'TRACES can generate the form to print, or you can upload an existing PDF.' : 'Add lines first, then generate the form or upload an existing PDF.'}
            </EmptyState>
          )}
        </section>
        <section aria-labelledby="lines-title" className="grid content-start gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="lines-title" className="text-base font-semibold">Lines</h2>
            {doc.lines.length > 0 && <p className="figures text-sm">Total <span className="font-semibold">{formatPeso(total)}</span></p>}
          </div>
          {doc.lines.length ? (
            <>
              <FormGrid<DocLine> columnDefs={columns} rowData={doc.lines} onRowClicked={(l) => navigate(`/lines/${l.id}/edit`)} />
              <p className="text-xs text-muted-foreground">Select a line to {signed ? 'view it' : 'edit it or change its property numbers'}.</p>
            </>
          ) : (
            <EmptyState title="No lines yet" action={<Link to={`/issue?documentId=${doc.id}`} className={buttonVariants()}><Plus /> Add the first lines</Link>}>
              Enter each row of the form once; the property card, registry entry and QR sticker come from it.
            </EmptyState>
          )}
        </section>
      </div>
      <RemoveSignedDialog doc={doc} open={removing} onClose={() => setRemoving(false)} />
    </>
  )
}
