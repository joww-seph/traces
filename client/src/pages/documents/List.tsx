import { useQuery } from '@tanstack/react-query'
import { formatLongDate } from '@traces/shared'
import { FilePlus2, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '@/api'
import { NativeSelect } from '@/components/NativeSelect'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { TypeBadge } from '@/components/TypeBadge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export type DocRow = {
  id: string; type: 'ICS' | 'PAR'; docNo: string; fundCluster: string; issuedDate: string
  receivedByShort: string; pdfPageCount: number | null
}
type Page = { rows: DocRow[]; total: number; page: number; pageSize: number }

export default function Documents() {
  const navigate = useNavigate()
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const qs = new URLSearchParams({ page: String(page), ...(type && { type }), ...(q.trim() && { q: q.trim() }) }).toString()
  const { data, isLoading } = useQuery({ queryKey: ['documents', qs], queryFn: () => api.get<Page>(`/api/documents?${qs}`) })
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const filtered = !!(type || q.trim())

  return (
    <>
      <PageHeader
        title="ICS and PAR"
        description="Signed issuance slips. Open one to see its PDF, add lines and print stickers."
        actions={<Link to="/documents/new" className={buttonVariants()}><FilePlus2 /> New ICS or PAR</Link>}
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
        {data && <span className="ml-auto text-sm text-muted-foreground">{data.total.toLocaleString('en-PH')} {data.total === 1 ? 'document' : 'documents'}</span>}
      </div>

      {data && !data.rows.length ? (
        <EmptyState title={filtered ? 'No documents match' : 'No ICS or PAR yet'}
          action={filtered
            ? <Button variant="outline" onClick={() => { setQ(''); setType('') }}>Clear filters</Button>
            : <Link to="/documents/new" className={buttonVariants()}>Enter the first document</Link>}>
          {filtered ? 'Try another number or show both types.' : 'Upload a signed ICS or PAR to start the records.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-16 pl-5">Type</TableHead><TableHead>Number</TableHead><TableHead>Date issued</TableHead>
                <TableHead>Accountable officer</TableHead><TableHead className="pr-5">Fund cluster</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={5} className="py-6 pl-5 text-muted-foreground">Loading documents</TableCell></TableRow>}
              {data?.rows.map((d) => (
                <TableRow key={d.id} className="cursor-pointer" onClick={() => navigate(`/documents/${d.id}`)}>
                  <TableCell className="pl-5"><TypeBadge type={d.type} /></TableCell>
                  <TableCell className="figures font-medium"><Link to={`/documents/${d.id}`} className="hover:underline">{d.docNo}</Link></TableCell>
                  <TableCell>{formatLongDate(d.issuedDate)}</TableCell>
                  <TableCell>{d.receivedByShort}</TableCell>
                  <TableCell className="pr-5">{d.fundCluster}</TableCell>
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
