import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatLongDate, formatPeso, isIsoDate, issuanceInput, lineInput, parseSeries } from '@traces/shared'
import { Copy, ExternalLink, FilePlus2, Plus, Printer, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { ApiError, api } from '@/api'
import { FormSection } from '@/components/FormSection'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { TypeBadge } from '@/components/TypeBadge'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useOfficers, usePropertyTypes, useReceivers, useSettings, useUnits } from '@/lib/queries'
import type { DocDetail } from '@/pages/documents/Detail'
import { articleOf, blankEntry, categoryOf, centavosOf, duplicate, isBlank, NO_SERIAL, numbersOf, parCountOf, slotsOf, unitOf, withQty, type Entry } from '@/pages/issue/model'
import { PageSkeleton } from '@/components/Loading'
import { OfficerPicker } from '@/components/OfficerPicker'
import { NativeSelect } from '@/components/NativeSelect'

type Header = {
  receivedBy: string; receivedByPosition: string; issuedBy: string; issuedByPosition: string
  issuedDate: string; fundCluster: string; purpose: string; unit: string; icsNo: string; parNos: string[]
}
type Result = { documents: { id: string; type: 'ICS' | 'PAR'; docNo: string; lineIds: string[] }[]; warnings: string[]; generated?: boolean }
type RowErrors = Record<number, string[]>

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
const DRAFT_KEY = 'traces:draft:issue'

function readDraft(key: string): { entries: Entry[]; header: Partial<Header> } | null {
  try {
    const raw = localStorage.getItem(key)
    const d = raw && JSON.parse(raw)
    return d && Array.isArray(d.entries) && d.entries.length && d.entries.every((e: Partial<Entry>) => typeof e.article === 'string' && Array.isArray(e.mains)) ? d : null
  } catch { return null }
}

