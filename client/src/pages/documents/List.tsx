import { useQuery } from '@tanstack/react-query'
import { formatLongDate } from '@traces/shared'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/NativeSelect'
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

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">ICS / PAR documents</h1>
        <Button render={<Link to="/documents/new" />} nativeButton={false}>New ICS/PAR</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <NativeSelect aria-label="Type" className="w-32" value={type} onChange={(e) => { setType(e.target.value); setPage(1) }}>
          <option value="">All types</option><option value="ICS">ICS</option><option value="PAR">PAR</option>
        </NativeSelect>
        <Input aria-label="Search document number" placeholder="Search number…" className="w-56" value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1) }} />
      </div>
      <div className="overflow-x-auto rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Type</TableHead><TableHead>No.</TableHead><TableHead>Issued</TableHead><TableHead>Received by</TableHead><TableHead>Fund</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {data && !data.rows.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No documents found.</TableCell></TableRow>}
            {data?.rows.map((d) => (
              <TableRow key={d.id} className="cursor-pointer" onClick={() => navigate(`/documents/${d.id}`)}>
                <TableCell>{d.type}</TableCell>
                <TableCell className="font-medium"><Link to={`/documents/${d.id}`} className="hover:underline">{d.docNo}</Link></TableCell>
                <TableCell>{formatLongDate(d.issuedDate)}</TableCell>
                <TableCell>{d.receivedByShort}</TableCell>
                <TableCell>{d.fundCluster}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  )
}
