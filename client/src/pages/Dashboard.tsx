import { useQuery } from '@tanstack/react-query'
import { formatLongDate, formatPeso } from '@traces/shared'
import { BookOpen, ClipboardList, FilePlus2, FileText, FileWarning, Layers, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { api } from '@/api'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { TypeBadge } from '@/components/TypeBadge'
import { buttonVariants } from '@/components/ui/button'

type DocRow = { id: string; type: 'ICS' | 'PAR'; docNo: string; issuedDate: string; receivedByName: string }
type Stat = { properties: number; mainUnits: number; valueCentavos: number }
type Summary = { documents: { ICS: number; PAR: number }; categories: { semi: Stat; ppe: Stat }; cards: number; unsignedDocuments: number }

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-PH')} ${n === 1 ? one : many}`

// A tile that opens its page: the dashboard is where most work starts.
function Tile({ to, label, value, note, Icon, warn }: { to: string; label: string; value?: number; note: string; Icon: LucideIcon; warn?: boolean }) {
  return (
    <Link to={to} className="group grid content-start gap-1 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring">
      <span className="flex items-center gap-2 text-sm font-medium"><Icon aria-hidden className={`size-4 ${warn && value ? 'text-amber-600' : 'text-primary'}`} />{label}</span>
      <span className="figures font-display text-2xl font-bold">{value === undefined ? ' ' : value.toLocaleString('en-PH')}</span>
      <span className="text-xs text-muted-foreground group-hover:text-foreground">{note}</span>
    </Link>
  )
}

function Category({ name, form, stat, share, tone }: { name: string; form: string; stat?: Stat; share: number; tone: string }) {
  return (
    <div className="grid content-start gap-3 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">{name}</h2>
        <span className="text-xs text-muted-foreground">{form}</span>
      </div>
      <p className="figures font-display text-3xl font-bold tracking-tight sm:text-4xl">{stat ? formatPeso(stat.valueCentavos) : ' '}</p>
      {/* share of the combined value carried by this category */}
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.round(share * 100)}% of total value`}>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(share * 100, stat?.valueCentavos ? 2 : 0)}%` }} />
      </div>
      <p className="text-sm text-muted-foreground">
        {stat ? `${plural(stat.mainUnits, 'item')} under ${plural(stat.properties, 'property number')}` : 'Loading'}
      </p>
    </div>
  )
}

export default function Dashboard() {
  const docs = useQuery({ queryKey: ['documents', 'recent'], queryFn: () => api.get<{ rows: DocRow[] }>('/api/documents') })
  const summary = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Summary>('/api/dashboard') })
  const s = summary.data
  const total = s ? s.categories.semi.valueCentavos + s.categories.ppe.valueCentavos : 0
  const share = (v = 0) => (total ? v / total : 0)

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Value and item counts come straight from every ICS and PAR line on record."
        actions={<Link to="/issue" className={buttonVariants()}><FilePlus2 /> New issuance</Link>}
      />

      <section aria-label="Shortcuts" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile to="/cards" label="Cards" value={s?.cards} note="One per model" Icon={Layers} />
        <Tile to="/registry" label="Registry" value={s && s.categories.semi.mainUnits + s.categories.ppe.mainUnits} note="Items issued" Icon={BookOpen} />
        <Tile to="/reports" label="Reports" note="RPCSP and RPCPPE by officer" Icon={ClipboardList} />
        <Tile to="/documents" label="ICS and PAR" value={s && s.documents.ICS + s.documents.PAR} note="All documents" Icon={FileText} />
        <Tile to="/documents?status=unsigned" label="Unsigned ICS/PAR" value={s?.unsignedDocuments} note="Entries without a signed copy" Icon={FileWarning} warn />
      </section>

      <section aria-label="Totals" className="grid overflow-hidden rounded-xl border bg-card md:grid-cols-[1fr_1fr_minmax(0,0.7fr)] md:divide-x max-md:divide-y">
        <Category name="Semi-expendable" form="ICS, RegSPI, RPCSP" stat={s?.categories.semi} share={share(s?.categories.semi.valueCentavos)} tone="bg-cyan" />
        <Category name="Property and equipment" form="PAR, PC, RPCPPE" stat={s?.categories.ppe} share={share(s?.categories.ppe.valueCentavos)} tone="bg-primary" />
        <div className="grid content-start gap-3 bg-muted/40 p-5 sm:p-6">
          <h2 className="text-base font-semibold">Documents</h2>
          <dl className="grid grid-cols-2 gap-4">
            <div><dt className="text-xs text-muted-foreground">ICS</dt><dd className="figures font-display text-3xl font-bold">{s?.documents.ICS ?? ' '}</dd></div>
            <div><dt className="text-xs text-muted-foreground">PAR</dt><dd className="figures font-display text-3xl font-bold">{s?.documents.PAR ?? ' '}</dd></div>
          </dl>
          <p className="text-sm text-muted-foreground">Total value {formatPeso(total)}</p>
        </div>
      </section>

      <section aria-labelledby="recent" className="mt-8">
        <div className="mb-3 flex items-end justify-between gap-4">
          <h2 id="recent" className="text-lg font-semibold">Recent documents</h2>
          <Link to="/documents" className="text-sm font-medium text-primary hover:underline">All documents</Link>
        </div>
        {docs.data && !docs.data.rows.length ? (
          <EmptyState title="No ICS or PAR yet"
            action={<Link to="/issue" className={buttonVariants()}>Enter the first issuance</Link>}>
            Enter an issuance once; the cards, registry rows, report and the ICS or PAR itself follow from it.
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <ul className="divide-y">
              {docs.data?.rows.slice(0, 8).map((d) => (
                <li key={d.id}>
                  <Link to={`/documents/${d.id}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none sm:grid-cols-[auto_1fr_10rem_9rem]">
                    <TypeBadge type={d.type} />
                    <span className="figures truncate font-medium">{d.docNo}</span>
                    <span className="truncate text-sm text-muted-foreground max-sm:col-start-2 max-sm:row-start-2">{d.receivedByName}</span>
                    <span className="text-right text-sm text-muted-foreground max-sm:col-start-3 max-sm:row-start-1">{formatLongDate(d.issuedDate)}</span>
                  </Link>
                </li>
              ))}
              {docs.isLoading && <li className="px-5 py-4 text-sm text-muted-foreground">Loading documents</li>}
            </ul>
          </div>
        )}
      </section>
    </>
  )
}