export default function IssueForm() {
  const [params] = useSearchParams()
  const documentId = params.get('documentId')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const draftKey = documentId ? `${DRAFT_KEY}:${documentId}` : DRAFT_KEY
  const { data: settings } = useSettings()
  const { data: types = [] } = usePropertyTypes()
  const { data: units = [] } = useUnits()
  const { data: allOfficers = [] } = useOfficers(true)
  const { data: receivers = [] } = useReceivers()

  const doc = useQuery({ queryKey: ['document', documentId], enabled: !!documentId, queryFn: () => api.get<DocDetail>(`/api/documents/${documentId}`) })

  const [draft, setDraft] = useState(() => readDraft(draftKey))
  const [entries, setEntries] = useState<Entry[]>(() => draft?.entries ?? [blankEntry()])
  const [header, setHeader] = useState<Header>(() => ({
    receivedBy: '', receivedByPosition: '', issuedBy: '', issuedByPosition: '', issuedDate: today(), fundCluster: '', purpose: '', unit: '', icsNo: '', parNos: [], ...draft?.header,
  }))
  const [errors, setErrors] = useState<RowErrors>({})
  const [headerError, setHeaderError] = useState<{ ics?: string; par?: string; receiver?: string; general?: string }>({})
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    if (!settings) return
    setHeader((h) => {
      const fundCluster = h.fundCluster || settings.defaultFundCluster
      const issuerId = settings.defaultIssuedByOfficerId
      const issuer = !h.issuedBy && issuerId
        ? { issuedBy: issuerId, issuedByPosition: h.issuedByPosition || (allOfficers.find((o) => o.id === issuerId)?.position ?? '') }
        : { issuedBy: h.issuedBy, issuedByPosition: h.issuedByPosition }
      return fundCluster === h.fundCluster && issuer.issuedBy === h.issuedBy && issuer.issuedByPosition === h.issuedByPosition ? h : { ...h, fundCluster, ...issuer }
    })
  }, [settings, allOfficers])

  const threshold = settings?.ppeThresholdCentavos
  const parCount = parCountOf(entries, threshold)

  type DocNos = { icsNo: string; parNos: string[] }
  const nextDocNos = useQuery({
    queryKey: ['next-doc-no', header.issuedDate, header.unit, parCount], enabled: !documentId && !!header.unit && isIsoDate(header.issuedDate), staleTime: 15_000,
    queryFn: () => api.get<DocNos>(`/api/document-numbers/next?issuedDate=${header.issuedDate}&unit=${encodeURIComponent(header.unit)}&parCount=${parCount}`),
  })
  const suggestedNos = useRef<DocNos | null>(null)
  useEffect(() => {
    const s = nextDocNos.data
    if (!s) return
    const prev = suggestedNos.current
    suggestedNos.current = s
    setHeader((h) => ({
      ...h, icsNo: !h.icsNo || h.icsNo === prev?.icsNo ? s.icsNo : h.icsNo,
      parNos: s.parNos.map((no, k) => (!h.parNos[k] || h.parNos[k] === prev?.parNos[k] ? no : h.parNos[k])),
    }))
  }, [nextDocNos.data])
  useEffect(() => { setHeader((h) => (h.parNos.length === parCount ? h : { ...h, parNos: Array.from({ length: parCount }, (_, k) => h.parNos[k] ?? '') })) }, [parCount])
  const isSuggested = (h: Header) => (!h.icsNo || h.icsNo === suggestedNos.current?.icsNo) && h.parNos.every((no, k) => !no || no === suggestedNos.current?.parNos[k])

  useEffect(() => {
    if (result) return
    const blank = entries.length === 1 && isBlank(entries[0]) && isSuggested(header) && !header.purpose && !header.receivedBy
    const t = setTimeout(() => {
      try { if (blank) localStorage.removeItem(draftKey); else localStorage.setItem(draftKey, JSON.stringify({ entries, header })) } catch { }
    }, 400)
    return () => clearTimeout(t)
  }, [entries, header, draftKey, result]) // eslint-disable-line react-hooks/exhaustive-deps
  const clearDraft = () => { try { localStorage.removeItem(draftKey) } catch { } }
  const discardDraft = () => {
    clearDraft()
    setDraft(null)
    setEntries([blankEntry()])
    setErrors({})
    setHeaderError({})
    const issuerId = settings?.defaultIssuedByOfficerId ?? ''
    setHeader({
      receivedBy: '', receivedByPosition: '', issuedDate: today(), fundCluster: settings?.defaultFundCluster ?? '', purpose: '', unit: '', icsNo: '', parNos: [],
      issuedBy: issuerId, issuedByPosition: allOfficers.find((o) => o.id === issuerId)?.position ?? '',
    })
    toast.success('Draft discarded')
  }

  const codes = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t.code])), [types])
  const slots = useMemo(() => slotsOf(entries, codes), [entries, codes])

  const groups = useMemo(() => [...new Set(slots.map((s) => s.group).filter((g): g is string => !!g))], [slots])
  const baseQ = useQueries({
    queries: groups.map((g) => ({
      queryKey: ['next-no', g], staleTime: 15_000,
      queryFn: () => api.get<{ suggestions: string[] }>(`/api/property-numbers/next?typeId=${g.split('|')[1]}&dateAcquired=${g.split('|')[0]}-01-01&count=1`),
    })),
  })
  const bases = useMemo(() => Object.fromEntries(groups.flatMap((g, i) => {
    const s = baseQ[i]?.data?.suggestions[0]
    return s ? [[g, parseSeries(s)?.n ?? 1]] : []
  })), [groups, baseQ.map((q) => q.data?.suggestions[0]).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const numbers = useMemo(() => numbersOf(entries, slots, bases), [entries, slots, bases])

  const setEntry = (i: number, patch: Partial<Entry>) => setEntries((es) => es.map((e, k) => (k === i ? { ...e, ...patch } : e)))
  const copies = (i: number, n: number) => setEntries((es) => [...es.slice(0, i + 1), ...Array.from({ length: n }, () => duplicate(es[i])), ...es.slice(i + 1)])
  const [copyCount, setCopyCount] = useState<Record<string, string>>({})

  const rowsBy = (cat: 'semi' | 'ppe') => entries.filter((e) => categoryOf(e, threshold) === cat).length
  const icsRows = documentId ? (doc.data?.type === 'ICS' ? entries.length : 0) : rowsBy('semi')
  const parRows = documentId ? (doc.data?.type === 'PAR' ? entries.length : 0) : rowsBy('ppe')
  const parForms = documentId ? (doc.data?.type === 'PAR' ? 1 : 0) : parCount
  const issuer = allOfficers.find((o) => o.id === header.issuedBy)
  const receiver = (documentId ? allOfficers.find((o) => o.id === doc.data?.receivedByOfficerId) : receivers.find((o) => o.id === header.receivedBy)) ?? allOfficers.find((o) => o.id === header.receivedBy)

  function build(): { body: { header: object; rows: object[]; generate: boolean } | null; errs: RowErrors } {
    const errs: RowErrors = {}
    const add = (i: number, m: string) => { (errs[i] ??= []).push(m) }
    const rows = entries.map((e, i) => {
      const cents = centavosOf(e)
      if (cents === null) add(i, 'Enter the unit cost, like 96,450.00.')
      if (!e.typeId || !e.article.trim() || !e.unit.trim()) add(i, 'Fill in the property type, article and unit.')
      if (!isIsoDate(e.dateAcquired)) add(i, 'Enter the date acquired.')
      if (!e.description.trim()) add(i, 'Enter the description (model and specifications).')
      const mainNos = numbers.mains[i]
      mainNos.forEach((no, u) => { if (!no) add(i, `Unit ${u + 1} has no property number: set the property type and date acquired, or type one.`) })
      if (e.comps.length && e.mains.length !== 1) add(i, 'A row with parts must have quantity 1: enter each set as its own row.')
      const serial = (v: string) => (v.trim() && v.trim().toUpperCase() !== NO_SERIAL ? { serialNo: v.trim() } : {})
      const props = [
        ...e.mains.map((m, u) => ({ propertyNo: mainNos[u], ...serial(m.serial) })),
        ...e.comps.map((c, k) => ({ propertyNo: numbers.comps[i][k], componentLabel: c.label.trim(), ...serial(c.serial) })),
      ]
      if (e.comps.some((c) => !c.label.trim())) add(i, 'Every component needs a label, like Mouse.')
      return {
        line: {
          propertyTypeId: Number(e.typeId), article: e.article.trim(), unit: e.unit.trim(),
          qty: Number(e.qty), unitCostCentavos: cents ?? 0, description: e.description.trim(), dateAcquired: e.dateAcquired, ...(e.life.trim() ? { estUsefulLifeYears: Number(e.life) } : {}),
        },
        properties: props,
      }
    })
    rows.forEach((r, i) => {
      const p = lineInput.safeParse(r)
      if (!p.success && !errs[i]) for (const issue of p.error.issues) add(i, `${issue.path.slice(0, 3).join(' ')}: ${issue.message}`)
    })
    return {
      errs, body: Object.keys(errs).length ? null : {
        header: {
          receivedByOfficerId: header.receivedBy, receivedByPosition: header.receivedByPosition.trim() || undefined, issuedByOfficerId: header.issuedBy,
          issuedByPosition: header.issuedByPosition.trim() || undefined, issuedDate: header.issuedDate, fundCluster: header.fundCluster.trim(),
          purpose: header.purpose.trim() || undefined, icsNo: header.icsNo.trim() || undefined,
          parNos: parCount ? header.parNos.slice(0, parCount).map((no) => no.trim()) : undefined,
        },
        rows, generate: false,
      },
    }
  }

  const finish = (r: Result) => {
    clearDraft()
    setDraft(null)
    for (const k of ['officers', 'documents', 'cards', 'card', 'registry', 'dashboard', 'next-no', 'next-doc-no', 'stickers']) qc.invalidateQueries({ queryKey: [k] })
    setResult(r)
    window.scrollTo({ top: 0 })
  }

  const onError = (e: unknown) => {
    if (!(e instanceof ApiError)) return toast.error('Could not save. Check your connection and try again.')
    const d = (e.details ?? {}) as { rowIndex?: number; duplicates?: { rowIndex: number; propertyNo: string }[]; type?: string }
    if (e.code === 'DUPLICATE_PROPERTY_NO' && d.duplicates) {
      const errs: RowErrors = {}
      for (const x of d.duplicates) (errs[x.rowIndex] ??= []).push(`Property number ${x.propertyNo} is already used or repeated on this form.`)
      setErrors(errs)
      setNextBumped((n) => n + 1)
      qc.invalidateQueries({ queryKey: ['next-no'] })
      toast.error('Nothing was saved. Some property numbers are already used.')
    } else if (e.code === 'DOC_NO_REQUIRED') {
      setHeaderError(d.type === 'PAR' ? { par: e.message } : { ics: e.message }); toast.error(e.message)
    } else if (e.code === 'DUPLICATE_DOCUMENT_NO') {
      qc.invalidateQueries({ queryKey: ['next-doc-no'] })
      setHeaderError(String((e.details as { type?: string })?.type) === 'PAR' ? { par: e.message } : { ics: e.message }); toast.error(e.message)
    } else if (e.code === 'OFFICER_CANNOT_RECEIVE') {
      setHeaderError({ receiver: e.message }); toast.error(e.message)
    } else if (d.rowIndex !== undefined) {
      setErrors({ [d.rowIndex]: [e.message] }); toast.error(e.message)
    } else if (e.code === 'DOCUMENT_SIGNED') { toast.error(e.message); void doc.refetch() }
    else toast.error(e.message)
  }
  const [, setNextBumped] = useState(0)

  const save = useMutation({
    mutationFn: async (generate: boolean) => {
      const built = build()
      setErrors(built.errs)
      setHeaderError({})
      if (!built.body) throw new Error('rows')
      if (documentId) {
        const out = await api.post<{ lines: { lineId: string; warning?: { message: string } }[] }>(`/api/documents/${documentId}/lines/batch`, { rows: built.body.rows })
        const warned = out.lines.find((l) => l.warning)
        if (warned) toast.warning(warned.warning!.message, { duration: 8000 })
        const d = doc.data!
        return { documents: [{ id: d.id, type: d.type, docNo: d.docNo, lineIds: out.lines.map((l) => l.lineId) }], warnings: [] } as Result
      }
      const body = { ...built.body, generate }
      const parsed = issuanceInput.safeParse(body)
      if (!parsed.success) { setHeaderError({ general: parsed.error.issues[0].message }); throw new Error('header') }
      return { ...(await api.post<Result>('/api/issuances', parsed.data)), generated: generate }
    },
    onSuccess: finish,
    onError: (e) => {
      if (e instanceof Error && (e.message === 'rows' || e.message === 'header')) return toast.error('Please fix what is marked on the form.')
      onError(e)
    },
  })

  const regenerate = useMutation({
    mutationFn: (id: string) => api.post(`/api/documents/${id}/generate`),
    onSuccess: () => { toast.success('Form regenerated'); qc.invalidateQueries({ queryKey: ['document'] }) },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not regenerate'),
  })

  const pdfOf = (id: string) => `/api/documents/${id}/pdf?kind=generated`

  if (result) {
    return (
      <>
        <PageHeader title="Saved" description="The cards, the registry and the officer's report are updated." />
        {result.warnings.includes('GENERATION_FAILED') && (
          <p role="alert" className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            The entries are saved, but the form could not be generated. Open the document and press “Generate form” to try again.
          </p>
        )}
        <ul className="grid gap-3">
          {result.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
              <TypeBadge type={d.type} />
              <span className="figures font-medium">{d.docNo}</span>
              <span className="text-sm text-muted-foreground">{d.lineIds.length} {d.lineIds.length === 1 ? 'row' : 'rows'}</span>
              <span className="ml-auto flex flex-wrap gap-2">
                {documentId && <Button variant="outline" size="sm" onClick={() => regenerate.mutate(d.id)} disabled={regenerate.isPending}>Regenerate form</Button>}
                {result.generated && !result.warnings.length && <a href={pdfOf(d.id)} target="_blank" rel="noreferrer" className={buttonVariants({ size: 'sm' })}><Printer /> Print</a>}
                <Link to={`/documents/${d.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}><ExternalLink /> Open</Link>
                <Link to={`/stickers?documentId=${d.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Stickers</Link>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex gap-2">
          <Button onClick={() => { setResult(null); setEntries([blankEntry()]); setErrors({}); setHeader((h) => ({ ...h, icsNo: '', parNos: [], purpose: '', receivedBy: '', receivedByPosition: '' })); if (documentId) navigate('/issue') }}><FilePlus2 /> Enter another issuance</Button>
          <Link to="/documents" className={buttonVariants({ variant: 'outline' })}>All ICS and PAR</Link>
        </div>
      </>
    )
  }

  if (documentId && doc.isLoading) return <PageSkeleton label="Loading the document" />
  if (documentId && (doc.error || !doc.data)) {
    return <EmptyState title="Document not found" action={<Link to="/documents" className={buttonVariants()}>Back to ICS and PAR</Link>}>It may have been deleted, or the link is wrong.</EmptyState>
  }
  if (documentId && doc.data?.files.uploaded) {
    return (
      <EmptyState title="This form has a signed copy" action={<Link to={`/documents/${documentId}`} className={buttonVariants()}>Open {doc.data.docNo}</Link>}>
        Its entries are locked. Remove the signed copy first if rows must be added.
      </EmptyState>
    )
  }

  const e0 = entries[0]
  const addRow = () => setEntries((es) => [...es, blankEntry(es.at(-1))])
  const submit = (generate: boolean) => (ev: React.FormEvent | React.MouseEvent) => { ev.preventDefault(); save.mutate(generate) }
  const hint = (cat: 'semi' | 'ppe' | null) => (cat ? <Badge variant={cat === 'ppe' ? 'default' : 'secondary'}>{cat === 'ppe' ? 'PPE · PC · PAR' : 'Semi-expendable · SPC · ICS'}</Badge> : null)

  return (
    <>
      <PageHeader
        title={documentId ? `Add rows to ${doc.data?.type} ${doc.data?.docNo}` : 'New issuance'}
        description={documentId
          ? 'These rows are added to the form that already exists. The receiver and the date stay as they are.'
          : 'Fill in the four sections in order. One save writes the cards (one per property), the registry, the report and the ICS or PAR together.'}
        actions={draft && !documentId ? <Button variant="destructive" size="sm" onClick={discardDraft}>Discard draft</Button> : undefined}
      />
      {draft && <p role="status" className="mb-4 rounded-md border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">Your unsaved entry was restored from this computer.</p>}

      <form onSubmit={submit(true)} noValidate className="rounded-xl border bg-card px-5 py-6 sm:px-8">
        <section aria-labelledby="s1" className="border-b pb-6">
          <h2 id="s1" className="text-2xl font-bold sm:text-[1.75rem]">1. Property card</h2>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">Each unit gets its own card. Enter the item once per row; the serial number goes beside each property number.</p>
          <div className="grid gap-4">
            {entries.map((e, i) => {
              const cat = categoryOf(e, threshold)
              const errs = errors[i]
              const mainNos = numbers.mains[i] ?? []
              return (
                <fieldset key={e.key} className={`grid gap-3 rounded-lg border p-4 ${errs ? 'border-destructive' : ''}`} aria-label={`Row ${i + 1}`}
                  onKeyDown={(ev) => { if (ev.ctrlKey && ev.key.toLowerCase() === 'd') { ev.preventDefault(); copies(i, 1) } }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">Row {i + 1}</span>
                    {hint(cat)}
                    <span className="ml-auto flex flex-wrap items-center gap-1">
                      <Button type="button" variant="ghost" size="xs" onClick={() => copies(i, 1)} title="Ctrl+D"><Copy /> Copy row</Button>
                      <Input aria-label={`Row ${i + 1}, number of copies`} className="h-7 w-14 text-right" inputMode="numeric" value={copyCount[e.key] ?? '5'}
                        onChange={(ev) => setCopyCount({ ...copyCount, [e.key]: ev.target.value })} />
                      <Button type="button" variant="ghost" size="xs" onClick={() => copies(i, Math.min(Math.max(Number.parseInt(copyCount[e.key] ?? '5', 10) || 1, 1), 100))}>Make copies</Button>
                      <Button type="button" variant="destructive" size="xs" disabled={entries.length === 1} onClick={() => setEntries((es) => es.filter((_, k) => k !== i))}><Trash2 /> Remove</Button>
                    </span>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="grid content-start gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor={`type-${i}`}>Property type</Label>
                        <NativeSelect id={`type-${i}`} aria-label={`Row ${i + 1}, property type`} className="h-9" value={e.typeId} onChange={(ev) => setEntry(i, { typeId: ev.target.value })}>
                          <option value="">Choose the type</option>
                          {types.filter((t) => t.active || String(t.id) === e.typeId).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                        </NativeSelect></div>
                      <div className="grid gap-1.5"><Label htmlFor={`article-${i}`}>Article</Label>
                        <Input id={`article-${i}`} aria-label={`Row ${i + 1}, article`} className="h-9" placeholder="e.g. Laptop" value={e.article} onChange={(ev) => setEntry(i, { article: ev.target.value })} /></div>
                      <div className="grid gap-1.5"><Label htmlFor={`unit-${i}`}>Unit</Label>
                        <Input id={`unit-${i}`} aria-label={`Row ${i + 1}, unit`} className="h-9" placeholder="e.g. unit, set, pc" value={e.unit} onChange={(ev) => setEntry(i, { unit: ev.target.value })} /></div>
                    </div>
                    <div className="grid content-start gap-1.5">
                      <Label htmlFor={`desc-${i}`}>Description (model and specifications, as printed)</Label>
                      <Textarea id={`desc-${i}`} rows={4} placeholder={'e.g. MSI Katana 15\nSpecification:\n- Memory: 16GB'} value={e.description} onChange={(ev) => setEntry(i, { description: ev.target.value })} />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="grid gap-1.5"><Label htmlFor={`qty-${i}`}>Quantity</Label>
                      <Input id={`qty-${i}`} inputMode="numeric" value={e.qty} onChange={(ev) => setEntries((es) => es.map((x, k) => (k === i ? withQty(x, ev.target.value) : x)))} /></div>
                    <div className="grid gap-1.5"><Label htmlFor={`cost-${i}`}>Unit cost (₱)</Label>
                      <Input id={`cost-${i}`} inputMode="decimal" placeholder="e.g. 37,092.00" value={e.cost} onChange={(ev) => setEntry(i, { cost: ev.target.value })} /></div>
                    <div className="grid gap-1.5"><Label htmlFor={`acq-${i}`}>Date acquired</Label>
                      <Input id={`acq-${i}`} type="date" value={e.dateAcquired} onChange={(ev) => setEntry(i, { dateAcquired: ev.target.value })} />
                      {isIsoDate(e.dateAcquired) && <p className="text-xs text-muted-foreground">{formatLongDate(e.dateAcquired)}</p>}</div>
                    <div className="grid gap-1.5"><Label htmlFor={`life-${i}`}>Useful life (years)</Label>
                      <Input id={`life-${i}`} inputMode="numeric" value={e.life} onChange={(ev) => setEntry(i, { life: ev.target.value })} /></div>
                  </div>

                  <div className="grid gap-2">
                    <p className="text-sm font-medium">Property numbers</p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {e.mains.map((m, u) => (
                        <div key={u} className="grid gap-1 rounded-md bg-muted/40 p-2">
                          <Input aria-label={`Row ${i + 1}, unit ${u + 1}, property number`} className="figures h-8" value={m.no} placeholder={mainNos[u] || 'needs type and date acquired'}
                            onChange={(ev) => setEntries((es) => es.map((x, k) => (k === i ? { ...x, mains: x.mains.map((y, z) => (z === u ? { ...y, no: ev.target.value } : y)) } : x)))} />
                          <Input aria-label={`Row ${i + 1}, unit ${u + 1}, serial number`} className="h-7" placeholder="Serial no., N/A if none" value={m.serial}
                            onChange={(ev) => setEntries((es) => es.map((x, k) => (k === i ? { ...x, mains: x.mains.map((y, z) => (z === u ? { ...y, serial: ev.target.value } : y)) } : x)))} />
                        </div>
                      ))}
                    </div>
                    {e.comps.length > 0 && (
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {e.comps.map((c, k) => (
                          <div key={k} className="grid gap-1 rounded-md border border-dashed p-2">
                            <Input aria-label={`Row ${i + 1}, component ${k + 1}, label`} className="h-8" placeholder="Component, e.g. Mouse" value={c.label}
                              onChange={(ev) => setEntries((es) => es.map((x, q) => (q === i ? { ...x, comps: x.comps.map((y, z) => (z === k ? { ...y, label: ev.target.value } : y)) } : x)))} />
                            <Input aria-label={`Row ${i + 1}, component ${k + 1}, property number`} className="figures h-8" value={c.no} placeholder={numbers.comps[i]?.[k] ?? ''}
                              onChange={(ev) => setEntries((es) => es.map((x, q) => (q === i ? { ...x, comps: x.comps.map((y, z) => (z === k ? { ...y, no: ev.target.value } : y)) } : x)))} />
                            <Input aria-label={`Row ${i + 1}, component ${k + 1}, serial number`} className="h-7" placeholder="Serial no., N/A if none" value={c.serial}
                              onChange={(ev) => setEntries((es) => es.map((x, q) => (q === i ? { ...x, comps: x.comps.map((y, z) => (z === k ? { ...y, serial: ev.target.value } : y)) } : x)))} />
                            <Button type="button" variant="destructive" size="xs" onClick={() => setEntries((es) => es.map((x, q) => (q === i ? { ...x, comps: x.comps.filter((_, z) => z !== k) } : x)))}>Remove component</Button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div><Button type="button" variant="outline" size="xs" onClick={() => setEntries((es) => es.map((x, q) => (q === i ? { ...x, comps: [...x.comps, { label: '', no: '', serial: NO_SERIAL }] } : x)))}><Plus /> Add component</Button></div>
                  </div>
                  {errs && <ul role="alert" className="list-disc pl-5 text-sm text-destructive">{errs.map((m, k) => <li key={k}>{m}</li>)}</ul>}
                </fieldset>
              )
            })}
          </div>
          <div className="mt-4"><Button type="button" variant="outline" onClick={addRow}><Plus /> Add a row</Button></div>
        </section>

        <FormSection title="2. Registry">
          {documentId ? (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Received by <strong>{receiver?.fullName ?? ' '}</strong> on <strong>{doc.data ? formatLongDate(doc.data.issuedDate) : ''}</strong>, fund cluster {doc.data?.fundCluster}.
            </p>
          ) : (
            <>
              <div className="grid content-start gap-1.5 sm:col-span-2">
                <Label htmlFor="rcv">Received by (accountable officer)</Label>
                <OfficerPicker id="rcv" officers={receivers} value={header.receivedBy} invalid={!!headerError.receiver}
                  onChange={(o) => setHeader({ ...header, receivedBy: o?.id ?? '', receivedByPosition: o?.position ?? header.receivedByPosition })} />
                {headerError.receiver && <p role="alert" className="text-sm text-destructive">{headerError.receiver}</p>}
                {!receivers.length && <p className="text-xs text-muted-foreground">No officer can receive property yet. Ask the IT officer to mark who may receive property.</p>}
              </div>
              <div className="grid content-start gap-1.5"><Label htmlFor="date">Date issued</Label>
                <Input id="date" type="date" className="h-9" value={header.issuedDate} onChange={(ev) => setHeader({ ...header, issuedDate: ev.target.value })} />
                {isIsoDate(header.issuedDate) && <p className="text-xs text-muted-foreground">{formatLongDate(header.issuedDate)}</p>}</div>
              <div className="grid content-start gap-1.5"><Label htmlFor="fund">Fund cluster</Label>
                <Input id="fund" className="h-9" value={header.fundCluster} onChange={(ev) => setHeader({ ...header, fundCluster: ev.target.value })} /></div>
              <div className="grid content-start gap-1.5 sm:col-span-2"><Label htmlFor="purpose">Purpose (registry remarks)</Label>
                <Textarea id="purpose" rows={2} placeholder="e.g. ICT equipment for SARAi staff operations" value={header.purpose} onChange={(ev) => setHeader({ ...header, purpose: ev.target.value })} /></div>
            </>
          )}
        </FormSection>

        <section aria-labelledby="s3" className="grid gap-3 border-b py-6">
          <div>
            <h2 id="s3" className="text-2xl font-bold sm:text-[1.75rem]">3. Report</h2>
            <p className="mt-1 text-sm text-muted-foreground">How these rows will appear on {receiver ? `${receiver.fullName}'s` : "the receiver's"} RPCSP or RPCPPE.</p>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-muted/50 text-left text-xs">
                <tr><th className="px-3 py-2">Report</th><th className="px-3 py-2">Article</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Property No.</th><th className="px-3 py-2">Unit</th><th className="px-3 py-2 text-right">Unit value</th><th className="px-3 py-2 text-right">Balance per card</th><th className="px-3 py-2">On hand</th><th className="px-3 py-2">Shortage/Overage</th></tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  const cat = categoryOf(e, threshold)
                  const cents = centavosOf(e)
                  return (
                    <tr key={e.key} className="border-t align-top">
                      <td className="px-3 py-2">{cat ? (cat === 'semi' ? 'RPCSP' : 'RPCPPE') : '—'}</td>
                      <td className="px-3 py-2">{articleOf(e) || '—'}</td>
                      <td className="px-3 py-2 whitespace-pre-line">{e.description || '—'}</td>
                      <td className="figures px-3 py-2 whitespace-pre-line">{[...(numbers.mains[i] ?? []), ...(numbers.comps[i] ?? [])].filter(Boolean).join('\n') || '—'}</td>
                      <td className="px-3 py-2">{unitOf(e) || '—'}</td>
                      <td className="figures px-3 py-2 text-right">{cents === null ? '—' : formatPeso(cents)}</td>
                      <td className="figures px-3 py-2 text-right">{e.mains.length}</td>
                      <td className="px-3 py-2" /><td className="px-3 py-2" />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <FormSection title="4. ICS / PAR">
          <p role="status" className="rounded-md bg-muted/50 px-3 py-2 text-sm sm:col-span-2" data-testid="summary">
            {icsRows + parRows === 0 ? 'Enter a cost on each row to see which forms this makes.'
              : documentId ? `These ${icsRows + parRows} ${icsRows + parRows === 1 ? 'row is' : 'rows are'} added to ${doc.data?.type} ${doc.data?.docNo}.`
              : `This creates ${[icsRows ? `1 ICS (${icsRows} ${icsRows === 1 ? 'row' : 'rows'})` : '', parForms ? `${parForms} PAR (one per PPE unit)` : ''].filter(Boolean).join(' and ')}.`}
          </p>
          {!documentId && icsRows + parRows > 0 && (
            <div className="grid content-start gap-1.5 sm:col-span-2"><Label htmlFor="doc-unit">Office unit</Label>
              <NativeSelect id="doc-unit" className="h-9 sm:max-w-xs" value={header.unit} onChange={(ev) => setHeader({ ...header, unit: ev.target.value })}>
                <option value="">Choose the office unit</option>
                {units.filter((u) => u.active || u.code === header.unit).map((u) => <option key={u.code} value={u.code}>{u.code} · {u.name}</option>)}
              </NativeSelect>
              {!units.some((u) => u.active) && <p className="text-xs text-muted-foreground">No office units yet. Ask the IT officer to add them.</p>}</div>
          )}
          {!documentId && icsRows > 0 && (
            <div className="grid content-start gap-1.5"><Label htmlFor="icsNo">ICS No.</Label>
              <Input id="icsNo" className="figures h-9" aria-invalid={!!headerError.ics} value={header.icsNo} onChange={(ev) => setHeader({ ...header, icsNo: ev.target.value })} />
              {headerError.ics && <p role="alert" className="text-sm text-destructive">{headerError.ics}</p>}</div>
          )}
          {!documentId && parCount > 0 && (
            <div className="grid content-start gap-1.5 sm:col-span-2">
              <p className="text-sm font-medium">PAR No., one per PPE unit</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {header.parNos.map((no, k) => {
                  const unitNo = entries.flatMap((e, i) => (categoryOf(e, threshold) === 'ppe' ? (numbers.mains[i] ?? []) : []))[k]
                  return (
                    <div key={k} className="grid gap-1">
                      <Label htmlFor={`parNo-${k}`} className="text-xs text-muted-foreground">{`For ${unitNo || `PPE unit ${k + 1}`}`}</Label>
                      <Input id={`parNo-${k}`} aria-label={`PAR No. ${k + 1}`} className="figures h-9" aria-invalid={!!headerError.par} value={no}
                        onChange={(ev) => setHeader({ ...header, parNos: header.parNos.map((x, z) => (z === k ? ev.target.value : x)) })} />
                    </div>
                  )
                })}
              </div>
              {headerError.par && <p role="alert" className="text-sm text-destructive">{headerError.par}</p>}</div>
          )}
          {!documentId && (
            <>
              <div className="grid content-start gap-1.5"><Label htmlFor="issuer">Received from / Issued by</Label>
                <OfficerPicker id="issuer" officers={allOfficers} value={header.issuedBy}
                  onChange={(o) => setHeader({ ...header, issuedBy: o?.id ?? '', issuedByPosition: o?.position ?? '' })} /></div>
              <div className="grid content-start gap-1.5"><Label htmlFor="issuerPos">Position as printed</Label>
                <Input id="issuerPos" className="h-9" value={header.issuedByPosition} placeholder={issuer?.position} onChange={(ev) => setHeader({ ...header, issuedByPosition: ev.target.value })} /></div>
              <div className="grid content-start gap-1.5 sm:col-start-2"><Label htmlFor="rcvPos">Received by, position as printed</Label>
                <Input id="rcvPos" className="h-9" value={header.receivedByPosition} placeholder={receiver?.position} onChange={(ev) => setHeader({ ...header, receivedByPosition: ev.target.value })} /></div>
            </>
          )}
          {headerError.general && <p role="alert" className="text-sm text-destructive sm:col-span-2">{headerError.general}</p>}
        </FormSection>

        <div className="flex flex-wrap justify-end gap-2 pt-6">
          <Button type="button" variant="ghost" onClick={() => navigate('/documents')}>Cancel</Button>
          {documentId
            ? <Button type="submit" disabled={save.isPending || !e0}>{save.isPending ? 'Saving' : 'Save rows'}</Button>
            : <>
                <Button type="button" variant="outline" disabled={save.isPending} onClick={submit(false)}>Save, I'll upload the PDF</Button>
                <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving' : 'Save and generate ICS/PAR'}</Button>
              </>}
        </div>
      </form>
    </>
  )
}
