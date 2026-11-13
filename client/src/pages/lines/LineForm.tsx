import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { categorize, lineInput, nextInSequence, pesoToCentavos } from '@traces/shared'
import { useEffect, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ApiError, api } from '@/api'
import { PdfRegionPicker, type Region } from '@/components/PdfRegionPicker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSettings } from '@/lib/queries'
import type { DocDetail } from '@/pages/documents/Detail'

type Row = { propertyNo: string; kind: 'main' | 'component'; componentLabel: string; existing: boolean }
type Values = {
  qty: string; unit: string; unitCost: string; article: string; description: string
  estUsefulLifeYears: string; dateAcquired: string; iarNo: string; iarDate: string; properties: Row[]
}
type LineDto = {
  id: string; documentId: string; qty: number; unit: string; unitCostCentavos: number; article: string; description: string
  estUsefulLifeYears: number | null; dateAcquired: string | null; iarNo: string | null; iarDate: string | null
  category: 'semi' | 'ppe'; region: Region | null
  properties: { propertyNo: string; componentLabel: string | null }[]
}

const EMPTY: Values = {
  qty: '1', unit: '', unitCost: '', article: '', description: '', estUsefulLifeYears: '', dateAcquired: '', iarNo: '', iarDate: '',
  properties: [{ propertyNo: '', kind: 'main', componentLabel: '', existing: false }],
}
// form field behind each server-side line field name
const FIELD: Record<string, keyof Values> = {
  qty: 'qty', unit: 'unit', unitCostCentavos: 'unitCost', article: 'article', description: 'description',
  estUsefulLifeYears: 'estUsefulLifeYears', dateAcquired: 'dateAcquired', iarNo: 'iarNo', iarDate: 'iarDate',
}
const opt = (s: string) => (s.trim() ? s.trim() : undefined)
const toCentavos = (s: string) => { try { return pesoToCentavos(s) } catch { return null } }

