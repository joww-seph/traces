import { formatLongDate, formatPeso } from '@traces/shared'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { FormGrid } from '@/components/FormGrid'
import { PdfViewer } from '@/components/PdfViewer'
import { cardColumns, countColumns, icsParColumns, registryColumns, type CardRow, type CountRow, type IcsParRow, type PropertyView, type RegistryRow } from '@/lib/propertyView'
import { cn } from '@/lib/utils'

const TABS = [
  { id: 'icspar', label: 'ICS/PAR' },
  { id: 'report', label: 'Report' },
  { id: 'registry', label: 'Registry' },
  { id: 'card', label: 'Card' },
] as const
type TabId = (typeof TABS)[number]['id']

// The active tab lives in the URL hash so a link (or a refresh) lands on the same tab.
function useHashTab(): [TabId, (t: TabId) => void] {
  const read = (): TabId => (TABS.find((t) => `#${t.id}` === location.hash)?.id ?? 'icspar')
  const [tab, setTab] = useState<TabId>(read)
  useEffect(() => {
    const on = () => setTab(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return [tab, (t) => { history.replaceState(null, '', `#${t}`); setTab(t) }]
}

// Paper-form heading above each grid, like the top of the printed form.
function FormHead({ title, lines }: { title: string; lines: ReactNode[] }) {
  return (
    <div className="mb-3 text-center">
      <h3 className="text-sm font-bold tracking-wide sm:text-base">{title}</h3>
      <div className="mt-1 grid gap-0.5 text-xs text-muted-foreground">{lines.map((l, i) => <p key={i}>{l}</p>)}</div>
    </div>
  )
}

const entityLine = (entity: string, fund: string) => `${entity} · Fund Cluster: ${fund}`

function RegionHighlight({ region, ready }: { region: NonNullable<PropertyView['document']['pdfRegion']>; ready: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  // scroll only once the page is drawn, when the box has its final position
  useEffect(() => { if (ready) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [ready])
  return (
    <div ref={ref} data-testid="region-highlight" role="img" aria-label="Highlighted row on the form"
      className="pointer-events-none absolute rounded-sm border-2 border-yellow-500 bg-yellow-300/40"
      style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }} />
  )
}

function IcsParPanel({ view }: { view: PropertyView }) {
  const t = view.tabs.icsPar
  const region = view.document.pdfRegion
  const [page, setPage] = useState(region?.page ?? 1)
  const [ready, setReady] = useState(false)
  const columns = useMemo(() => icsParColumns(t.header.type), [t.header.type])
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section aria-label="Signed form" className="min-w-0">
        {view.document.pdfUrl
          ? <PdfViewer url={view.document.pdfUrl} page={page} onPageChange={(p) => { setReady(false); setPage(p) }} onPageRender={() => setReady(true)}>
              {region && region.page === page && <RegionHighlight region={region} ready={ready} />}
            </PdfViewer>
          : <p className="text-sm text-muted-foreground">No PDF attached to this document.</p>}
      </section>
      <section aria-label={t.header.title} className="min-w-0">
        <FormHead title={t.header.title} lines={[entityLine(t.header.entityName, t.header.fundCluster), `${t.header.type} No.: ${t.header.docNo}`]} />
        <FormGrid<IcsParRow> columnDefs={columns} rowData={t.rows} highlightRowId={t.highlightRowId} />
      </section>
    </div>
  )
}

function ReportPanel({ view }: { view: PropertyView }) {
  const t = view.tabs.report
  if ('empty' in t) {
    return (
      <div className="rounded-lg border border-dashed bg-card px-6 py-10 text-center">
        <p className="font-medium">Not counted yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          This item has not been part of a physical count. It appears here once the accountable officer's count includes it.
        </p>
      </div>
    )
  }
  const h = t.header
  return (
    <section aria-label={h.title}>
      <FormHead title={h.title} lines={[
        h.typeLabel, `As at ${formatLongDate(h.asAt)}`, entityLine(h.entityName, h.fundCluster),
        `Accountable officer: ${h.officerName}, ${h.officerPosition}${h.assumptionDate ? `, assumed ${formatLongDate(h.assumptionDate)}` : ''}`,
        h.status === 'closed' ? 'Count closed' : 'Count still open',
      ]} />
      <FormGrid<CountRow> columnDefs={countColumns()} rowData={t.rows} highlightRowId={t.highlightRowId} height={t.rows.length > 8 ? 420 : undefined} />
    </section>
  )
}

function RegistryPanel({ view }: { view: PropertyView }) {
  const t = view.tabs.registry
  return (
    <section aria-label={t.header.title}>
      <FormHead title={t.header.title} lines={[entityLine(t.header.entityName, t.header.fundCluster)]} />
      <FormGrid<RegistryRow> columnDefs={registryColumns} rowData={t.rows} highlightRowId={t.highlightRowId} height={t.rows.length > 8 ? 420 : undefined} />
    </section>
  )
}

export function CardPanel({ view }: { view: PropertyView }) {
  const t = view.tabs.card
  const columns = useMemo(() => cardColumns(t.header.category), [t.header.category])
  return (
    <section aria-label={t.header.title}>
      <FormHead title={t.header.title} lines={[
        entityLine(t.header.entityName, t.header.fundCluster),
        `${t.header.category === 'semi' ? 'Semi-expendable Property' : 'Property, Plant and Equipment'}: ${t.header.article}`,
        `Property Number: ${t.header.propertyNo}`,
      ]} />
      <FormGrid<CardRow> columnDefs={columns} rowData={t.rows} highlightRowId={t.highlightRowId} />
    </section>
  )
}

// The four tabs of a property: ICS/PAR with the PDF box, Report, Registry, Card. Shared by the public page and the admin page.
export function PropertyTabs({ view }: { view: PropertyView }) {
  const [tab, setTab] = useHashTab()
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab)
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null
    if (next === null) return
    e.preventDefault()
    const t = TABS[(next + TABS.length) % TABS.length]
    setTab(t.id)
    document.getElementById(`tab-${t.id}`)?.focus()
  }

  return (
    <div>
      <div role="tablist" aria-label="Forms for this item" onKeyDown={onKey}
        className="sticky top-0 z-10 -mx-4 flex gap-1 overflow-x-auto border-b bg-background/95 px-4 backdrop-blur sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button key={t.id} id={`tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}
            className={cn(
              'relative shrink-0 px-4 py-3 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              tab === t.id ? 'font-bold text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary' : 'text-muted-foreground hover:text-foreground',
            )}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-5">
        {tab === 'icspar' && <IcsParPanel view={view} />}
        {tab === 'report' && <ReportPanel view={view} />}
        {tab === 'registry' && <RegistryPanel view={view} />}
        {tab === 'card' && <CardPanel view={view} />}
      </div>
    </div>
  )
}

