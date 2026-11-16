import { useMutation, useQueryClient } from '@tanstack/react-query'
import { unitInput } from '@traces/shared'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ApiError, api } from '@/api'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useUnits, type Unit } from '@/lib/queries'
import { TableSkeletonRows } from '@/components/Loading'

function UnitDialog({ unit, onClose }: { unit: Unit | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient()
  const editing = unit && unit !== 'new' ? unit : null
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [shown, setShown] = useState<unknown>(null)
  // reset the fields whenever another unit (or "new") is opened
  if (shown !== unit) { setShown(unit); setCode(editing?.code ?? ''); setName(editing?.name ?? ''); setError('') }

  const save = useMutation({
    mutationFn: (v: { code: string; name: string }) => (editing ? api.patch(`/api/units/${editing.code}`, { name: v.name }) : api.post('/api/units', v)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['units'] }); toast.success(editing ? 'Office unit updated' : 'Office unit added'); onClose() },
    onError: (e) => setError(e instanceof ApiError && e.status === 409 ? 'That code is already used.' : e instanceof ApiError ? e.message : 'Could not save'),
  })
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = unitInput.safeParse({ code: code.trim(), name })
    if (!parsed.success) return setError(parsed.error.issues[0].message)
    setError('')
    save.mutate(parsed.data)
  }
  return (
    <Dialog open={unit !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit office unit' : 'Add office unit'}</DialogTitle>
          <DialogDescription>The code goes inside ICS and PAR numbers, like SARAi in 2026-11SARAi-001. It cannot be changed later, because issued numbers carry it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          <div className="grid gap-1.5"><Label htmlFor="u-code">Code</Label><Input id="u-code" className="figures" maxLength={12} value={code} disabled={!!editing} onChange={(e) => setCode(e.target.value)} placeholder="SARAi" /></div>
          <div className="grid gap-1.5"><Label htmlFor="u-name">Name</Label><Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Smarter Approaches to Reinvigorate Agriculture as an Industry" /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{editing ? 'Save changes' : 'Add unit'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function Units() {
  const qc = useQueryClient()
  const { data = [], isLoading } = useUnits()
  const [dialog, setDialog] = useState<Unit | 'new' | null>(null)
  const toggle = useMutation({
    mutationFn: (u: Unit) => api.patch(`/api/units/${u.code}`, { active: !u.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['units'] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not update'),
  })
  return (
    <>
      <PageHeader title="Office units" description="The units whose code goes inside ICS and PAR numbers."
        actions={<Button onClick={() => setDialog('new')}><Plus /> Add unit</Button>} />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50"><TableHead className="pl-5">Code</TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableSkeletonRows cols={4} label="Loading office units" />}
            {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No office units yet. Add the first one.</TableCell></TableRow>}
            {data.map((u) => (
              <TableRow key={u.code}>
                <TableCell className="figures pl-5 font-medium">{u.code}</TableCell>
                <TableCell>{u.name}</TableCell>
                <TableCell><Badge variant={u.active ? 'default' : 'secondary'}>{u.active ? 'Active' : 'Inactive'}</Badge></TableCell>
                <TableCell className="space-x-1 pr-5 text-right whitespace-nowrap">
                  <Button variant="outline" size="sm" onClick={() => setDialog(u)}>Edit</Button>
                  <Button variant={u.active ? 'destructive' : 'success'} size="sm" onClick={() => toggle.mutate(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <UnitDialog unit={dialog} onClose={() => setDialog(null)} />
    </>
  )
}
