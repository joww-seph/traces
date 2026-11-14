import { useMutation, useQueryClient } from '@tanstack/react-query'
import { propertyTypeInput } from '@traces/shared'
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
import { usePropertyTypes, type PropertyType } from '@/lib/queries'

function TypeDialog({ type, onClose }: { type: PropertyType | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient()
  const editing = type && type !== 'new' ? type : null
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [shown, setShown] = useState<unknown>(null)
  // reset the fields whenever another type (or "new") is opened
  if (shown !== type) { setShown(type); setCode(editing?.code ?? ''); setName(editing?.name ?? ''); setError('') }

  const save = useMutation({
    mutationFn: (v: { code: string; name: string }) => (editing ? api.patch(`/api/property-types/${editing.id}`, v) : api.post('/api/property-types', v)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['property-types'] }); toast.success(editing ? 'Property type updated' : 'Property type added'); onClose() },
    onError: (e) => setError(e instanceof ApiError && e.status === 409 ? 'That code or name is already used.' : e instanceof ApiError ? e.message : 'Could not save'),
  })
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = propertyTypeInput.safeParse({ code: code.trim().toUpperCase(), name })
    if (!parsed.success) return setError(parsed.error.issues[0].message)
    setError('')
    save.mutate(parsed.data)
  }
  return (
    <Dialog open={type !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit property type' : 'Add property type'}</DialogTitle>
          <DialogDescription>The code is the letters inside property numbers, like ICT in 2026-03ICT-0187. Changing it does not change numbers already issued.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          <div className="grid gap-1.5"><Label htmlFor="t-code">Code</Label><Input id="t-code" className="figures uppercase" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} placeholder="ICT" /></div>
          <div className="grid gap-1.5"><Label htmlFor="t-name">Name</Label><Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Information and Communications Technology Equipment" /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{editing ? 'Save changes' : 'Add type'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function PropertyTypes() {
  const qc = useQueryClient()
  const { data = [], isLoading } = usePropertyTypes()
  const [dialog, setDialog] = useState<PropertyType | 'new' | null>(null)
  const toggle = useMutation({
    mutationFn: (t: PropertyType) => api.patch(`/api/property-types/${t.id}`, { active: !t.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['property-types'] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not update'),
  })
  return (
    <>
      <PageHeader title="Property types" description="The kinds of property from the COA list. The code goes into every property number; the registry and reports are grouped by type."
        actions={<Button onClick={() => setDialog('new')}><Plus /> Add type</Button>} />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50"><TableHead className="pl-5">Code</TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={4} className="py-6 pl-5 text-muted-foreground">Loading property types</TableCell></TableRow>}
            {data.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="figures pl-5 font-medium">{t.code}</TableCell>
                <TableCell>{t.name}</TableCell>
                <TableCell><Badge variant={t.active ? 'default' : 'secondary'}>{t.active ? 'Active' : 'Inactive'}</Badge></TableCell>
                <TableCell className="space-x-1 pr-5 text-right whitespace-nowrap">
                  <Button variant="outline" size="sm" onClick={() => setDialog(t)}>Edit</Button>
                  <Button variant={t.active ? 'destructive' : 'success'} size="sm" onClick={() => toggle.mutate(t)}>{t.active ? 'Deactivate' : 'Reactivate'}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <TypeDialog type={dialog} onClose={() => setDialog(null)} />
    </>
  )
}
