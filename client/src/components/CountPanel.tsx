import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatLongDate } from '@traces/shared'
import { CheckCircle2, ClipboardCheck, TriangleAlert, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { ApiError, api } from '@/api'
import { Button } from '@/components/ui/button'
import { setActiveCountId, useActiveCountId, type Count, type ScanResult } from '@/lib/counts'

export function CountPanel({ token }: { token: string }) {
  const id = useActiveCountId()
  const qc = useQueryClient()
  const count = useQuery({ queryKey: ['count', id], enabled: !!id, retry: false, queryFn: () => api.get<Count>(`/api/counts/${id}`) })
  const [done, setDone] = useState<ScanResult | null>(null)
  const scan = useMutation({
    mutationFn: (condition: 'serviceable' | 'unserviceable') => api.post<ScanResult>(`/api/counts/${id}/scans`, { token, condition }),
    onSuccess: (r) => { setDone(r); qc.setQueryData(['count', id], r); qc.invalidateQueries({ queryKey: ['counts'] }); qc.invalidateQueries({ queryKey: ['report'] }) },
  })

  const c = count.data
  if (!id || !c) return null
  if (c.closedAt) {
    return (
      <section aria-label="Physical count" className="rounded-xl border bg-card p-4 text-sm">
        <p className="font-medium">The count for {c.officerName} is closed.</p>
        <p className="mt-1 text-muted-foreground">It takes no more scans. Start a new count in Reports.</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setActiveCountId(null)}>Stop counting on this phone</Button>
      </section>
    )
  }
  const err = scan.error instanceof ApiError ? scan.error : null
  return (
    <section aria-label="Physical count" className="rounded-xl border-2 border-primary/40 bg-card p-4">
      <div className="flex items-start gap-3">
        <ClipboardCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Physical count</h2>
          <p className="text-sm text-muted-foreground">
            {c.officerName} · {c.category === 'ppe' ? 'RPCPPE' : 'RPCSP'} as at {formatLongDate(c.asAt)}
          </p>
          <p className="figures mt-1 text-sm" aria-live="polite">{c.counted} of {c.total} counted{c.unserviceable ? ` · ${c.unserviceable} unserviceable` : ''}</p>
        </div>
      </div>

      <p className="mt-3 text-sm font-medium" id="count-q">Is this item serviceable?</p>
      <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-labelledby="count-q">
        <Button size="lg" onClick={() => scan.mutate('serviceable')} disabled={scan.isPending}><CheckCircle2 /> Serviceable</Button>
        <Button size="lg" variant="outline" onClick={() => scan.mutate('unserviceable')} disabled={scan.isPending}><Wrench /> Unserviceable</Button>
      </div>

      {err && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{err.message}{err.code === 'NOT_HOLDER' && (err.details as { holder?: string | null } | undefined)?.holder ? ` It is held by ${(err.details as { holder: string }).holder}.` : ''}</span>
        </p>
      )}
      {done && !err && (
        <p role="status" className="mt-3 rounded-md bg-muted p-2.5 text-sm">
          {done.propertyNo} counted as {done.condition}.
          {done.condition === 'unserviceable' && <> It goes to the {done.category === 'ppe' ? 'IIRUP' : 'IIRUSP'}. </>}
          {' '}Scan the next item with the camera.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <Link to="/reports" className="text-primary hover:underline">Open the report</Link>
        <button type="button" className="text-muted-foreground hover:underline" onClick={() => setActiveCountId(null)}>Stop counting on this phone</button>
      </div>
    </section>
  )
}
