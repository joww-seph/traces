import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { Button } from '@/components/ui/button'

// The pdf.js worker, bundled the Vite way (see react-pdf's README).
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

type Props = {
  url: string
  page: number
  onPageChange: (page: number) => void
  /** Called once the page canvas has been drawn (its size is final from then on). */
  onPageRender?: () => void
  /** Drawn on top of the page, covering it exactly (coordinates are fractions of the page). */
  children?: ReactNode
}

// Fits the page to the container width, so it also works at 360 px.
export function PdfViewer({ url, page, onPageChange, onPageRender, children }: Props) {
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
          <Document file={file} loading={<p className="p-6 text-center text-sm text-muted-foreground">Loading PDF…</p>}
            onLoadSuccess={(d) => setPages(d.numPages)} onLoadError={() => setError(true)}>
            {width > 0 && (
              <div className="relative" style={{ width }}>
                <Page pageNumber={page} width={width} renderTextLayer={false} renderAnnotationLayer={false} onRenderSuccess={onPageRender} />
                {children && <div className="absolute inset-0">{children}</div>}
              </div>
            )}
          </Document>
        )}
      </div>
    </div>
  )
}
