import { useQuery } from '@tanstack/react-query'
import { formatLongDate, isIsoDate } from '@traces/shared'
import { FileDown } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api'
import { downloadExport } from '@/components/ExportButton'
import { FormGrid } from '@/components/FormGrid'
import { BlockSkeleton } from '@/components/Loading'
import { NativeSelect } from '@/components/NativeSelect'
import { OfficerPicker } from '@/components/OfficerPicker'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ROWS_PER_SHEET, unserviceableColumns, type UnserviceableRow } from '@/lib/propertyView'
import { usePropertyTypes, useReceivers } from '@/lib/queries'

type Unserviceable = { officer: { fullName: string }; category: 'semi' | 'ppe'; asAt: string; rows: UnserviceableRow[] }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })

// IIRUP (PPE, Appendix 74) / IIRUSP (semi-expendable): the unserviceable items an accountable officer holds, found by a physical count
// (decision 2026-11-19). Accumulated depreciation, impairment and the disposal columns are not stored, so the Excel form prints them blank.
export default function UnserviceablePage() {
  const navigate = useNavigate()
  const { data: types = [] } = usePropertyTypes()
  const { data: officers = [] } = useReceivers('', true)
  const [officerId, setOfficerId] = useState('')
  const [category, setCategory] = useState<'semi' | 'ppe'>('ppe')
  const [typeId, setTypeId] = useState('')
  const [asAt, setAsAt] = useState(today())
  const ready = !!officerId && isIsoDate(asAt)
  const qs = new URLSearchParams({ officerId, category, asAt, ...(typeId && { typeId }) }).toString()
  const q = useQuery({ queryKey: ['unserviceable', qs], enabled: ready, retry: false, queryFn: () => api.get<Unserviceable>(`/api/reports/unserviceable?${qs}`) })
  const u = q.data
  const form = category === 'semi' ? 'IIRUSP' : 'IIRUP'
  const exportIt = async () => { try { toast.success(`Saved ${await downloadExport(`/api/exports/${form.toLowerCase()}?${qs}`)}`) } catch (e) { toast.error((e as Error).message) } }

  return (
    <>
      <PageHeader title="Unserviceable property" description="Items marked unserviceable during a physical count, for inspection and disposal."
        actions={<Button variant="outline" onClick={exportIt} disabled={!u?.rows.length}><FileDown /> Export {form} to Excel</Button>} />

      <div className="mb-5 grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid content-start gap-1.5 sm:col-span-2">
          <Label htmlFor="u-officer">Accountable officer</Label>
          <OfficerPicker id="u-officer" officers={officers} value={officerId} onChange={(o) => setOfficerId(o?.id ?? '')} />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="u-category">Report</Label>
          <NativeSelect id="u-category" className="h-9" value={category} onChange={(e) => setCategory(e.target.value as 'semi' | 'ppe')}>
            <option value="ppe">IIRUP, property, plant and equipment</option><option value="semi">IIRUSP, semi-expendable property</option>
          </NativeSelect>
          <Label htmlFor="u-type" className="mt-2">Property type</Label>
          <NativeSelect id="u-type" className="h-9" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">All</option>{types.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
          </NativeSelect>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="u-asat">As at</Label>
          <Input id="u-asat" type="date" className="h-9" value={asAt} onChange={(e) => setAsAt(e.target.value)} />
          {isIsoDate(asAt) && <p className="text-xs text-muted-foreground">{formatLongDate(asAt)}</p>}
        </div>
      </div>

      {!ready && <EmptyState title="Choose an accountable officer">The list shows the unserviceable items that officer holds on the chosen date.</EmptyState>}
      {ready && q.isLoading && <BlockSkeleton label="Preparing the list" lines={6} />}
      {u && (
        <section aria-label={`${form}, unserviceable property`}>
          {!u.rows.length
            ? <EmptyState title="Nothing unserviceable">{u.officer.fullName} holds no unserviceable {category === 'semi' ? 'semi-expendable' : 'PPE'} items{typeId ? ' of that type' : ''} as at {formatLongDate(u.asAt)}. Items are added here when a physical count marks them unserviceable.</EmptyState>
            : <FormGrid<UnserviceableRow> fullscreenTitle={form} columnDefs={unserviceableColumns} rowData={u.rows} pageSize={ROWS_PER_SHEET}
                onRowClicked={(row) => row.documentId && navigate(`/documents/${row.documentId}`)} />}
          <p className="mt-2 text-xs text-muted-foreground">Accumulated depreciation, impairment, carrying amount and the disposal columns print blank on the {form}.</p>
        </section>
      )}
    </>
  )
}
