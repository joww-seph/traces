import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatLongDate, isIsoDate } from '@traces/shared'
import { ClipboardPlus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ApiError, api } from '@/api'
import { NativeSelect } from '@/components/NativeSelect'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useOfficers, useSettings } from '@/lib/queries'

export type CountSummary = {
  id: string; category: 'semi' | 'ppe'; typeLabel: string; asAt: string; status: 'open' | 'closed'
  officerShortName: string; officerName: string; progress: { total: number; counted: number }
}

const CATEGORY = { semi: 'Semi-expendable', ppe: 'Property, plant and equipment' } as const

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${done} of ${total} counted`}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="figures text-sm text-muted-foreground">{done} of {total}</span>
    </div>
  )
}

function NewCountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: officers = [] } = useOfficers(true)
  const { data: settings } = useSettings()
  const [category, setCategory] = useState<'semi' | 'ppe'>('ppe')
  const [typeLabel, setTypeLabel] = useState('')
  const [asAt, setAsAt] = useState('')
  const [officerId, setOfficerId] = useState('')
  const [error, setError] = useState('')
  const officer = officers.find((o) => o.id === officerId)

  const create = useMutation({
    mutationFn: () => api.post<{ id: string; added: number }>('/api/counts', {
      category, typeLabel: typeLabel.trim(), asAt, fundCluster: settings?.defaultFundCluster ?? 'RAF', officerId,
    }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['counts'] })
      toast.success(c.added ? `Count created with ${c.added} ${c.added === 1 ? 'item' : 'items'}` : 'Count created. This officer holds no items in that category yet.')
      onClose()
      navigate(`/counts/${c.id}`)
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create the count'),
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!officerId) return setError('Choose the accountable officer.')
    if (!typeLabel.trim()) return setError('Say what is being counted, for example "ICT Equipment".')
    if (!isIsoDate(asAt)) return setError('Pick the date the count is as at.')
    setError('')
    create.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New physical count</DialogTitle>
          <DialogDescription>The count starts with every item the officer holds in that category. You can add late arrivals later.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="c-category">Property type</Label>
            <NativeSelect id="c-category" className="h-9" value={category} onChange={(e) => setCategory(e.target.value as 'semi' | 'ppe')}>
              <option value="semi">{CATEGORY.semi} (RPCSP)</option><option value="ppe">{CATEGORY.ppe} (RPCPPE)</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-officer">Accountable officer</Label>
            <NativeSelect id="c-officer" className="h-9" value={officerId} onChange={(e) => setOfficerId(e.target.value)}>
              <option value="">Choose an officer</option>
              {officers.map((o) => <option key={o.id} value={o.id}>{o.fullName} ({o.shortName})</option>)}
            </NativeSelect>
            {officer && <p className="text-xs text-muted-foreground">Printed as: {officer.position}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-type">What is counted</Label>
            <Input id="c-type" placeholder="ICT Equipment" value={typeLabel} onChange={(e) => setTypeLabel(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-asat">As at</Label>
            <Input id="c-asat" type="date" value={asAt} onChange={(e) => setAsAt(e.target.value)} />
            {isIsoDate(asAt) && <p className="text-xs text-muted-foreground">{formatLongDate(asAt)}</p>}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>Create count</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function Counts() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { data = [], isLoading } = useQuery({ queryKey: ['counts'], queryFn: () => api.get<CountSummary[]>('/api/counts') })

  return (
    <>
      <PageHeader title="Physical counts"
        description="A count compares what the cards say an officer holds with what is really there. The report is worked out from the count."
        actions={<Button onClick={() => setOpen(true)}><ClipboardPlus /> New count</Button>} />
      {!isLoading && !data.length ? (
        <EmptyState title="No counts yet" action={<Button onClick={() => setOpen(true)}>Start the first count</Button>}>
          Pick an accountable officer and a date. Their items fill in, and you enter how many are on hand.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="pl-5">As at</TableHead><TableHead>Accountable officer</TableHead><TableHead>Type</TableHead>
                <TableHead>Counted</TableHead><TableHead className="pr-5">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={5} className="py-6 pl-5 text-muted-foreground">Loading counts</TableCell></TableRow>}
              {data.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/counts/${c.id}`)}>
                  <TableCell className="pl-5 font-medium"><Link to={`/counts/${c.id}`} className="hover:underline">{formatLongDate(c.asAt)}</Link></TableCell>
                  <TableCell>{c.officerName}</TableCell>
                  <TableCell>{c.category === 'ppe' ? 'RPCPPE' : 'RPCSP'} · {c.typeLabel}</TableCell>
                  <TableCell><Progress done={c.progress.counted} total={c.progress.total} /></TableCell>
                  <TableCell className="pr-5"><Badge variant={c.status === 'open' ? 'default' : 'secondary'}>{c.status === 'open' ? 'Open' : 'Closed'}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <NewCountDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
