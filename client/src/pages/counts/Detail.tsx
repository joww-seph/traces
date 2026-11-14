import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatLongDate, formatPeso, isIsoDate } from '@traces/shared'
import { Lock, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { ApiError, api } from '@/api'
import { ExportButton } from '@/components/ExportButton'
import { FormGrid } from '@/components/FormGrid'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { countColumns, type CountRow } from '@/lib/propertyView'
import { Progress } from './List'

type Signatory = { role: 'committee' | 'head_of_agency' | 'coa_representative'; name: string; position: string | null }
type Count = {
  id: string; category: 'semi' | 'ppe'; typeLabel: string; asAt: string; fundCluster: string; officerName: string; officerShortName: string
  officerPosition: string; assumptionDate: string | null; status: 'open' | 'closed'; closedAt: string | null
  signatories: (Signatory & { sortOrder: number })[]; progress: { total: number; counted: number }; rows: CountRow[]
}

const ROLES: { role: Signatory['role']; label: string; many: boolean }[] = [
  { role: 'committee', label: 'Certified correct by: Inventory Committee Chair and Members', many: true },
  { role: 'head_of_agency', label: 'Approved by: Head of Agency/Entity or Authorized Representative', many: false },
  { role: 'coa_representative', label: 'Verified by: COA Representative', many: false },
]

function HeaderForm({ count }: { count: Count }) {
  const qc = useQueryClient()
  const [typeLabel, setTypeLabel] = useState(count.typeLabel)
  const [asAt, setAsAt] = useState(count.asAt)
  const [position, setPosition] = useState(count.officerPosition)
  const [assumption, setAssumption] = useState(count.assumptionDate ?? '')
  const [fund, setFund] = useState(count.fundCluster)
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: () => api.patch(`/api/counts/${count.id}`, {
      typeLabel: typeLabel.trim(), asAt, officerPosition: position.trim(), fundCluster: fund.trim(), ...(assumption ? { assumptionDate: assumption } : {}),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['count', count.id] }); qc.invalidateQueries({ queryKey: ['counts'] }); toast.success('Count details saved') },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save'),
  })
  const field = (id: string, label: string, input: React.ReactNode, hint?: string) => (
    <div className="grid content-start gap-1.5"><Label htmlFor={id}>{label}</Label>{input}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
  )
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!isIsoDate(asAt)) return setError('Pick the date this count is as at.'); setError(''); save.mutate() }}
      className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      {field('typeLabel', 'What is counted', <Input id="typeLabel" value={typeLabel} onChange={(e) => setTypeLabel(e.target.value)} />)}
      {field('asAt', 'As at', <Input id="asAt" type="date" value={asAt} onChange={(e) => setAsAt(e.target.value)} />, isIsoDate(asAt) ? formatLongDate(asAt) : undefined)}
      {field('fund', 'Fund cluster', <Input id="fund" value={fund} onChange={(e) => setFund(e.target.value)} />)}
      {field('position', 'Officer position as printed', <Input id="position" value={position} onChange={(e) => setPosition(e.target.value)} />)}
      {field('assumption', 'Date of assumption', <Input id="assumption" type="date" value={assumption} onChange={(e) => setAssumption(e.target.value)} />, isIsoDate(assumption) ? formatLongDate(assumption) : 'When the officer took over this accountability')}
      <div className="flex items-end gap-3">
        <Button type="submit" disabled={save.isPending}>Save details</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </form>
  )
}

