import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()

type Props = {
  url: string
  page: number
  onPageChange: (page: number) => void
  onPageRender?: () => void
  children?: ReactNode
}

const A4 = 297 / 210

function PageSkeleton({ width }: { width: number }) {
  return (
    <div role="status" aria-label="Loading the form" className="grid content-start gap-3 p-[8%]" style={{ height: width ? width * A4 : 320 }}>
      <Skeleton className="h-3 w-1/2 justify-self-center" />
      <Skeleton className="h-2 w-1/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

export function PdfViewer({ url, page, onPageChange, onPageRender, children }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [pages, setPages] = useState(0)
  const [error, setError] = useState(false)
  const [drawn, setDrawn] = useState('')
  const shown = drawn === `${url}#${page}`
  const file = useMemo(() => ({ url, withCredentials: true }), [url])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-sm">
        <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft />
        </Button>
        <span>Page {page}{pages ? ` of ${pages}` : ''}</span>
        <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          <ChevronRight />
        </Button>
      </div>
      <div ref={box} className="overflow-hidden rounded border bg-white">
        {error ? (
          <p className="p-6 text-center text-sm text-destructive">Could not load the PDF.</p>
        ) : (
          <Document file={file} suspense={false} loading={<PageSkeleton width={width} />}
            onLoadSuccess={(d) => setPages(d.numPages)} onLoadError={() => setError(true)}>
            {width > 0 && (
              <div className="relative" style={{ width, minHeight: shown ? undefined : width * A4 }}>
                <Page pageNumber={page} width={width} suspense={false} renderTextLayer={false} renderAnnotationLayer={false} loading={null}
                  onRenderSuccess={() => { setDrawn(`${url}#${page}`); onPageRender?.() }} />
                {!shown && <div className="absolute inset-0"><PageSkeleton width={width} /></div>}
                {children && shown && <div className="absolute inset-0">{children}</div>}
              </div>
            )}
          </Document>
        )}
      </div>
    </div>
  )
}

function LazyPage({ pageNumber, width }: { pageNumber: number; width: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(pageNumber <= 2)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setNear(true) }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  return (
    <div ref={ref} className="overflow-hidden rounded border bg-white shadow-sm" style={{ width, minHeight: width * A4 }}>
      {near && <Page pageNumber={pageNumber} width={width} renderTextLayer={false} renderAnnotationLayer={false} loading={<PageSkeleton width={width} />} />}
    </div>
  )
}

export function PdfPages({ url }: { url: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [pages, setPages] = useState(0)
  const [error, setError] = useState(false)
  const file = useMemo(() => ({ url, withCredentials: true }), [url])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={box} className="grid gap-3">
      {error ? <p className="p-6 text-center text-sm text-destructive">Could not load the PDF.</p> : (
        <Document file={file} loading={<PageSkeleton width={width} />} onLoadSuccess={(d) => setPages(d.numPages)} onLoadError={() => setError(true)}>
          {width > 0 && Array.from({ length: pages }, (_, i) => <LazyPage key={i} pageNumber={i + 1} width={width} />)}
        </Document>
      )}
    </div>
  )
}
