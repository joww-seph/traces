import { AllCommunityModule, ModuleRegistry, type ColDef, type ColGroupDef, type GridApi, type RowClickedEvent } from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { formatPeso } from '@traces/shared'
import { useEffect, useRef } from 'react'

ModuleRegistry.registerModules([AllCommunityModule])

// Right-aligned peso column; the value is integer centavos.
export const moneyCol = (field: string, headerName: string, extra: ColDef = {}): ColDef => ({
  field, headerName, type: 'rightAligned',
  valueFormatter: (p) => (p.value == null ? '' : formatPeso(p.value)),
  ...extra,
})

type Props<T> = {
  columnDefs: (ColDef<T> | ColGroupDef<T>)[]
  rowData: T[]
  /** Field holding each row's unique id (also what highlightRowId matches). */
  idKey?: keyof T & string
  highlightRowId?: string | number | null
  /** Fixed height in px for long grids; omit to size to the rows. */
  height?: number
  onRowClicked?: (row: T) => void
}

// Spreadsheet-style view: sort + filter on every column, fixed header, one highlighted row.
export function FormGrid<T extends object>({ columnDefs, rowData, idKey = 'id' as keyof T & string, highlightRowId, height, onRowClicked }: Props<T>) {
  const api = useRef<GridApi<T> | null>(null)

  const reveal = () => {
    if (highlightRowId == null || !api.current) return
    const node = api.current.getRowNode(String(highlightRowId))
    if (node) api.current.ensureNodeVisible(node, 'middle')
  }
  useEffect(() => {
    api.current?.redrawRows()
    reveal()
  }, [highlightRowId, rowData]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={height ? { height } : undefined} className="w-full">
      <AgGridReact<T>
        columnDefs={columnDefs}
        rowData={rowData}
        domLayout={height ? 'normal' : 'autoHeight'}
        defaultColDef={{ sortable: true, filter: true, resizable: true, wrapText: true, autoHeight: true }}
        getRowId={(p) => String(p.data[idKey])}
        rowClassRules={{ 'traces-highlight': (p) => highlightRowId != null && p.data != null && String(p.data[idKey]) === String(highlightRowId) }}
        onGridReady={(e) => { api.current = e.api; reveal() }}
        onRowClicked={onRowClicked ? (e: RowClickedEvent<T>) => e.data && onRowClicked(e.data) : undefined}
        overlayNoRowsTemplate="No rows"
      />
    </div>
  )
}
