import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableRow } from '@/components/ui/table'

export function TableSkeletonRows({ cols, rows = 6, label }: { cols: number; rows?: number; label: string }) {
  return Array.from({ length: rows }, (_, r) => (
    <TableRow key={r} aria-busy="true" className="hover:bg-transparent">
      {Array.from({ length: cols }, (_, c) => (
        <TableCell key={c} className={c === 0 ? 'pl-5' : undefined}>
          {r === 0 && c === 0 && <span className="sr-only">{label}</span>}
          <Skeleton className={`h-4 ${c === 0 ? 'w-28' : c === cols - 1 ? 'ml-auto w-16' : 'w-24'}`} />
        </TableCell>
      ))}
    </TableRow>
  ))
}

export function BlockSkeleton({ label, lines = 6, className = '' }: { label: string; lines?: number; className?: string }) {
  return (
    <div role="status" aria-label={label} className={`grid gap-3 rounded-xl border bg-card p-5 ${className}`}>
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={`h-4 ${i % 3 === 2 ? 'w-2/3' : 'w-full'}`} />)}
    </div>
  )
}

export function PageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="grid gap-6">
      <div className="grid gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 rounded-xl border bg-card p-5 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="grid gap-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-4 w-32 max-w-full" /></div>
        ))}
      </div>
      <div className="grid gap-3 rounded-xl border bg-card p-5">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className={`h-4 ${i % 3 === 2 ? 'w-2/3' : 'w-full'}`} />)}
      </div>
    </div>
  )
}
