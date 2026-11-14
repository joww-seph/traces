import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '@/api'
import { NativeSelect } from '@/components/NativeSelect'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePropertyTypes } from '@/lib/queries'

type CardRow = {
  id: string; category: 'semi' | 'ppe'; article: string; description: string; unit: string; propertyTypeId: number
  propertyTypeCode: string; active: boolean; balanceQty: number; unitsIssued: number
}

// One card per model. The balance is what the Supply Unit still holds; "issued" is how many units are with officers.
export default function Cards() {
  const navigate = useNavigate()
  const { data: types = [] } = usePropertyTypes()
  const [category, setCategory] = useState('')
  const [typeId, setTypeId] = useState('')
  const [q, setQ] = useState('')
  const qs = new URLSearchParams({ ...(category && { category }), ...(typeId && { typeId }), ...(q.trim() && { q: q.trim() }) }).toString()
  const { data = [], isLoading } = useQuery({ queryKey: ['cards', qs], queryFn: () => api.get<CardRow[]>(`/api/views/cards?${qs}`) })
  const filtered = !!(category || typeId || q.trim())

  return (
    <>
      <PageHeader title="Cards" description="One property card per model. Each issuance of the model is a row on its card." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search cards" placeholder="Search article or model" className="h-9 bg-card pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <NativeSelect aria-label="Category" className="h-9 w-44 bg-card" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">SPC and PC</option><option value="semi">SPC, semi-expendable</option><option value="ppe">PC, PPE</option>
        </NativeSelect>
        <NativeSelect aria-label="Property type" className="h-9 w-56 bg-card" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">All property types</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
        </NativeSelect>
      </div>
      {!isLoading && !data.length ? (
        <EmptyState title={filtered ? 'No cards match' : 'No cards yet'}
          action={filtered ? undefined : <Link to="/issue" className={buttonVariants()}>Enter the first issuance</Link>}>
          {filtered ? 'Try another search or clear the filters.' : 'A card is created with the first issuance of a model.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="pl-5">Article</TableHead><TableHead>Model</TableHead><TableHead>Type</TableHead>
                <TableHead>Card</TableHead><TableHead className="text-right">In stock</TableHead><TableHead className="pr-5 text-right">Units issued</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="py-6 pl-5 text-muted-foreground">Loading cards</TableCell></TableRow>}
              {data.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/cards/${c.id}`)}>
                  <TableCell className="pl-5 font-medium"><Link to={`/cards/${c.id}`} className="hover:underline">{c.article}</Link></TableCell>
                  <TableCell className="whitespace-normal">{c.description}</TableCell>
                  <TableCell>{c.propertyTypeCode}</TableCell>
                  <TableCell><Badge variant="secondary">{c.category === 'semi' ? 'SPC' : 'PC'}</Badge></TableCell>
                  <TableCell className="figures text-right">{c.balanceQty}</TableCell>
                  <TableCell className="figures pr-5 text-right">{c.unitsIssued}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
