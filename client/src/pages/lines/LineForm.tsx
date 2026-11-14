import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatLongDate, isIsoDate, linePatch, nextComponentSuffix, pesoToCentavos } from '@traces/shared'
import { useEffect, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ApiError, api } from '@/api'
import { NativeSelect } from '@/components/NativeSelect'
import { PageHeader } from '@/components/PageHeader'
import { PdfRegionPicker, type Region } from '@/components/PdfRegionPicker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { DocDetail } from '@/pages/documents/Detail'
import { CardPicker } from '@/pages/issue/CardPicker'
import { blankEntry, type Entry } from '@/pages/issue/model'

type Condition = 'serviceable' | 'unserviceable'
type Row = { propertyNo: string; kind: 'main' | 'component'; componentLabel: string; serialNo: string; oldPropertyNo: string; condition: Condition; existing: boolean }
type Values = {
  qty: string; unitCost: string; description: string; estUsefulLifeYears: string; dateAcquired: string; iarNo: string; iarDate: string; properties: Row[]
}
type LineDto = {
  id: string; documentId: string; qty: number; unit: string; article: string; itemDescription: string; unitCostCentavos: number; description: string
  estUsefulLifeYears: number | null; dateAcquired: string | null; iarNo: string | null; iarDate: string | null
  category: 'semi' | 'ppe'; region: Region | null
  properties: { propertyNo: string; componentLabel: string | null; serialNo: string | null; oldPropertyNo: string | null; condition: Condition }[]
}

// form field behind each server-side line field name
const FIELD: Record<string, keyof Values> = {
  qty: 'qty', unitCostCentavos: 'unitCost', description: 'description', estUsefulLifeYears: 'estUsefulLifeYears',
  dateAcquired: 'dateAcquired', iarNo: 'iarNo', iarDate: 'iarDate',
}
const opt = (s: string) => (s.trim() ? s.trim() : undefined)
const toCentavos = (s: string) => { try { return pesoToCentavos(s) } catch { return null } }

