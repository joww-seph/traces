import { useQuery } from '@tanstack/react-query'
import { formatLongDate } from '@traces/shared'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '@/api'
import { NativeSelect } from '@/components/NativeSelect'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePropertyTypes } from '@/lib/queries'
import { TableSkeletonRows } from '@/components/Loading'

type CardRow = {
  id: string; propertyNo: string; serialNo: string | null; category: 'semi' | 'ppe'; article: string; description: string; unit: string
  propertyTypeCode: string; documentId: string; docType: 'ICS' | 'PAR'; docNo: string; issuedDate: string; holder: string | null
}
const PAGE = 20

export default function Cards() {
  const navigate = useNavigate()
  const { data: types = [] } = usePropertyTypes()
  const [category, setCategory] = useState('')
  const [typeId, setTypeId] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const qs = new URLSearchParams({ ...(category && { category }), ...(typeId && { typeId }), ...(q.trim() && { q: q.trim() }) }).toString()
  const { data = [], isLoading } = useQuery({ queryKey: ['cards', qs], queryFn: () => api.get<CardRow[]>(`/api/views/cards?${qs}`) })
  const filtered = !!(category || typeId || q.trim())
  const pages = Math.max(1, Math.ceil(data.length / PAGE))
  const at = Math.min(page, pages)
  const shown = data.slice((at - 1) * PAGE, at * PAGE)
  const filter = (f: () => void) => { f(); setPage(1) }

  return (
    <>
      <PageHeader title="Cards" description="One property card per property number." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search cards" placeholder="Property no., serial, description or officer" className="h-9 bg-card pl-9" value={q} onChange={(e) => filter(() => setQ(e.target.value))} />
        </div>
        <NativeSelect aria-label="Category" className="h-9 w-44 bg-card" value={category} onChange={(e) => filter(() => setCategory(e.target.value))}>
          <option value="">SPC and PC</option><option value="semi">SPC, semi-expendable</option><option value="ppe">PC, PPE</option>
        </NativeSelect>
        <NativeSelect aria-label="Property type" className="h-9 w-56 bg-card" value={typeId} onChange={(e) => filter(() => setTypeId(e.target.value))}>
          <option value="">All property types</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
        </NativeSelect>
      </div>
      {!isLoading && !data.length ? (
        <EmptyState title={filtered ? 'No cards match' : 'No cards yet'}
          action={filtered ? undefined : <Link to="/issue" className={buttonVariants()}>Enter the first issuance</Link>}>
          {filtered ? 'Try another search or clear the filters.' : 'Every property gets its card when it is issued.'}
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="pl-5">Property No.</TableHead><TableHead>Article</TableHead><TableHead>Description</TableHead>
                  <TableHead>Card</TableHead><TableHead className="pr-5">ICS/PAR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableSkeletonRows cols={5} label="Loading cards" />}
                {shown.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/cards/${c.id}`)}>
                    <TableCell className="figures pl-5 font-medium"><Link to={`/cards/${c.id}`} className="hover:underline">{c.propertyNo}</Link></TableCell>
                    <TableCell>{c.article}</TableCell>
                    <TableCell className="whitespace-pre-line">{c.description}{`\n(S/N: ${c.serialNo ?? 'N/A'})`}</TableCell>
                    <TableCell><Badge variant="secondary">{c.category === 'semi' ? 'SPC' : 'PC'}</Badge> <span className="text-xs text-muted-foreground">{c.propertyTypeCode}</span></TableCell>
                    <TableCell className="figures pr-5"><Link to={`/documents/${c.documentId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{c.docType} {c.docNo}</Link>
                      <span className="block text-xs text-muted-foreground">{formatLongDate(c.issuedDate)}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {pages > 1 && (
            <nav aria-label="Pages" className="mt-3 flex items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={at <= 1} onClick={() => setPage(at - 1)}>Previous</Button>
              <span>Page {at} of {pages}</span>
              <Button variant="outline" size="sm" disabled={at >= pages} onClick={() => setPage(at + 1)}>Next</Button>
            </nav>
          )}
        </>
      )}
    </>
  )
}