// Key facts of one property, used above the tabs on both pages.
export function PropertySummary({ view }: { view: PropertyView }) {
  const p = view.property, l = view.line, d = view.document
  const fact = (label: string, value: ReactNode) => (
    <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words text-sm font-medium">{value || '—'}</dd></div>
  )
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-4 rounded-xl border bg-card p-4 sm:grid-cols-3 lg:grid-cols-4">
      {fact('Description', <span className="whitespace-pre-line">{l.description}</span>)}
      {fact('Property number', <span className="figures">{p.propertyNo}</span>)}
      {fact('Serial number', p.serialNo)}
      {fact('Condition', p.condition === 'serviceable' ? 'Serviceable' : 'Unserviceable')}
      {fact('Unit cost', formatPeso(l.unitCostCentavos))}
      {fact('Date acquired', l.dateAcquired ? formatLongDate(l.dateAcquired) : formatLongDate(d.issuedDate))}
      {fact(d.type === 'ICS' ? 'Received from' : 'Issued by', `${d.issuedBy.name}, ${d.issuedBy.position}`)}
      {fact('Accountable officer', `${d.receivedBy.name}, ${d.receivedBy.position}`)}
      {p.oldPropertyNo && fact('Old property number', p.oldPropertyNo)}
    </dl>
  )
}
