import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accountEmailOf, userCreate } from '@traces/shared'
import { Copy, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'
import { ApiError, api } from '@/api'
import { NativeSelect } from '@/components/NativeSelect'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type User = { id: string; email: string; displayName: string; role: 'supply_admin' | 'superadmin'; active: boolean; mustChangePassword: boolean }
type Form = z.input<typeof userCreate>
type Shown = { who: string; email: string; password: string }

const ROLES = { supply_admin: 'Supply admin', superadmin: 'Superadmin' } as const

function PasswordDialog({ shown, onClose }: { shown: Shown | null; onClose: () => void }) {
  return (
    <Dialog open={!!shown} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Temporary password for {shown?.who}</DialogTitle>
          <DialogDescription>Copy it now. It is shown only once. {shown?.who} must choose a new password at the next sign-in.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="temp-email">Email</Label>
          <Input id="temp-email" readOnly value={shown?.email ?? ''} />
          <Label htmlFor="temp-password">Temporary password</Label>
          <div className="flex gap-2">
            <Input id="temp-password" readOnly value={shown?.password ?? ''} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(shown?.password ?? '').then(() => toast.success('Copied'), () => toast.error('Could not copy. Select the text instead.'))}>
              <Copy /> Copy
            </Button>
          </div>
        </div>
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (s: Shown) => void }) {
  const qc = useQueryClient()
  const form = useForm<Form>({ resolver: zodResolver(userCreate), defaultValues: { displayName: '', role: 'supply_admin' } })
  const { errors } = form.formState
  const name = form.watch('displayName') ?? ''
  const create = useMutation({
    mutationFn: (v: Form) => api.post<{ user: User; temporaryPassword: string }>('/api/admin/users', v),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      form.reset()
      onClose()
      onCreated({ who: r.user.displayName, email: r.user.email, password: r.temporaryPassword })
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not create the account'),
  })
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add user</DialogTitle><DialogDescription>TRACES makes a temporary password and shows it once.</DialogDescription></DialogHeader>
        <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="grid gap-3" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="u-name">Full name</Label>
            <Input id="u-name" aria-invalid={!!errors.displayName} {...form.register('displayName')} />
            {errors.displayName && <p className="text-xs text-destructive">{errors.displayName.message}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="u-email">Email (made from the name)</Label>
            <Input id="u-email" readOnly className="bg-muted" value={name.trim() ? accountEmailOf(name) : ''} placeholder="first initial, middle initial and surname@region1.dost.gov.ph" />
            <p className="text-xs text-muted-foreground">If someone already has this address, a number is added to it.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="u-role">Role</Label>
            <NativeSelect id="u-role" {...form.register('role')}>
              {Object.entries(ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </NativeSelect>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>Add user</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function Users() {
  const qc = useQueryClient()
  const { data = [], isLoading } = useQuery({ queryKey: ['admin-users'], queryFn: () => api.get<User[]>('/api/admin/users') })
  const [creating, setCreating] = useState(false)
  const [shown, setShown] = useState<Shown | null>(null)

  const patch = useMutation({
    mutationFn: ({ u, body }: { u: User; body: Record<string, unknown> }) => api.patch<{ user: User; temporaryPassword?: string }>(`/api/admin/users/${u.id}`, body),
    onSuccess: (r, { u }) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      if (r.temporaryPassword) setShown({ who: u.displayName, email: u.email, password: r.temporaryPassword })
      else toast.success('Saved')
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] }) // put a rejected role change back in the dropdown
      toast.error(e instanceof ApiError ? e.message : 'Could not save')
    },
  })

  return (
    <>
      <PageHeader title="User accounts" description="Who can sign in to TRACES. Deactivating or resetting an account signs that person out at once."
        actions={<Button onClick={() => setCreating(true)}><UserPlus /> Add user</Button>} />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="pl-5">Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="py-6 pl-5 text-muted-foreground">Loading users</TableCell></TableRow>}
            {data.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="pl-5 font-medium">{u.displayName}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell className="w-44">
                  <NativeSelect aria-label={`Role of ${u.displayName}`} value={u.role} onChange={(e) => patch.mutate({ u, body: { role: e.target.value } })}>
                    {Object.entries(ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </NativeSelect>
                </TableCell>
                <TableCell>
                  <Badge variant={u.active ? 'default' : 'secondary'}>{u.active ? 'Active' : 'Inactive'}</Badge>
                  {u.mustChangePassword && <span className="ml-2 text-xs text-muted-foreground">must change password</span>}
                </TableCell>
                <TableCell className="space-x-1 pr-5 text-right whitespace-nowrap">
                  <Button variant="warning" size="sm" aria-label={`Reset password of ${u.displayName}`}
                    onClick={() => confirm(`Reset the password of ${u.displayName}? They are signed out and get a new temporary password.`) && patch.mutate({ u, body: { resetPassword: true } })}>
                    Reset password
                  </Button>
                  <Button variant={u.active ? 'destructive' : 'success'} size="sm" aria-label={`${u.active ? 'Deactivate' : 'Reactivate'} ${u.displayName}`}
                    onClick={() => patch.mutate({ u, body: { active: !u.active } })}>
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <CreateDialog open={creating} onClose={() => setCreating(false)} onCreated={setShown} />
      <PasswordDialog shown={shown} onClose={() => setShown(null)} />
    </>
  )
}
