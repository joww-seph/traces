import { useQuery } from '@tanstack/react-query'
import { formatLongDate } from '@traces/shared'
import { FilePlus2, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '@/api'
import { NativeSelect } from '@/components/NativeSelect'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { TypeBadge } from '@/components/TypeBadge'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export type DocStatus = 'none' | 'generated' | 'signed'
export const STATUS_LABEL: Record<DocStatus, string> = { none: 'No PDF', generated: 'Generated, unsigned', signed: 'Signed' }

export function StatusBadge({ status }: { status: DocStatus }) {
  return <Badge variant={status === 'signed' ? 'default' : 'secondary'}>{STATUS_LABEL[status]}</Badge>
}

export type DocRow = {
  id: string; type: 'ICS' | 'PAR'; docNo: string; fundCluster: string; issuedDate: string
  receivedByName: string; status: DocStatus
}
type Page = { rows: DocRow[]; total: number; page: number; pageSize: number }

export default function Documents() {
  const navigate = useNavigate()
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState(new URLSearchParams(location.search).get('status') ?? '')
  const [page, setPage] = useState(1)
  const qs = new URLSearchParams({ page: String(page), ...(type && { type }), ...(status && { status }), ...(q.trim() && { q: q.trim() }) }).toString()
  const { data, isLoading } = useQuery({ queryKey: ['documents', qs], queryFn: () => api.get<Page>(`/api/documents?${qs}`) })
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const filtered = !!(type || status || q.trim())

  return (
    <>
      <PageHeader
        title="ICS and PAR"
        description="Issuance slips and receipts. Open one to print it, attach the signed copy or print stickers."
        actions={<Link to="/issue" className={buttonVariants()}><FilePlus2 /> New issuance</Link>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search by document number" placeholder="Search by number" className="h-9 bg-card pl-9" value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        </div>
        <NativeSelect aria-label="Document type" className="h-9 w-40 bg-card" value={type} onChange={(e) => { setType(e.target.value); setPage(1) }}>
          <option value="">ICS and PAR</option><option value="ICS">ICS only</option><option value="PAR">PAR only</option>
        </NativeSelect>
        <NativeSelect aria-label="Signed copy" className="h-9 w-52 bg-card" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">Any status</option><option value="unsigned">No signed copy yet</option>
          <option value="none">No PDF</option><option value="generated">Generated, unsigned</option><option value="signed">Signed</option>
        </NativeSelect>
        {data && <span className="ml-auto text-sm text-muted-foreground">{data.total.toLocaleString('en-PH')} {data.total === 1 ? 'document' : 'documents'}</span>}
      </div>

      {data && !data.rows.length ? (
        <EmptyState title={filtered ? 'No documents match' : 'No ICS or PAR yet'}
          action={filtered
            ? <Button variant="outline" onClick={() => { setQ(''); setType(''); setStatus('') }}>Clear filters</Button>
            : <Link to="/issue" className={buttonVariants()}>Enter the first issuance</Link>}>
          {filtered ? 'Try another number or show both types.' : 'Enter an issuance and TRACES creates the ICS or PAR for you.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-16 pl-5">Type</TableHead><TableHead>Number</TableHead><TableHead>Date issued</TableHead>
                <TableHead>Accountable officer</TableHead><TableHead>Fund cluster</TableHead><TableHead className="pr-5">PDF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="py-6 pl-5 text-muted-foreground">Loading documents</TableCell></TableRow>}
              {data?.rows.map((d) => (
                <TableRow key={d.id} className="cursor-pointer" onClick={() => navigate(`/documents/${d.id}`)}>
                  <TableCell className="pl-5"><TypeBadge type={d.type} /></TableCell>
                  <TableCell className="figures font-medium"><Link to={`/documents/${d.id}`} className="hover:underline">{d.docNo}</Link></TableCell>
                  <TableCell>{formatLongDate(d.issuedDate)}</TableCell>
                  <TableCell>{d.receivedByName}</TableCell>
                  <TableCell>{d.fundCluster}</TableCell>
                  <TableCell className="pr-5"><StatusBadge status={d.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="px-2 text-muted-foreground">Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </nav>
      )}
    </>
  )
}
