import { useQuery } from '@tanstack/react-query'
import { formatPeso } from '@traces/shared'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/api'
import { ExportButton } from '@/components/ExportButton'
import { FormGrid } from '@/components/FormGrid'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { registryColumns, type RegistryRow } from '@/lib/propertyView'
import { useSettings } from '@/lib/queries'
import { cn } from '@/lib/utils'

const CATEGORIES = [
  { id: 'semi', label: 'Semi-expendable', note: 'ICS lines under ₱50,000' },
  { id: 'ppe', label: 'Property, plant and equipment', note: 'Lines at or above the threshold' },
] as const

export default function Registry() {
  const navigate = useNavigate()
  const { data: settings } = useSettings()
  const [category, setCategory] = useState<'semi' | 'ppe'>('semi')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const qs = new URLSearchParams({ category, ...(from && { from }), ...(to && { to }) }).toString()
  const { data = [], isLoading } = useQuery({ queryKey: ['registry', qs], queryFn: () => api.get<RegistryRow[]>(`/api/views/registry?${qs}`) })
  const total = data.reduce((s, r) => s + r.amountCentavos, 0)
  const title = category === 'semi' ? 'REGISTRY OF SEMI-EXPENDABLE PROPERTY ISSUED' : (settings?.ppeRegistryTitle ?? 'REGISTRY OF PROPERTY, PLANT AND EQUIPMENT ISSUED')

  return (
    <>
      <PageHeader title="Registry" description="One row per ICS or PAR line, worked out from the lines you entered. Select a row to open its first property."
        actions={<ExportButton path={`/api/exports/${category === 'semi' ? 'regspi' : 'regppe'}?${new URLSearchParams({ ...(from && { from }), ...(to && { to }) })}`} label={category === 'semi' ? 'Export RegSPI' : 'Export registry'} />} />

      <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div role="radiogroup" aria-label="Category" className="inline-flex rounded-lg bg-muted p-1">
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={category === c.id} onClick={() => setCategory(c.id)}
              className={cn('rounded-md px-3.5 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                category === c.id ? 'bg-card font-bold text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <div className="grid gap-1"><label htmlFor="from" className="text-xs text-muted-foreground">Issued from</label><Input id="from" type="date" className="h-9 w-40 bg-card" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="grid gap-1"><label htmlFor="to" className="text-xs text-muted-foreground">Issued to</label><Input id="to" type="date" className="h-9 w-40 bg-card" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo('') }}>Clear dates</Button>}
        </div>
        <p className="figures ml-auto text-sm">{data.length.toLocaleString('en-PH')} {data.length === 1 ? 'line' : 'lines'} · <span className="font-semibold">{formatPeso(total)}</span></p>
      </div>

      <h2 className="mb-3 text-center text-sm font-bold tracking-wide">{title}</h2>
      {!isLoading && !data.length
        ? <EmptyState title="Nothing issued in this category">{from || to ? 'No lines were issued in that period. Clear the dates to see everything.' : 'Add lines to an ICS or PAR and they appear here.'}</EmptyState>
        : <FormGrid<RegistryRow> columnDefs={registryColumns} rowData={data} height={Math.min(680, 170 + data.length * 96)}
            onRowClicked={(r) => navigate(`/properties/${encodeURIComponent(r.propertyNos[0])}`)} />}
    </>
  )
}
