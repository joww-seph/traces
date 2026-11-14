import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { PdfViewer } from '@/components/PdfViewer'
import { Button } from '@/components/ui/button'

export type Region = { page: number; x: number; y: number; w: number; h: number }
type Drag = { x0: number; y0: number; x1: number; y1: number }

const clamp = (n: number) => Math.min(1, Math.max(0, n))
const round5 = (n: number) => Math.round(n * 1e5) / 1e5
const MIN = 0.005 // ignore accidental clicks

// Drag a box over the PDF. Stored as fractions of the page, so it lands in the same place at any zoom.
export function PdfRegionPicker({ url, value, onChange }: { url: string; value: Region | null; onChange: (r: Region | null) => void }) {
  const [page, setPage] = useState(value?.page ?? 1)
  const [drag, setDrag] = useState<Drag | null>(null)
  const surface = useRef<HTMLDivElement>(null)

  // jump to the saved box's page when it loads
  useEffect(() => { if (value) setPage(value.page) }, [value?.page]) // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e: PointerEvent) => {
    const r = surface.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) }
  }
  const down = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = point(e)
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const move = (e: PointerEvent) => drag && setDrag({ ...drag, ...(({ x, y }) => ({ x1: x, y1: y }))(point(e)) })
  const up = () => {
    if (!drag) return
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1)
    const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0)
    setDrag(null)
    if (w >= MIN && h >= MIN) onChange({ page, x: round5(x), y: round5(y), w: round5(Math.min(w, 1 - x)), h: round5(Math.min(h, 1 - y)) })
  }

  const shown = drag
    ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }
    : value && value.page === page ? value : null

  return (
    <div className="grid gap-2">
      <PdfViewer url={url} page={page} onPageChange={setPage}>
        <div ref={surface} role="group" className="h-full w-full cursor-crosshair touch-none" aria-label="Draw a box around this line on the PDF"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
          {shown && (
            <div data-testid="region-box" className="pointer-events-none absolute border-2 border-yellow-500 bg-yellow-300/40"
              style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%` }} />
          )}
        </div>
      </PdfViewer>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{value ? `Box saved on page ${value.page}.` : 'Drag on the page to box this line.'}</span>
        {value && <Button type="button" variant="ghost" size="xs" onClick={() => onChange(null)}>Clear box</Button>}
      </div>
    </div>
  )
}
