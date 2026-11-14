import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { officerInput, shortNameOf } from '@traces/shared'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ApiError, api } from '@/api'
import { UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { type Officer } from '@/lib/queries'

type Form = Omit<z.input<typeof officerInput>, 'designations' | 'canReceive'> & { canReceive: boolean; designations: string }

function OfficerDialog({ officer, onClose }: { officer: Officer | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient()
  const editing = officer && officer !== 'new' ? officer : null
  // one program or project per line in the form; the API takes a list
  const form = useForm<Form>({
    resolver: zodResolver(officerInput.extend({ designations: z.string() }) as never),
    values: editing
      ? { fullName: editing.fullName, position: editing.position, office: editing.office, canReceive: editing.canReceive, designations: editing.designations.join('\n') }
      : { fullName: '', position: '', office: '', canReceive: true, designations: '' },
  })
  const { errors } = form.formState
  const fullName = form.watch('fullName') ?? ''

  const save = useMutation({
    mutationFn: (v: Form) => {
      const body = { ...v, designations: v.designations.split('\n').map((d) => d.trim()).filter(Boolean) }
      return editing ? api.patch(`/api/officers/${editing.id}`, body) : api.post('/api/officers', body)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['officers'] }); toast.success(editing ? 'Officer updated' : 'Officer added'); onClose() },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Could not save')
    },
  })

  const field = (name: 'fullName' | 'position' | 'office', label: string, hint?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`o-${name}`}>{label}</Label>
      <Input id={`o-${name}`} aria-invalid={!!errors[name]} {...form.register(name)} />
      {hint && !errors[name] && <p className="text-xs text-muted-foreground">{hint}</p>}
      {errors[name] && <p className="text-xs text-destructive">{errors[name]?.message}</p>}
    </div>
  )

  return (
    <Dialog open={officer !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? 'Edit officer' : 'Add officer'}</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-3" noValidate>
          {field('fullName', 'Full name')}
          <p id="o-shortName" className="-mt-1 text-xs text-muted-foreground">Short name: <span className="font-medium text-foreground">{fullName.trim() ? shortNameOf(fullName) : '—'}</span> (made from the name: initials, middle initial and surname)</p>
          {field('position', 'Position / designation')}
          {field('office', 'Office')}
          <div className="grid gap-1.5">
            <Label htmlFor="o-designations">Programs and projects (one per line)</Label>
            <Textarea id="o-designations" rows={3} placeholder={'SARAi CENTRO, Focal Person'} {...form.register('designations')} />
            <p className="text-xs text-muted-foreground">Searching for a program in the officer lists finds this person.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" {...form.register('canReceive')} /> Can receive property (appears under “Received by” and in reports)
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{editing ? 'Save changes' : 'Add officer'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function Officers() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const { data = [], isLoading } = useQuery({ queryKey: ['officers', 'list', q], queryFn: () => api.get<Officer[]>(`/api/officers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`) })
  const [dialog, setDialog] = useState<Officer | 'new' | null>(null)
  const toggle = useMutation({
    mutationFn: (o: Officer) => (o.active ? api.delete(`/api/officers/${o.id}`) : api.patch(`/api/officers/${o.id}`, { active: true })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['officers'] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not update'),
  })

  return (
    <>
      <PageHeader title="Officers"
        description="People who issue or receive property. Their position fills in on new documents. The short name is made from the full name."
        actions={<Button onClick={() => setDialog('new')}><UserPlus /> Add officer</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input aria-label="Search officers" placeholder="Search by name or program, e.g. SARAi" className="h-9 w-full bg-card sm:w-80" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="ml-auto text-sm text-muted-foreground">{data.length} {data.length === 1 ? 'officer' : 'officers'}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="pl-5">Name</TableHead><TableHead>Position</TableHead>
              <TableHead>Office</TableHead><TableHead>Receives property</TableHead><TableHead>Status</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="py-6 pl-5 text-muted-foreground">Loading officers</TableCell></TableRow>}
            {!isLoading && !data.length && <TableRow><TableCell colSpan={6} className="py-8 pl-5 text-muted-foreground">No officers yet. Add the Supply Unit staff and the accountable officers who receive property.</TableCell></TableRow>}
            {data.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="pl-5"><span className="font-medium">{o.fullName}</span><span className="block text-xs text-muted-foreground">{o.shortName}</span></TableCell>
                <TableCell className="min-w-56 whitespace-normal">{o.position}{o.designations.some((d) => d !== o.position) && <span className="block text-xs text-muted-foreground">{o.designations.filter((d) => d !== o.position).join('; ')}</span>}</TableCell>
                <TableCell>{o.office}</TableCell>
                <TableCell>{o.canReceive ? 'Yes' : 'No'}</TableCell>
                <TableCell><Badge variant={o.active ? 'default' : 'secondary'}>{o.active ? 'Active' : 'Inactive'}</Badge></TableCell>
                <TableCell className="space-x-1 pr-5 text-right whitespace-nowrap">
                  <Button variant="outline" size="sm" onClick={() => setDialog(o)}>Edit</Button>
                  <Button variant={o.active ? 'destructive' : 'success'} size="sm" onClick={() => toggle.mutate(o)}>{o.active ? 'Deactivate' : 'Reactivate'}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <OfficerDialog officer={dialog} onClose={() => setDialog(null)} />
    </>
  )
}
