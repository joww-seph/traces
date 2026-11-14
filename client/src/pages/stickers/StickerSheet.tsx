import { useQuery } from '@tanstack/react-query'
import { Printer, TriangleAlert } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api } from '@/api'
import { NativeSelect } from '@/components/NativeSelect'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useSettings } from '@/lib/queries'
import { cn } from '@/lib/utils'

type Sticker = { propertyNo: string; url: string }
type Size = '1x1' | 'passport'
const SIZES: { id: Size; label: string; detail: string }[] = [
  { id: '1x1', label: '1 × 1 inch', detail: '25.4 mm, 54 per sheet' },
  { id: 'passport', label: 'Passport size', detail: '35 × 45 mm, 20 per sheet' },
]

// A private or loopback address cannot be reached after deployment, so such stickers are tests only.
const isTestUrl = (url: string) => {
  try {
    const h = new URL(url).hostname
    return h === 'localhost' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  } catch { return true }
}

function Picker() {
  const navigate = useNavigate()
  const [docId, setDocId] = useState('')
  const [nos, setNos] = useState('')
  const docs = useQuery({ queryKey: ['documents', 'picker'], queryFn: () => api.get<{ rows: { id: string; type: string; docNo: string }[] }>('/api/documents') })
  const go = (e: React.FormEvent) => {
    e.preventDefault()
    if (docId) navigate(`/stickers?documentId=${docId}`)
    else if (nos.trim()) navigate(`/stickers?nos=${encodeURIComponent(nos.split(/[\s,]+/).filter(Boolean).join(','))}`)
  }
  return (
    <form onSubmit={go} className="grid max-w-2xl gap-6 rounded-xl border bg-card p-5 sm:p-6">
      <div className="grid gap-1.5">
        <label htmlFor="doc" className="text-sm font-medium">All items of one document</label>
        <NativeSelect id="doc" className="h-9" value={docId} onChange={(e) => { setDocId(e.target.value); setNos('') }}>
          <option value="">Choose an ICS or PAR</option>
          {docs.data?.rows.map((d) => <option key={d.id} value={d.id}>{d.type} {d.docNo}</option>)}
        </NativeSelect>
      </div>
      <p className="text-center text-sm text-muted-foreground">or</p>
      <div className="grid gap-1.5">
        <label htmlFor="nos" className="text-sm font-medium">Specific property numbers</label>
        <Textarea id="nos" rows={3} placeholder="2026-09ICT-0199, 2026-09ICT-0199a" value={nos} onChange={(e) => { setNos(e.target.value); setDocId('') }} />
        <p className="text-xs text-muted-foreground">Separate numbers with commas, spaces or new lines.</p>
      </div>
      <div><Button type="submit" disabled={!docId && !nos.trim()}>Prepare sheet</Button></div>
    </form>
  )
}

function Sheet({ stickers, size }: { stickers: Sticker[]; size: Size }) {
  const [images, setImages] = useState<Record<string, string>>({})
  useEffect(() => {
    let live = true
    Promise.all(stickers.map(async (s) => [s.url, await QRCode.toDataURL(s.url, { errorCorrectionLevel: 'M', margin: 2, width: 300 })] as const))
      .then((pairs) => { if (live) setImages(Object.fromEntries(pairs)) })
    return () => { live = false }
  }, [stickers])
  return (
    <div className="sticker-sheet" data-size={size} data-testid="sticker-sheet">
      {stickers.map((s, i) => (
        <figure key={`${s.url}-${i}`} className="sticker">
          {images[s.url] ? <img src={images[s.url]} alt={`QR code for ${s.propertyNo}`} /> : <span className="sticker-blank" aria-hidden />}
          <figcaption className="sticker-no">{s.propertyNo}</figcaption>
        </figure>
      ))}
    </div>
  )
}

export default function StickerSheet() {
  const [params] = useSearchParams()
  const documentId = params.get('documentId')
  const nos = params.get('nos')
  const [size, setSize] = useState<Size>('1x1')
  const [copies, setCopies] = useState<Record<string, number>>({}) // per property number, default 1
  const { data: settings } = useSettings()
  const qs = documentId ? `documentId=${documentId}` : nos ? `nos=${encodeURIComponent(nos)}` : ''
  const { data, isLoading, error } = useQuery({ queryKey: ['stickers', qs], enabled: !!qs, retry: false, queryFn: () => api.get<Sticker[]>(`/api/stickers?${qs}`) })

  // every property prints `copies` times (a bigger item may want a sticker on each side); memoised so the QR images are not redrawn on every render
  const sheet = useMemo(() => data?.flatMap((st) => Array.from({ length: copies[st.propertyNo] ?? 1 }, () => st)), [data, copies])

  if (!qs) {
    return (<><PageHeader title="Stickers" description="Print QR stickers for the items of one document, or for specific property numbers. Every property number, including components, gets its own sticker." /><Picker /></>)
  }

  const perSheet = size === '1x1' ? 54 : 20
  const test = settings ? isTestUrl(settings.publicBaseUrl) : false
  return (
    <>
      <div className="print:hidden">
        <PageHeader crumbs={[{ label: 'Stickers', to: '/stickers' }, { label: 'Sheet' }]} title="Sticker sheet"
          description={sheet ? `${sheet.length} ${sheet.length === 1 ? 'sticker' : 'stickers'} · ${Math.max(1, Math.ceil(sheet.length / perSheet))} A4 ${Math.ceil(sheet.length / perSheet) === 1 ? 'sheet' : 'sheets'}` : undefined}
          actions={<Button onClick={() => window.print()} disabled={!data?.length}><Printer /> Print</Button>} />

        {test && settings && (
          <div role="alert" className="mb-5 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
            <p><strong>Test stickers only.</strong> QR codes will break after deployment: they point to <span className="figures font-medium">{settings.publicBaseUrl}</span>, an address that works only on this network. Set the real address in Settings before printing stickers for the items.</p>
          </div>
        )}

        <div className="mb-5 flex flex-wrap items-end gap-x-8 gap-y-3">
          <div role="radiogroup" aria-label="Sticker size" className="inline-flex rounded-lg bg-muted p-1">
            {SIZES.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={size === s.id} onClick={() => setSize(s.id)}
                className={cn('rounded-md px-3.5 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-ring', size === s.id ? 'bg-card font-bold text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{SIZES.find((s) => s.id === size)!.detail}. Print at 100% scale (no “fit to page”), on A4 sticker paper.</p>
        </div>

        {data && data.length > 0 && (
          <details className="mb-5 rounded-lg border bg-card p-3">
            <summary className="cursor-pointer text-sm font-medium">Copies per property number</summary>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data.map((st) => (
                <li key={st.propertyNo} className="flex items-center justify-between gap-3 text-sm">
                  <label htmlFor={`copies-${st.propertyNo}`} className="figures truncate">{st.propertyNo}</label>
                  <input id={`copies-${st.propertyNo}`} type="number" min={1} max={20} className="h-8 w-16 rounded-lg border border-input bg-transparent px-2 text-right"
                    value={copies[st.propertyNo] ?? 1}
                    onChange={(e) => setCopies({ ...copies, [st.propertyNo]: Math.min(20, Math.max(1, Math.floor(Number(e.target.value)) || 1)) })} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground print:hidden">Preparing stickers</p>}
      {error && <div className="print:hidden"><EmptyState title="No stickers found" action={<Link to="/stickers" className={buttonVariants()}>Choose again</Link>}>No active QR codes match. Check the document or the property numbers.</EmptyState></div>}
      {sheet && <Sheet stickers={sheet} size={size} />}
    </>
  )
}
