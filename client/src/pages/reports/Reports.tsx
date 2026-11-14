import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatLongDate, formatPeso, isIsoDate } from '@traces/shared'
import { Printer, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, api } from '@/api'
import { downloadExport } from '@/components/ExportButton'
import { FormGrid } from '@/components/FormGrid'
import { NativeSelect } from '@/components/NativeSelect'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { reportColumns, type ReportRow } from '@/lib/propertyView'
import { usePropertyTypes, useReceivers, useSettings } from '@/lib/queries'

type Role = 'committee' | 'head_of_agency' | 'coa_representative'
type Signatory = { role: Role; sortOrder: number; name: string; position: string | null }
type Report = {
  officer: { id: string; fullName: string; position: string; office: string }
  category: 'semi' | 'ppe'; type: { id: number; name: string } | null; asAt: string; rows: ReportRow[]; signatories: Signatory[]
}
const ROLES: { role: Role; label: string; caption: string }[] = [
  { role: 'committee', label: 'Certified correct by', caption: 'Inventory Committee Chair and Members, one name per line' },
  { role: 'head_of_agency', label: 'Approved by', caption: 'Head of Agency or Authorized Representative' },
  { role: 'coa_representative', label: 'Witnessed by', caption: 'COA Representative' },
]
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })

// RPCSP / RPCPPE: what an accountable officer holds on a date, to print and count by hand. The count columns stay blank.
export default function Reports() {
  const qc = useQueryClient()
  const { data: settings } = useSettings()
  const { data: types = [] } = usePropertyTypes()
  const [search, setSearch] = useState('')
  const { data: officers = [] } = useReceivers(search, true)
  const [officerId, setOfficerId] = useState('')
  const [category, setCategory] = useState<'semi' | 'ppe'>('ppe')
  const [typeId, setTypeId] = useState('')
  const [asAt, setAsAt] = useState(today())
  const ready = !!officerId && isIsoDate(asAt)
  const qs = new URLSearchParams({ officerId, category, asAt, ...(typeId && { typeId }) }).toString()
  const report = useQuery({ queryKey: ['report', qs], enabled: ready, retry: false, queryFn: () => api.get<Report>(`/api/reports/rpc?${qs}`) })

  // names under the report: editable here, saved only on "Save as default"
  const [names, setNames] = useState<Record<Role, string>>({ committee: '', head_of_agency: '', coa_representative: '' })
  const saved = useQuery({ queryKey: ['report-signatories'], queryFn: () => api.get<Signatory[]>('/api/report-signatories') })
  useEffect(() => {
    if (!saved.data) return
    setNames({
      committee: '', head_of_agency: '', coa_representative: '',
      ...Object.fromEntries(ROLES.map((r) => [r.role, saved.data.filter((s) => s.role === r.role).map((s) => s.name).join('\n')])),
    })
  }, [saved.data])
  const signatories = useMemo(() => ROLES.flatMap(({ role }) =>
    names[role].split('\n').map((n) => n.trim()).filter(Boolean).map((name, i) => ({ role, sortOrder: i + 1, name }))), [names])

  const saveDefault = useMutation({
    mutationFn: () => api.put('/api/report-signatories', signatories),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['report-signatories'] }); toast.success('Saved as the default names') },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save'),
  })

  const exportPath = () => `/api/exports/${category === 'semi' ? 'rpcsp' : 'rpcppe'}?${new URLSearchParams({
    officerId, asAt, ...(typeId && { typeId }), signatories: JSON.stringify(signatories),
  })}`
  const exportIt = async () => { try { toast.success(`Saved ${await downloadExport(exportPath())}`) } catch (e) { toast.error((e as Error).message) } }

  const r = report.data
  const title = category === 'semi' ? 'REPORT ON THE PHYSICAL COUNT OF SEMI-EXPENDABLE PROPERTY' : 'REPORT ON THE PHYSICAL COUNT OF PROPERTY, PLANT AND EQUIPMENT'
  const total = r?.rows.reduce((s, x) => s + x.balancePerCard * x.unitValueCentavos, 0) ?? 0

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Reports" description="The physical count report of one accountable officer: what the cards say they hold on a date. Print it and count by hand; the count columns are left blank."
          actions={<>
            <Button variant="outline" onClick={exportIt} disabled={!r}>Export to Excel</Button>
            <Button onClick={() => window.print()} disabled={!r}><Printer /> Print</Button>
          </>} />

        <div className="mb-5 grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid content-start gap-1.5 sm:col-span-2">
            <Label htmlFor="r-search">Accountable officer</Label>
            <Input id="r-search" placeholder="Search by name or program, e.g. SARAi" className="h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            <NativeSelect id="r-officer" aria-label="Choose the officer" className="h-9" value={officerId} onChange={(e) => setOfficerId(e.target.value)}>
              <option value="">Choose an officer</option>
              {officers.map((o) => <option key={o.id} value={o.id}>{o.fullName} ({o.shortName}){o.active ? '' : ', inactive'}</option>)}
            </NativeSelect>
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="r-category">Report</Label>
            <NativeSelect id="r-category" className="h-9" value={category} onChange={(e) => setCategory(e.target.value as 'semi' | 'ppe')}>
              <option value="ppe">RPCPPE, property, plant and equipment</option><option value="semi">RPCSP, semi-expendable property</option>
            </NativeSelect>
            <Label htmlFor="r-type" className="mt-2">Property type</Label>
            <NativeSelect id="r-type" className="h-9" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">All</option>{types.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
            </NativeSelect>
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="r-asat">As at</Label>
            <Input id="r-asat" type="date" className="h-9" value={asAt} onChange={(e) => setAsAt(e.target.value)} />
            {isIsoDate(asAt) && <p className="text-xs text-muted-foreground">{formatLongDate(asAt)}</p>}
          </div>
        </div>
      </div>

      {!ready && <div className="print:hidden"><EmptyState title="Choose an accountable officer">The report lists the items that officer holds on the chosen date.</EmptyState></div>}
      {ready && report.isLoading && <p className="text-sm text-muted-foreground">Preparing the report</p>}
      {r && (
        <section aria-label={title}>
          <div className="mb-3 text-center">
            <h2 className="text-sm font-bold tracking-wide sm:text-base">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{r.type?.name ?? 'All property types'}</p>
            <p className="text-xs text-muted-foreground">As at {formatLongDate(r.asAt)}</p>
            <p className="text-xs text-muted-foreground">{settings?.entityName} · Fund Cluster: {settings?.defaultFundCluster}</p>
            <p className="text-xs text-muted-foreground">For which {r.officer.fullName}, {r.officer.position}, is accountable, having assumed such accountability on ________</p>
          </div>
          {!r.rows.length
            ? <EmptyState title="Nothing held on that date">This officer holds no {category === 'semi' ? 'semi-expendable' : 'PPE'} items{typeId ? ' of that type' : ''} as at {formatLongDate(r.asAt)}.</EmptyState>
            : <FormGrid<ReportRow> columnDefs={reportColumns} rowData={r.rows} height={r.rows.length > 8 ? 460 : undefined} />}
          {r.rows.length > 0 && <p className="figures mt-2 text-right text-sm">Total value per card <span className="font-semibold">{formatPeso(total)}</span></p>}

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {ROLES.map(({ role, label, caption }) => (
              <div key={role} className="grid content-start gap-1.5">
                <Label htmlFor={`sig-${role}`}>{label}</Label>
                <Textarea id={`sig-${role}`} rows={3} className="print:hidden" value={names[role]} onChange={(e) => setNames({ ...names, [role]: e.target.value })} />
                <div className="hidden min-h-16 border-b border-foreground text-center whitespace-pre-line print:block">{names[role]}</div>
                <p className="text-xs text-muted-foreground">{caption}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 print:hidden">
            <Button variant="outline" size="sm" onClick={() => saveDefault.mutate()} disabled={saveDefault.isPending}><Save /> Save these names as the default</Button>
            <p className="mt-1 text-xs text-muted-foreground">Edits above are used for printing and export only. They are saved for next time only when you save them as the default.</p>
          </div>
        </section>
      )}
    </>
  )
}