// Correct one line of an ICS or PAR (/lines/:lineId/edit). New lines are entered on the issuance form (/issue).
export default function LineForm() {
  const { lineId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const lineQ = useQuery({ queryKey: ['line', lineId], queryFn: () => api.get<LineDto>(`/api/lines/${lineId}`) })
  const docId = lineQ.data?.documentId
  const docQ = useQuery({ queryKey: ['document', docId], enabled: !!docId, queryFn: () => api.get<DocDetail>(`/api/documents/${docId}`) })
  const doc = docQ.data
  const signed = !!doc?.files.uploaded // a signed form's entries are locked (only the highlight box can change)

  const form = useForm<Values>()
  const { register, control, watch, setError, formState: { errors } } = form
  const rows = useFieldArray({ control, name: 'properties' })
  const [region, setRegion] = useState<Region | null>(null)
  const [removed, setRemoved] = useState<string[]>([])
  const [card, setCard] = useState<Entry | null>(null) // set while the card is being changed

  useEffect(() => {
    const l = lineQ.data
    if (!l) return
    form.reset({
      qty: String(l.qty), unitCost: (l.unitCostCentavos / 100).toFixed(2), description: l.description,
      estUsefulLifeYears: l.estUsefulLifeYears?.toString() ?? '', dateAcquired: l.dateAcquired ?? '', iarNo: l.iarNo ?? '', iarDate: l.iarDate ?? '',
      properties: l.properties.map((p) => ({ propertyNo: p.propertyNo, kind: p.componentLabel ? 'component' : 'main', componentLabel: p.componentLabel ?? '', serialNo: p.serialNo ?? '', oldPropertyNo: p.oldPropertyNo ?? '', condition: p.condition, existing: true })),
    })
    setRegion(l.region)
  }, [lineQ.data, form])

  const v = watch()
  const mains = (v.properties ?? []).filter((r) => r.kind === 'main').length
  const qty = Number(v.qty)

  const addComponent = () => {
    const main = (v.properties ?? []).find((r) => r.kind === 'main')?.propertyNo.trim() ?? ''
    const letters = (v.properties ?? []).filter((r) => r.kind === 'component').map((r) => r.propertyNo.slice(main.length))
    rows.append({ propertyNo: main ? `${main}${nextComponentSuffix(letters)}` : '', kind: 'component', componentLabel: '', serialNo: '', oldPropertyNo: '', condition: 'serviceable', existing: false })
  }

  const save = useMutation({
    mutationFn: async ({ body, propPatches = [] }: { body: object; propPatches?: { propertyNo: string; patch: object }[] }) => {
      type Res = { warning?: { message: string } }
      const res = await api.patch<Res>(`/api/lines/${lineId}`, body)
      // serial / label / condition of properties that already existed go through the property endpoint
      for (const p of propPatches) await api.patch(`/api/properties/${encodeURIComponent(p.propertyNo)}`, p.patch)
      return res
    },
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

  const saveRegion = useMutation({
    mutationFn: (r: Region | null) => (r ? api.put(`/api/lines/${lineId}/region`, { kind: 'uploaded', ...r }) : api.patch(`/api/lines/${lineId}`, { region: null })),
    onSuccess: (_d, r) => { setRegion(r); qc.invalidateQueries({ queryKey: ['document', docId] }); toast.success('Highlight saved') },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the highlight'),
  })

  const onSubmit = form.handleSubmit((values) => {
    const unitCostCentavos = toCentavos(values.unitCost)
    if (unitCostCentavos === null) return setError('unitCost', { message: 'Enter an amount like 96450.00' })
    const comp = values.properties.findIndex((r) => r.kind === 'component' && !r.componentLabel.trim())
    if (comp >= 0) return setError(`properties.${comp}.componentLabel`, { message: 'A component needs a label' })

    const props = values.properties.map((r) => ({
      propertyNo: r.propertyNo.trim(), componentLabel: r.kind === 'component' ? r.componentLabel.trim() : undefined,
      serialNo: opt(r.serialNo), oldPropertyNo: opt(r.oldPropertyNo), condition: r.condition,
    }))
    const line = {
      qty: Number(values.qty), unitCostCentavos, description: values.description.trim(),
      estUsefulLifeYears: values.estUsefulLifeYears ? Number(values.estUsefulLifeYears) : undefined,
      dateAcquired: values.dateAcquired, iarNo: opt(values.iarNo), iarDate: opt(values.iarDate),
    }
    let item: object | undefined
    if (card?.cardMode === 'pick' && card.itemId) item = { itemId: card.itemId }
    else if (card?.cardMode === 'new') {
      const c = card.newCard
      if (!c.typeId || !c.article.trim() || !c.model.trim() || !c.unit.trim()) return toast.error('Fill in the new card: type, article, model and unit.')
      item = { new: { propertyTypeId: Number(c.typeId), article: c.article.trim(), description: c.model.trim(), unit: c.unit.trim() } }
    }
    const body = { line, ...(item ? { item } : {}), addProperties: props.filter((_, i) => !values.properties[i].existing), removePropertyNos: removed }
    const parsed = linePatch.safeParse(body)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const [, key] = issue.path
        if (FIELD[String(key)]) setError(FIELD[String(key)], { message: issue.message })
        else toast.error(issue.message)
      }
      return
    }
    const original = lineQ.data!.properties
    const propPatches = values.properties.flatMap((r, i) => {
      const was = r.existing ? original.find((o) => o.propertyNo === r.propertyNo) : undefined
      if (!was) return []
      const patch = {
        ...(opt(r.serialNo) !== (was.serialNo ?? undefined) && { serialNo: opt(r.serialNo) ?? null }),
        ...(opt(r.oldPropertyNo) !== (was.oldPropertyNo ?? undefined) && { oldPropertyNo: opt(r.oldPropertyNo) ?? null }),
        ...(r.kind === 'component' && props[i].componentLabel !== was.componentLabel && { componentLabel: props[i].componentLabel }),
        ...(r.condition !== was.condition && { condition: r.condition }),
      }
      return Object.keys(patch).length ? [{ propertyNo: r.propertyNo, patch }] : []
    })
    save.mutate({ body, propPatches })
  })

  const err = (n: keyof Values) => errors[n] && <p className="text-xs text-destructive">{errors[n]?.message as string}</p>
  const text = (n: keyof Values, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={n}>{label}</Label>
      <Input id={n} aria-invalid={!!errors[n]} disabled={signed} {...register(n as 'qty')} {...props} />
      {err(n)}
      {/* the native date picker follows the browser language; spell the chosen date out so a swapped day/month is caught */}
      {!errors[n] && props.type === 'date' && isIsoDate(String(v[n])) && <p className="text-xs text-muted-foreground">{formatLongDate(String(v[n]))}</p>}
    </div>
  )

  if (lineQ.error) return <p className="text-sm text-destructive">Line not found.</p>
  const l = lineQ.data
  return (
    <>
    <PageHeader
      crumbs={[{ label: 'ICS and PAR', to: '/documents' }, ...(doc ? [{ label: doc.docNo, to: `/documents/${doc.id}` }] : []), { label: 'Edit line' }]}
      title="Edit line"
      description={signed ? 'This form has a signed copy, so its entries are locked. You can still move the highlight box.' : 'Correct what was entered. The card, registry and report follow.'}
    />
    <div className="grid gap-6 xl:grid-cols-2">
      <form onSubmit={onSubmit} className="grid content-start gap-4" noValidate>
        <Card>
          <CardHeader><CardTitle>Item</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1 sm:col-span-2">
              <span className="text-sm text-muted-foreground">Card</span>
              <p className="text-sm font-medium">{l ? `${l.article}, ${l.itemDescription} (${l.unit})` : ' '}</p>
              {!signed && !card && <Button type="button" variant="outline" size="xs" className="justify-self-start" onClick={() => setCard(blankEntry())}>Change card</Button>}
              {card && l && (
                <div className="grid gap-1.5">
                  <CardPicker n={1} entry={card} category={l.category} onChange={(p) => setCard({ ...card, ...p })} />
                  <p className="text-xs text-muted-foreground">Only {l.category === 'ppe' ? 'PC' : 'SPC'} cards fit this line. The new card takes effect when you save.</p>
                  <Button type="button" variant="ghost" size="xs" className="justify-self-start" onClick={() => setCard(null)}>Keep the current card</Button>
                </div>
              )}
            </div>
            {text('qty', 'Quantity', { inputMode: 'numeric' })}
            {text('unitCost', 'Unit cost (₱)', { inputMode: 'decimal', placeholder: '96,450.00' })}
            <div className="grid content-center gap-1">
              <span className="text-sm text-muted-foreground">Category</span>
              <div className="flex items-center gap-2">
                {l ? <Badge>{l.category === 'ppe' ? 'PPE' : 'Semi-expendable'}</Badge> : null}
                <span className="text-xs text-muted-foreground">fixed when the line was created</span>
              </div>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="description">Description as printed on the form</Label>
              <Textarea id="description" rows={5} disabled={signed} aria-invalid={!!errors.description} {...register('description')} />
              {err('description')}
            </div>
            {text('dateAcquired', 'Date acquired', { type: 'date' })}
            {text('estUsefulLifeYears', 'Estimated useful life (years)', { inputMode: 'numeric' })}
            {text('iarNo', 'IAR no. (optional)')}
            {text('iarDate', 'IAR date (optional)', { type: 'date' })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Property numbers</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {rows.fields.map((f, i) => {
              const row = v.properties?.[i]
              const rowErr = errors.properties?.[i]
              return (
                <div key={f.id} className="grid gap-1">
                  <div className="flex gap-2">
                    <Input aria-label={`Property number ${i + 1}`} placeholder="2026-09ICT-0199" readOnly={row?.existing || signed} aria-invalid={!!rowErr?.propertyNo}
                      className={row?.existing ? 'bg-muted' : ''} {...register(`properties.${i}.propertyNo`)} />
                    {row?.kind === 'component' && (
                      <Input aria-label={`Component label ${i + 1}`} placeholder="Label (e.g. Mouse)" disabled={signed} aria-invalid={!!rowErr?.componentLabel}
                        {...register(`properties.${i}.componentLabel`)} />
                    )}
                    <Button type="button" variant="destructive" size="sm" aria-label={`Remove property ${i + 1}`} disabled={rows.fields.length === 1 || signed}
                      onClick={() => { if (row?.existing) setRemoved([...removed, row.propertyNo]); rows.remove(i) }}>Remove</Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input aria-label={`Serial number ${i + 1}`} placeholder="Serial no. (optional)" disabled={signed} className="h-7 min-w-36 flex-1" {...register(`properties.${i}.serialNo`)} />
                    <Input aria-label={`Old property number ${i + 1}`} placeholder="Old P# (optional)" disabled={signed} className="h-7 min-w-36 flex-1" {...register(`properties.${i}.oldPropertyNo`)} />
                    <NativeSelect aria-label={`Condition ${i + 1}`} className="h-7 w-auto" disabled={signed} {...register(`properties.${i}.condition`)}>
                      <option value="serviceable">Serviceable</option><option value="unserviceable">Unserviceable</option>
                    </NativeSelect>
                    {row?.kind === 'main' && <span className="text-xs text-muted-foreground">Main unit</span>}
                  </div>
                  {rowErr?.propertyNo && <p className="text-xs text-destructive">{rowErr.propertyNo.message}</p>}
                  {rowErr?.componentLabel && <p className="text-xs text-destructive">{rowErr.componentLabel.message}</p>}
                </div>
              )
            })}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={signed} onClick={addComponent}>Add component</Button>
              <span className="text-xs text-muted-foreground">To add more units of the same model, use <Link to={doc ? `/issue?documentId=${doc.id}` : '/issue'} className="underline">the issuance form</Link>.</span>
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
            <Button type="button" variant="destructive" disabled={remove.isPending || signed}
              onClick={() => { if (confirm('Delete this line? Its property numbers stay reserved.')) remove.mutate() }}>Delete line</Button>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => navigate(docId ? `/documents/${docId}` : '/documents')}>Cancel</Button>
            <Button type="submit" disabled={save.isPending || !doc || signed}>{save.isPending ? 'Saving' : 'Save line'}</Button>
          </div>
        </div>
      </form>

      <section aria-labelledby="pdf-box" className="grid content-start gap-3 xl:sticky xl:top-6 xl:self-start">
        <h2 id="pdf-box" className="text-base font-semibold">Where this line sits on the signed copy</h2>
        {doc?.files.uploaded
          ? <PdfRegionPicker url={`/api/documents/${doc.id}/pdf?kind=uploaded`} value={region} onChange={(r) => saveRegion.mutate(r)} />
          : <p className="text-sm text-muted-foreground">There is no signed copy yet. The highlight on the generated form is placed by TRACES; once the signed copy is uploaded you can adjust it here.</p>}
      </section>
    </div>
    </>
  )
}
