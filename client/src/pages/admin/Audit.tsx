import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { api } from '@/api'
import { NativeSelect } from '@/components/NativeSelect'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Row = {
  id: number; at: string; action: string; entity: string; entityId: string | null
  before: unknown; after: unknown; actor: { id: string; email: string; displayName: string } | null
}
type Page = { rows: Row[]; nextBefore: number | null }
type User = { id: string; displayName: string }

const ENTITIES = ['users', 'officers', 'documents', 'lines', 'properties', 'items', 'property_types', 'report_signatories', 'exports', 'settings']

export default function Audit() {
  const [f, setF] = useState({ entity: '', actorId: '', from: '', to: '' })
  const [open, setOpen] = useState<number | null>(null)
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api.get<User[]>('/api/admin/users') })
  const log = useInfiniteQuery({
    queryKey: ['audit', f], initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams()
      for (const [k, v] of Object.entries({ ...f, before: pageParam ?? '' })) if (v !== '') q.set(k, String(v))
      return api.get<Page>(`/api/admin/audit-logs?${q}`)
    },
    getNextPageParam: (p) => p.nextBefore ?? undefined,
  })
  const rows = log.data?.pages.flatMap((p) => p.rows) ?? []
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  return (
    <>
      <PageHeader title="Audit log" description="Every change to the records, newest first. Entries cannot be edited." />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div className="grid gap-1.5"><Label htmlFor="a-entity">Record type</Label>
          <NativeSelect id="a-entity" value={f.entity} onChange={set('entity')}><option value="">All</option>{ENTITIES.map((e) => <option key={e}>{e}</option>)}</NativeSelect></div>
        <div className="grid gap-1.5"><Label htmlFor="a-actor">Done by</Label>
          <NativeSelect id="a-actor" value={f.actorId} onChange={set('actorId')}><option value="">Anyone</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</NativeSelect></div>
        <div className="grid gap-1.5"><Label htmlFor="a-from">From</Label><Input id="a-from" type="date" value={f.from} onChange={set('from')} /></div>
        <div className="grid gap-1.5"><Label htmlFor="a-to">To</Label><Input id="a-to" type="date" value={f.to} onChange={set('to')} /></div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50"><TableHead className="pl-5">When</TableHead><TableHead>Who</TableHead><TableHead>Action</TableHead><TableHead>Record</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {log.isLoading && <TableRow><TableCell colSpan={5} className="py-6 pl-5 text-muted-foreground">Loading the log</TableCell></TableRow>}
            {!log.isLoading && !rows.length && <TableRow><TableCell colSpan={5} className="py-8 pl-5 text-muted-foreground">No entries match these filters.</TableCell></TableRow>}
            {rows.map((r) => (
              <Fragment key={r.id}>
                <TableRow>
                  <TableCell className="pl-5 whitespace-nowrap">{new Date(r.at).toLocaleString()}</TableCell>
                  <TableCell>{r.actor?.displayName ?? 'System'}</TableCell>
                  <TableCell className="font-medium">{r.action}</TableCell>
                  <TableCell className="text-muted-foreground">{r.entity}{r.entityId ? ` ${String(r.entityId).slice(0, 8)}` : ''}</TableCell>
                  <TableCell className="pr-5 text-right">
                    {(r.before || r.after) ? <Button variant="ghost" size="sm" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Details'}</Button> : null}
                  </TableCell>
                </TableRow>
                {open === r.id && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="bg-muted/30 px-5 py-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        {(['before', 'after'] as const).map((k) => (
                          <div key={k}><p className="mb-1 text-xs font-medium text-muted-foreground">{k === 'before' ? 'Before' : 'After'}</p>
                            <pre tabIndex={0} aria-label={`${k === 'before' ? 'Before' : 'After'} values`} className="max-h-64 overflow-auto rounded-md bg-background p-2 text-xs whitespace-pre-wrap">{r[k] ? JSON.stringify(r[k], null, 2) : 'None'}</pre></div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      {log.hasNextPage && <div className="mt-4 text-center"><Button variant="outline" onClick={() => log.fetchNextPage()} disabled={log.isFetchingNextPage}>Load more</Button></div>}
    </>
  )
}
