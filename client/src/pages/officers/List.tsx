import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { officerInput } from '@traces/shared'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'
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
import { useOfficers, type Officer } from '@/lib/queries'

type Form = Omit<z.input<typeof officerInput>, 'designations' | 'canReceive'> & { canReceive: boolean; designations: string }

function OfficerDialog({ officer, onClose }: { officer: Officer | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient()
  const editing = officer && officer !== 'new' ? officer : null
  // one program or project per line in the form; the API takes a list
  const form = useForm<Form>({
    resolver: zodResolver(officerInput.extend({ designations: z.string() }) as never),
    values: editing
      ? { fullName: editing.fullName, shortName: editing.shortName, position: editing.position, office: editing.office, canReceive: editing.canReceive, designations: editing.designations.join('\n') }
      : { fullName: '', shortName: '', position: '', office: '', canReceive: true, designations: '' },
  })
  const { errors } = form.formState

  const save = useMutation({
    mutationFn: (v: Form) => {
      const body = { ...v, designations: v.designations.split('\n').map((d) => d.trim()).filter(Boolean) }
      return editing ? api.patch(`/api/officers/${editing.id}`, body) : api.post('/api/officers', body)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['officers'] }); toast.success(editing ? 'Officer updated' : 'Officer added'); onClose() },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) form.setError('shortName', { message: 'That short name is already used' })
      else toast.error(e instanceof ApiError ? e.message : 'Could not save')
    },
  })

  const field = (name: 'fullName' | 'shortName' | 'position' | 'office', label: string, hint?: string) => (
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
          {field('shortName', 'Short name', 'Unique label used in the registry, e.g. MSantos')}
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
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{editing ? 'Save changes' : 'Add officer'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function Officers() {
  const qc = useQueryClient()
  const { data = [], isLoading } = useOfficers()
  const [dialog, setDialog] = useState<Officer | 'new' | null>(null)
  const toggle = useMutation({
    mutationFn: (o: Officer) => (o.active ? api.delete(`/api/officers/${o.id}`) : api.patch(`/api/officers/${o.id}`, { active: true })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['officers'] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not update'),
  })

  return (
    <>
      <PageHeader title="Officers"
        description="People who issue or receive property. Their position fills in on new documents, and their short name appears in the registry."
        actions={<Button onClick={() => setDialog('new')}><UserPlus /> Add officer</Button>} />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="pl-5">Short name</TableHead><TableHead>Full name</TableHead><TableHead>Position</TableHead>
              <TableHead>Office</TableHead><TableHead>Receives property</TableHead><TableHead>Status</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="py-6 pl-5 text-muted-foreground">Loading officers</TableCell></TableRow>}
            {!isLoading && !data.length && <TableRow><TableCell colSpan={7} className="py-8 pl-5 text-muted-foreground">No officers yet. Add the Supply Unit staff and the accountable officers who receive property.</TableCell></TableRow>}
            {data.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="pl-5 font-medium">{o.shortName}</TableCell>
                <TableCell>{o.fullName}</TableCell>
                <TableCell>{o.position}</TableCell>
                <TableCell>{o.office}</TableCell>
                <TableCell>{o.canReceive ? 'Yes' : 'No'}</TableCell>
                <TableCell><Badge variant={o.active ? 'default' : 'secondary'}>{o.active ? 'Active' : 'Inactive'}</Badge></TableCell>
                <TableCell className="space-x-1 pr-5 text-right whitespace-nowrap">
                  <Button variant="outline" size="sm" onClick={() => setDialog(o)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => toggle.mutate(o)}>{o.active ? 'Deactivate' : 'Reactivate'}</Button>
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
