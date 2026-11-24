import { useQuery } from '@tanstack/react-query'
import { FileDown, X } from 'lucide-react'
import { lazy, Suspense, useEffect } from 'react'
import { api } from '@/api'
import { Button, buttonVariants } from '@/components/ui/button'

const PdfPages = lazy(() => import('@/components/PdfViewer').then((m) => ({ default: m.PdfPages })))

type OfficerForm = { id: string; type: 'ICS' | 'PAR'; docNo: string; issuedDate: string; hasPdf: boolean; signed: boolean }

export function OfficerFormsPanel({ officerId, name, onClose }: { officerId: string; name: string; onClose: () => void }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['officer-forms', officerId], queryFn: () => api.get<OfficerForm[]>(`/api/reports/forms?officerId=${officerId}`) })
  const printable = data.filter((f) => f.hasPdf)
  const missing = data.filter((f) => !f.hasPdf)
  const url = `/api/reports/forms.pdf?officerId=${officerId}`

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside role="complementary" aria-label={`ICS and PAR held by ${name || 'this officer'}`}
      className="fixed inset-y-0 right-0 z-40 flex w-[min(40rem,100vw)] flex-col border-l bg-muted shadow-xl print:hidden">
      <div className="flex items-center gap-2 border-b bg-card px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">ICS and PAR held by {name || 'this officer'}</h2>
        {printable.length > 0 && <a href={url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}><FileDown /> Download</a>}
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}><X /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading</p>
          : !data.length ? <p className="text-sm text-muted-foreground">This officer holds no property today.</p>
          : (
            <>
              {missing.length > 0 && <p role="status" className="mb-3 text-xs text-amber-800">No copy yet, left out: {missing.map((f) => `${f.type} ${f.docNo}`).join(', ')}.</p>}
              {printable.length > 0 && <Suspense fallback={<p className="text-sm text-muted-foreground">Loading</p>}><PdfPages url={url} /></Suspense>}
            </>
          )}
      </div>
    </aside>
  )
}