function SignatoriesForm({ count }: { count: Count }) {
  const qc = useQueryClient()
  const [list, setList] = useState<Signatory[]>(count.signatories.map(({ role, name, position }) => ({ role, name, position })))
  useEffect(() => { setList(count.signatories.map(({ role, name, position }) => ({ role, name, position }))) }, [count.signatories])
  const save = useMutation({
    mutationFn: () => api.patch(`/api/counts/${count.id}`, { signatories: list.filter((s) => s.name.trim()).map((s) => ({ ...s, name: s.name.trim(), position: s.position?.trim() || undefined })) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['count', count.id] }); toast.success('Signatories saved') },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save'),
  })
  const set = (i: number, patch: Partial<Signatory>) => setList(list.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  return (
    <div className="grid gap-5 rounded-xl border bg-card p-4">
      {ROLES.map(({ role, label, many }) => {
        const rows = list.map((s, i) => ({ s, i })).filter((x) => x.s.role === role)
        return (
          <fieldset key={role} className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{label}</legend>
            {rows.map(({ s, i }, n) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input aria-label={`${label} name ${n + 1}`} placeholder="Printed name" className="h-9 min-w-48 flex-1" value={s.name} onChange={(e) => set(i, { name: e.target.value })} />
                <Input aria-label={`${label} position ${n + 1}`} placeholder="Position (optional)" className="h-9 min-w-48 flex-1" value={s.position ?? ''} onChange={(e) => set(i, { position: e.target.value })} />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${s.name || 'signatory'}`} onClick={() => setList(list.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            ))}
            {(many || !rows.length) && (
              <div><Button type="button" variant="outline" size="sm" onClick={() => setList([...list, { role, name: '', position: null }])}><Plus /> {many ? 'Add a member' : 'Add'}</Button></div>
            )}
          </fieldset>
        )
      })}
      <div><Button onClick={() => save.mutate()} disabled={save.isPending}>Save signatories</Button></div>
    </div>
  )
}

export default function CountDetail() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const [confirmClose, setConfirmClose] = useState(false)
  const { data: count, isLoading, error } = useQuery({ queryKey: ['count', id], retry: false, queryFn: () => api.get<Count>(`/api/counts/${id}`) })

  const edit = useMutation({
    mutationFn: (v: { no: string; body: object }) => api.patch(`/api/counts/${id}/items/${encodeURIComponent(v.no)}`, v.body),
    onSettled: () => qc.invalidateQueries({ queryKey: ['count', id] }), // shortage and overage are worked out on the server
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save that entry'),
  })
  const refresh = useMutation({
    mutationFn: () => api.post<{ added: number }>(`/api/counts/${id}/refresh`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['count', id] }); qc.invalidateQueries({ queryKey: ['counts'] })
      toast.success(r.added ? `${r.added} new ${r.added === 1 ? 'item' : 'items'} added` : 'Nothing new to add')
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not refresh'),
  })
  const close = useMutation({
    mutationFn: () => api.patch(`/api/counts/${id}`, { status: 'closed' }),
    onSuccess: () => { setConfirmClose(false); qc.invalidateQueries({ queryKey: ['count', id] }); qc.invalidateQueries({ queryKey: ['counts'] }); toast.success('Count closed') },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not close the count'),
  })

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading count</p>
  if (error || !count) return <EmptyState title="Count not found" action={<Link to="/counts" className={buttonVariants()}>Back to counts</Link>}>It may have been mistyped.</EmptyState>

  const open = count.status === 'open'
  const short = count.rows.reduce((s, r) => s + Math.min(0, r.shortageOverageValueCentavos ?? 0), 0)
  const over = count.rows.reduce((s, r) => s + Math.max(0, r.shortageOverageValueCentavos ?? 0), 0)
  const uncounted = count.progress.total - count.progress.counted
  const title = count.category === 'ppe' ? 'RPCPPE' : 'RPCSP'

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Physical counts', to: '/counts' }, { label: `${count.officerShortName}, ${formatLongDate(count.asAt)}` }]}
        title={<span className="flex flex-wrap items-center gap-3">{title}<Badge variant={open ? 'default' : 'secondary'}>{open ? 'Open' : 'Closed'}</Badge></span>}
        description={`${count.typeLabel} · ${count.officerName}, ${count.officerPosition} · as at ${formatLongDate(count.asAt)}`}
        actions={(
          <>
            <ExportButton path={`/api/exports/${count.category === 'ppe' ? 'rpcppe' : 'rpcsp'}?countId=${count.id}`} label={`Export ${title}`} />
            {open && <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}><RefreshCw /> Add new holdings</Button>}
            {open && <Button onClick={() => setConfirmClose(true)}><Lock /> Close count</Button>}
          </>
        )}
      />

      <div className="grid gap-5 [&>*]:min-w-0">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border bg-card p-4 sm:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Counted</dt><dd className="mt-1"><Progress done={count.progress.counted} total={count.progress.total} /></dd></div>
          <div><dt className="text-xs text-muted-foreground">Shortage</dt><dd className="figures mt-0.5 text-sm font-semibold">{formatPeso(Math.abs(short))}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Overage</dt><dd className="figures mt-0.5 text-sm font-semibold">{formatPeso(over)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Fund cluster</dt><dd className="mt-0.5 text-sm font-medium">{count.fundCluster}</dd></div>
        </dl>

        {open && (
          <>
            <section aria-label="Count details"><HeaderForm count={count} /></section>
            <section aria-label="Signatories"><SignatoriesForm count={count} /></section>
          </>
        )}

        <section aria-label="Items">
          <p className="mb-3 text-sm text-muted-foreground">
            {open ? 'Type the quantity found in the shaded On Hand column; leave it blank if the item was not checked yet. Shortage and overage update by themselves.'
              : `Closed ${count.closedAt ? formatLongDate(count.closedAt.slice(0, 10)) : ''}. A closed count is final.`}
          </p>
          {count.rows.length ? (
            <FormGrid<CountRow> columnDefs={countColumns(open)} rowData={count.rows} height={Math.min(640, 170 + count.rows.length * 64)}
              onCellEdit={open ? (row, field, value) => {
                if (field === 'qtyOnHand') edit.mutate({ no: row.propertyNo, body: { qtyOnHand: value } })
                if (field === 'ownRemarks') edit.mutate({ no: row.propertyNo, body: { remarks: String(value ?? '').trim() || null } })
              } : undefined} />
          ) : (
            <EmptyState title="No items in this count">This officer holds nothing in this category yet. Items appear after an ICS or PAR is entered for them; then use “Add new holdings”.</EmptyState>
          )}
        </section>
      </div>

      <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close this count?</DialogTitle>
            <DialogDescription>
              A closed count cannot be changed or re-opened.
              {uncounted > 0 && ` ${uncounted} ${uncounted === 1 ? 'item has' : 'items have'} no quantity yet; their on hand and shortage stay blank on the report.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClose(false)}>Keep counting</Button>
            <Button onClick={() => close.mutate()} disabled={close.isPending}>Close the count</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
