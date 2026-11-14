import { useQuery } from '@tanstack/react-query'
import { ShieldAlert, TimerReset, Trash2 } from 'lucide-react'
import { useParams } from 'react-router'
import { ApiError, api } from '@/api'
import { TracesMark } from '@/components/Brand'
import { PropertySummary, PropertyTabs } from '@/components/PropertyTabs'
import { TypeBadge } from '@/components/TypeBadge'
import type { PropertyView } from '@/lib/propertyView'

// What a scan lands on. No login, read-only, built for a phone first.
function Notice({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6 py-10">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</div>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{children}</p>
      </div>
    </main>
  )
}

export default function QrView() {
  const { token = '' } = useParams()
  const { data, error, isLoading } = useQuery({
    queryKey: ['public', token], retry: false,
    queryFn: () => api.get<PropertyView>(`/api/public/q/${encodeURIComponent(token)}`),
  })

  if (isLoading) return <main className="grid min-h-dvh place-items-center text-sm text-muted-foreground" aria-busy="true">Opening the record</main>
  if (error || !data) {
    const e = error instanceof ApiError ? error : null
    if (e?.code === 'QR_REPLACED') return <Notice icon={<TimerReset />} title="This sticker was replaced">Look for the newer QR sticker on the item and scan that one instead.</Notice>
    if (e?.code === 'ITEM_REMOVED') return <Notice icon={<Trash2 />} title="This item was removed">It is no longer in the Supply Unit's records. Ask the Supply Unit if you need to know why.</Notice>
    if (e?.status === 429) return <Notice icon={<ShieldAlert />} title="Too many scans">Wait a minute, then scan again.</Notice>
    if (e?.status === 404) return <Notice icon={<ShieldAlert />} title="QR code not recognised">This code does not match any item. Check that the sticker is not damaged.</Notice>
    return <Notice icon={<ShieldAlert />} title="Could not open the record">Check your connection and scan again.</Notice>
  }

  const { property: p, line: l, document: d } = data
  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <TracesMark className="size-9 rounded-[3px]" />
          <div className="leading-tight">
            <p className="font-display text-base font-bold">TRACES</p>
            <p className="text-xs text-muted-foreground">Supply Unit, DOST Region 1</p>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-5 [&>*]:min-w-0">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={d.type} />
            <span className="text-xs text-muted-foreground">{p.category === 'ppe' ? 'Property, plant and equipment' : 'Semi-expendable'}</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold break-words">{l.article}</h1>
          <p className="figures text-sm text-muted-foreground">{p.propertyNo}{p.componentLabel ? ` · ${p.componentLabel}` : ''} · {d.type} {d.docNo}</p>
        </div>
        <PropertySummary view={data} />
        <PropertyTabs view={data} />
      </main>
    </div>
  )
}