// One form for "add line" (/documents/:id/lines/new) and "edit line" (/lines/:lineId/edit).
export default function LineForm() {
  const { id: docParam, lineId } = useParams()
  const editing = !!lineId
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: settings } = useSettings()

  const lineQ = useQuery({ queryKey: ['line', lineId], enabled: editing, queryFn: () => api.get<LineDto>(`/api/lines/${lineId}`) })
  const docId = editing ? lineQ.data?.documentId : docParam
  const docQ = useQuery({ queryKey: ['document', docId], enabled: !!docId, queryFn: () => api.get<DocDetail>(`/api/documents/${docId}`) })
  const doc = docQ.data

  const form = useForm<Values>({ defaultValues: EMPTY })
  const { register, control, watch, setError, formState: { errors } } = form
  const rows = useFieldArray({ control, name: 'properties' })
  const [region, setRegion] = useState<Region | null>(null)
  const [removed, setRemoved] = useState<string[]>([])
  const [units, setUnits] = useState('1')

  // load the line being edited
  useEffect(() => {
    const l = lineQ.data
    if (!l) return
    form.reset({
      qty: String(l.qty), unit: l.unit, unitCost: (l.unitCostCentavos / 100).toFixed(2), article: l.article, description: l.description,
      estUsefulLifeYears: l.estUsefulLifeYears?.toString() ?? '', dateAcquired: l.dateAcquired ?? '', iarNo: l.iarNo ?? '', iarDate: l.iarDate ?? '',
      properties: l.properties.map((p) => ({ propertyNo: p.propertyNo, kind: p.componentLabel ? 'component' : 'main', componentLabel: p.componentLabel ?? '', existing: true })),
    })
    setRegion(l.region)
  }, [lineQ.data, form])

  const v = watch()
  const cost = toCentavos(v.unitCost)
  const category = editing ? lineQ.data?.category : cost !== null && settings ? categorize(cost, settings.ppeThresholdCentavos) : undefined
  const mismatch = doc && category && ((doc.type === 'ICS') === (category === 'ppe'))
  const mains = v.properties.filter((r) => r.kind === 'main').length
  const qty = Number(v.qty)

  const addUnits = () => {
    const n = Math.min(Math.max(parseInt(units, 10) || 1, 1), 200)
    const last = [...v.properties].reverse().find((r) => r.kind === 'main' && r.propertyNo.trim())
    let no = last?.propertyNo.trim() ?? ''
    for (let i = 0; i < n; i++) {
      if (no) { try { no = nextInSequence(no) } catch { no = '' } }
      rows.append({ propertyNo: no, kind: 'main', componentLabel: '', existing: false })
    }
  }

  const save = useMutation({
    mutationFn: (body: object) => (editing ? api.patch<{ warning?: { message: string } }>(`/api/lines/${lineId}`, body) : api.post<{ warning?: { message: string } }>(`/api/documents/${docId}/lines`, body)),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['document', docId] })
      qc.invalidateQueries({ queryKey: ['line', lineId] })
      if (res.warning) toast.warning(res.warning.message, { duration: 8000 }); else toast.success('Line saved')
      navigate(`/documents/${docId}`)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'DUPLICATE_PROPERTY_NO') {
        const dup = String((e.details as { propertyNo?: string })?.propertyNo ?? '').toUpperCase()
        const i = v.properties.findIndex((r) => r.propertyNo.trim().toUpperCase() === dup)
        if (i >= 0) setError(`properties.${i}.propertyNo`, { message: e.message })
        toast.error(e.message)
      } else if (e instanceof ApiError && e.code === 'VALIDATION') toast.error('Please check the highlighted fields')
      else toast.error(e instanceof ApiError ? e.message : 'Could not save')
    },
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/lines/${lineId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['document', docId] }); toast.success('Line deleted'); navigate(`/documents/${docId}`) },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not delete'),
  })

  const onSubmit = form.handleSubmit((values) => {
    const isIcs = doc?.type !== 'PAR'
    const unitCostCentavos = toCentavos(values.unitCost)
    if (unitCostCentavos === null) return setError('unitCost', { message: 'Enter an amount like 96450.00' })
    const comp = values.properties.findIndex((r) => r.kind === 'component' && !r.componentLabel.trim())
    if (comp >= 0) return setError(`properties.${comp}.componentLabel`, { message: 'A component needs a label' })

    const props = values.properties.map((r) => ({ propertyNo: r.propertyNo.trim(), componentLabel: r.kind === 'component' ? r.componentLabel.trim() : undefined }))
    const line = {
      qty: Number(values.qty), unit: values.unit.trim(), unitCostCentavos, article: values.article.trim(), description: values.description.trim(),
      estUsefulLifeYears: isIcs && values.estUsefulLifeYears ? Number(values.estUsefulLifeYears) : undefined,
      dateAcquired: !isIcs ? opt(values.dateAcquired) : undefined, iarNo: opt(values.iarNo), iarDate: opt(values.iarDate),
    }
    const parsed = lineInput.safeParse({ line, region: region ?? undefined, properties: props.length ? props : [] })
    // edit mode may legitimately leave only existing rows; validate the whole set the same way
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const [head, key, sub] = issue.path
        if (head === 'line' && FIELD[String(key)]) setError(FIELD[String(key)], { message: issue.message })
        else if (head === 'properties' && typeof key === 'number') setError(`properties.${key}.${sub === 'componentLabel' ? 'componentLabel' : 'propertyNo'}`, { message: issue.message })
        else toast.error(issue.message)
      }
      return
    }
    if (!editing) return save.mutate(parsed.data)
    save.mutate({
      line, region,
      addProperties: props.filter((_, i) => !values.properties[i].existing),
      removePropertyNos: removed,
    })
  })

  const err = (n: keyof Values) => errors[n] && <p className="text-xs text-destructive">{errors[n]?.message as string}</p>
  const text = (n: keyof Values, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={n}>{label}</Label>
      <Input id={n} aria-invalid={!!errors[n]} {...register(n as 'qty')} {...props} />
      {err(n)}
    </div>
  )

  if (editing && lineQ.error) return <p className="text-sm text-destructive">Line not found.</p>
  const title = `${editing ? 'Edit' : 'Add'} line${doc ? ` — ${doc.type} ${doc.docNo}` : ''}`

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form onSubmit={onSubmit} className="grid content-start gap-4" noValidate>
        <Card>
          <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {text('qty', 'Quantity', { inputMode: 'numeric' })}
            {text('unit', 'Unit', { placeholder: 'set, unit, pc' })}
            {text('unitCost', 'Unit cost (₱)', { inputMode: 'decimal', placeholder: '96,450.00' })}
            <div className="grid content-center gap-1">
              <span className="text-sm text-muted-foreground">Category</span>
              <div className="flex items-center gap-2">
                {category ? <Badge>{category === 'ppe' ? 'PPE' : 'Semi-expendable'}</Badge> : <span className="text-sm text-muted-foreground">—</span>}
                {editing && <span className="text-xs text-muted-foreground">fixed when the line was created</span>}
              </div>
            </div>
            {mismatch && (
              <p role="status" className="rounded-md bg-amber-100 p-2 text-sm text-amber-900 sm:col-span-2">
                {doc?.type === 'ICS' ? 'This cost is PPE level — normally a PAR, not an ICS.' : 'This cost is below the PPE threshold — normally an ICS, not a PAR.'} You can still save.
              </p>
            )}
            <div className="sm:col-span-2">{text('article', 'Article')}</div>
            <div className="sm:col-span-2">{text('description', 'Description')}</div>
            {doc?.type === 'PAR' ? text('dateAcquired', 'Date acquired', { type: 'date' }) : text('estUsefulLifeYears', 'Estimated useful life (years)', { inputMode: 'numeric' })}
            <div />
            {text('iarNo', 'IAR no. (optional)')}
            {text('iarDate', 'IAR date (optional)', { type: 'date' })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Property numbers</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {rows.fields.map((f, i) => {
              const row = v.properties[i]
              const rowErr = errors.properties?.[i]
              return (
                <div key={f.id} className="grid gap-1">
                  <div className="flex gap-2">
                    <Input aria-label={`Property number ${i + 1}`} placeholder="2026-09ICT-0199" readOnly={row?.existing} aria-invalid={!!rowErr?.propertyNo}
                      className={row?.existing ? 'bg-muted' : ''} {...register(`properties.${i}.propertyNo`)} />
                    {row?.kind === 'component' && (
                      <Input aria-label={`Component label ${i + 1}`} placeholder="Label (e.g. Mouse)" readOnly={row.existing} aria-invalid={!!rowErr?.componentLabel}
                        {...register(`properties.${i}.componentLabel`)} />
                    )}
                    <Button type="button" variant="ghost" size="sm" aria-label={`Remove property ${i + 1}`} disabled={rows.fields.length === 1}
                      onClick={() => { if (row?.existing) setRemoved([...removed, row.propertyNo]); rows.remove(i) }}>Remove</Button>
                  </div>
                  {row?.kind === 'main' && <p className="text-xs text-muted-foreground">Main unit</p>}
                  {rowErr?.propertyNo && <p className="text-xs text-destructive">{rowErr.propertyNo.message}</p>}
                  {rowErr?.componentLabel && <p className="text-xs text-destructive">{rowErr.componentLabel.message}</p>}
                </div>
              )
            })}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => rows.append({ propertyNo: '', kind: 'component', componentLabel: '', existing: false })}>Add component</Button>
              <span className="text-xs text-muted-foreground">or add</span>
              <Input aria-label="Number of units" className="h-7 w-16" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} />
              <Button type="button" variant="outline" size="sm" onClick={addUnits}>units in sequence</Button>
            </div>
            {Number.isInteger(qty) && qty > 0 && mains !== qty && (
              <p role="status" className="text-sm text-amber-700">
                Quantity is {qty} but there {mains === 1 ? 'is' : 'are'} {mains} main unit{mains === 1 ? '' : 's'}. Components don't count.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap justify-between gap-2">
          <div>
            {editing && <Button type="button" variant="destructive" disabled={remove.isPending}
              onClick={() => { if (confirm('Delete this line? Its property numbers stay reserved.')) remove.mutate() }}>Delete line</Button>}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => navigate(docId ? `/documents/${docId}` : '/documents')}>Cancel</Button>
            <Button type="submit" disabled={save.isPending || !doc}>{save.isPending ? 'Saving…' : 'Save line'}</Button>
          </div>
        </div>
      </form>

      <div className="lg:sticky lg:top-16 lg:self-start">
        {doc?.hasPdf ? <PdfRegionPicker url={`/api/documents/${doc.id}/pdf`} value={region} onChange={setRegion} />
          : <p className="text-sm text-muted-foreground">Loading document…</p>}
      </div>
    </div>
  )
}
