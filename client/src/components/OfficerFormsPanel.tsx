import { useQuery } from '@tanstack/react-query'
import { formatLongDate } from '@traces/shared'
import { ArrowLeft, ExternalLink, FileDown, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '@/api'
import { TypeBadge } from '@/components/TypeBadge'
import { Button, buttonVariants } from '@/components/ui/button'

const PdfViewer = lazy(() => import('@/components/PdfViewer').then((m) => ({ default: m.PdfViewer })))

type OfficerForm = { id: string; type: 'ICS' | 'PAR'; docNo: string; issuedDate: string; hasPdf: boolean; signed: boolean }

export function OfficerFormsPanel({ officerId, name, onClose }: { officerId: string; name: string; onClose: () => void }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['officer-forms', officerId], queryFn: () => api.get<OfficerForm[]>(`/api/reports/forms?officerId=${officerId}`) })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const selected = data.find((f) => f.id === selectedId) ?? null

  useEffect(() => { setSelectedId(null) }, [officerId])
  useEffect(() => { setPage(1) }, [selectedId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside role="complementary" aria-label={`ICS and PAR held by ${name || 'this officer'}`}
      className="fixed inset-y-0 right-0 z-40 flex w-[min(34rem,100vw)] flex-col border-l bg-card shadow-xl print:hidden">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        {selected && <Button variant="ghost" size="icon-sm" aria-label="Back to the list" onClick={() => setSelectedId(null)}><ArrowLeft /></Button>}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{selected ? `${selected.type} ${selected.docNo}` : `ICS and PAR held by ${name || 'this officer'}`}</h2>
        {selected && <Link to={`/documents/${selected.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}><ExternalLink /> Open</Link>}
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}><X /></Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {selected ? (
          selected.hasPdf ? (
            <Suspense fallback={<p className="text-sm text-muted-foreground">Loading</p>}>
              <PdfViewer url={`/api/documents/${selected.id}/pdf`} page={page} onPageChange={setPage} />
            </Suspense>
          ) : <p className="text-sm text-muted-foreground">No PDF for this form yet.</p>
        ) : isLoading ? <p className="text-sm text-muted-foreground">Loading</p>
          : !data.length ? <p className="text-sm text-muted-foreground">This officer holds no property today.</p>
          : (
            <ol className="grid gap-1">
              {data.map((f, i) => (
                <li key={f.id}>
                  <button type="button" onClick={() => setSelectedId(f.id)} className="flex w-full flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                    <span className="figures w-5 text-right text-muted-foreground">{i + 1}.</span>
                    <TypeBadge type={f.type} />
                    <span className="figures font-medium">{f.docNo}</span>
                    <span className="text-muted-foreground">{formatLongDate(f.issuedDate)}</span>
                    <span className="text-xs text-muted-foreground">{f.signed ? 'signed copy' : f.hasPdf ? 'unsigned copy' : 'no PDF'}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
      </div>

      {!selected && data.some((f) => f.hasPdf) && (
        <div className="border-t p-3">
          <a href={`/api/reports/forms.pdf?officerId=${officerId}`} target="_blank" rel="noreferrer" className={buttonVariants({ size: 'sm' })}><FileDown /> Download all as one PDF</a>
        </div>
      )}
    </aside>
  )
}
