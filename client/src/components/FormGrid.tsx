import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ColGroupDef, type GridApi, type RowClickedEvent } from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { formatPeso } from '@traces/shared'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

ModuleRegistry.registerModules([AllCommunityModule])

const gridTheme = themeQuartz.withParams({
  fontFamily: 'inherit', fontSize: 13, headerFontWeight: 600, wrapperBorderRadius: 8, borderRadius: 6,
  accentColor: '#004aad', backgroundColor: '#ffffff', foregroundColor: '#16263a', headerBackgroundColor: '#eef2f6',
  headerTextColor: '#16263a', borderColor: '#d9e2ea', rowHoverColor: '#e6f0fa', oddRowBackgroundColor: '#fafcfd',
})

export const moneyCol = (field: string, headerName: string, extra: ColDef = {}): ColDef => ({
  field, headerName, type: 'rightAligned',
  valueFormatter: (p) => (p.value == null ? '' : formatPeso(p.value)),
  ...extra,
})

type Props<T> = {
  columnDefs: (ColDef<T> | ColGroupDef<T>)[]
  rowData: T[]
  idKey?: keyof T & string
  highlightRowId?: string | number | null
  highlightRowIds?: string[]
  height?: number
  onRowClicked?: (row: T) => void
  onCellEdit?: (row: T, field: string, value: unknown) => void
  fullscreenTitle?: string
  pageSize?: number
}

export function FormGrid<T extends object>({ columnDefs, rowData, idKey = 'id' as keyof T & string, highlightRowId, highlightRowIds, height, onRowClicked, onCellEdit, fullscreenTitle, pageSize }: Props<T>) {
  const api = useRef<GridApi<T> | null>(null)
  const [full, setFull] = useState(false)
  const openBtn = useRef<HTMLButtonElement>(null)
  const exitBtn = useRef<HTMLButtonElement>(null)

  const marked = new Set([...(highlightRowIds ?? []), ...(highlightRowId == null ? [] : [String(highlightRowId)])])
  const reveal = () => {
    const first = [...marked][0]
    if (first === undefined || !api.current) return
    const node = api.current.getRowNode(first)
    if (!node) return
    if (pageSize && node.rowIndex != null) api.current.paginationGoToPage(Math.floor(node.rowIndex / pageSize))
    api.current.ensureNodeVisible(node, 'middle')
  }
  useEffect(() => {
    api.current?.redrawRows()
    reveal()
  }, [highlightRowId, highlightRowIds?.join('|'), rowData]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!full) return
    exitBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(reveal)
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; openBtn.current?.focus() }
  }, [full]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="w-full">
      {fullscreenTitle && (
        <div className="mb-2 flex justify-end">
          <Button ref={openBtn} type="button" variant="outline" size="sm" onClick={() => setFull(true)}><Maximize2 /> Full screen</Button>
        </div>
      )}
      <div role={full ? 'dialog' : undefined} aria-modal={full || undefined} aria-label={full ? fullscreenTitle : undefined}
        className={full ? 'fixed inset-0 z-50 flex flex-col gap-2 bg-background p-2 sm:p-3' : 'w-full'}>
        {full && (
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 flex-1 text-sm font-bold sm:text-base">{fullscreenTitle}</h2>
            <Button ref={exitBtn} type="button" variant="outline" size="sm" onClick={() => setFull(false)}><Minimize2 /> Exit full screen</Button>
          </div>
        )}
        <div style={!full && height ? { height } : undefined} className={full ? 'min-h-0 flex-1' : 'w-full'}>
      <AgGridReact<T>
        theme={gridTheme}
        columnDefs={columnDefs}
        rowData={rowData}
        domLayout={full || height ? 'normal' : 'autoHeight'}
        defaultColDef={{ sortable: true, filter: true, resizable: true, wrapText: true, autoHeight: true, wrapHeaderText: true, autoHeaderHeight: true }}
        getRowId={(p) => String(p.data[idKey])}
        rowClassRules={{ 'traces-highlight': (p) => p.data != null && marked.has(String(p.data[idKey])) }}
        onCellValueChanged={onCellEdit ? (e) => e.data && e.colDef.field && onCellEdit(e.data, e.colDef.field, e.newValue) : undefined}
        onGridReady={(e) => { api.current = e.api; reveal() }}
        onRowClicked={onRowClicked ? (e: RowClickedEvent<T>) => e.data && onRowClicked(e.data) : undefined}
        overlayNoRowsTemplate="No rows"
        {...(pageSize ? { pagination: true, paginationPageSize: pageSize, paginationPageSizeSelector: false } : {})}
        rowStyle={onRowClicked ? { cursor: 'pointer' } : undefined}
      />
        </div>
      </div>
    </div>
  )
}
