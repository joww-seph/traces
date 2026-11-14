import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/api'
import { NativeSelect } from '@/components/NativeSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePropertyTypes, type Card } from '@/lib/queries'
import type { Entry } from '@/pages/issue/model'

// The card of a row: search the existing cards of this row's category, or make a new one inline.
export function CardPicker({ n, entry, category, onChange }: {
  n: number; entry: Entry; category: 'semi' | 'ppe' | null; onChange: (patch: Partial<Entry>) => void
}) {
  const { data: types = [] } = usePropertyTypes()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const results = useQuery({
    queryKey: ['items', q, category],
    enabled: open && entry.cardMode === 'pick',
    queryFn: () => api.get<Card[]>(`/api/items?active=true&q=${encodeURIComponent(q)}${category ? `&category=${category}` : ''}`),
  })

  if (entry.cardMode === 'new') {
    const c = entry.newCard
    const set = (patch: Partial<typeof c>) => onChange({ newCard: { ...c, ...patch } })
    return (
      <div className="grid gap-2 rounded-lg border border-dashed p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">New card</span>
          <Button type="button" variant="ghost" size="xs" onClick={() => onChange({ cardMode: 'pick' })}>Pick an existing card</Button>
        </div>
        <NativeSelect aria-label={`Row ${n}, property type`} className="h-8" value={c.typeId} onChange={(e) => set({ typeId: e.target.value })}>
          <option value="">Property type</option>
          {types.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
        </NativeSelect>
        <Input aria-label={`Row ${n}, article`} className="h-8" placeholder="Article, e.g. Laptop" value={c.article} onChange={(e) => set({ article: e.target.value })} />
        <Input aria-label={`Row ${n}, model`} className="h-8" placeholder="Model, e.g. Lenovo ThinkPad E14 Gen 5" value={c.model} onChange={(e) => set({ model: e.target.value })} />
        <Input aria-label={`Row ${n}, unit`} className="h-8" placeholder="Unit, e.g. unit, set" value={c.unit} onChange={(e) => set({ unit: e.target.value })} />
      </div>
    )
  }

  if (entry.itemId) {
    const wrong = category && entry.itemCategory && category !== entry.itemCategory
    return (
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{entry.itemLabel}</span>
          <Badge variant="secondary">{entry.itemCategory === 'semi' ? 'SPC' : 'PC'}</Badge>
          <Button type="button" variant="ghost" size="xs" onClick={() => onChange({ itemId: '', itemLabel: '', itemCategory: undefined, itemTypeId: undefined })}>Change card</Button>
        </div>
        {wrong && <p role="alert" className="text-xs text-destructive">At this cost the row is {category === 'ppe' ? 'PPE' : 'semi-expendable'}, but this is {entry.itemCategory === 'ppe' ? 'a PC' : 'an SPC'} card. Pick or create a {category === 'ppe' ? 'PC' : 'SPC'} card.</p>}
      </div>
    )
  }

  return (
    <div className="relative grid gap-1.5">
      <Input aria-label={`Row ${n}, search cards`} className="h-8" placeholder="Search article or model" value={q} role="combobox" aria-expanded={open}
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true) }} />
      {open && (
        <ul className="max-h-56 overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-sm" aria-label="Matching cards">
          {results.isLoading && <li className="px-2 py-1.5 text-muted-foreground">Searching</li>}
          {results.data?.map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => { onChange({ itemId: c.id, itemLabel: `${c.article}, ${c.description}`, itemCategory: c.category, itemTypeId: c.propertyTypeId, unit: c.unit }); setOpen(false) }}>
                <span className="font-medium">{c.article}</span>, {c.description} <span className="text-xs text-muted-foreground">({c.propertyTypeCode}, {c.category === 'semi' ? 'SPC' : 'PC'})</span>
              </button>
            </li>
          ))}
          {results.data && !results.data.length && <li className="px-2 py-1.5 text-muted-foreground">No card matches{category ? ` in ${category === 'semi' ? 'SPC' : 'PC'}` : ''}.</li>}
        </ul>
      )}
      <Button type="button" variant="outline" size="xs" className="justify-self-start" onClick={() => { setOpen(false); onChange({ cardMode: 'new' }) }}>New card</Button>
    </div>
  )
}
