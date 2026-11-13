import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ColGroupDef, type GridApi, type RowClickedEvent } from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { formatPeso } from '@traces/shared'
import { useEffect, useRef } from 'react'

ModuleRegistry.registerModules([AllCommunityModule])

// Grid look follows the app tokens; AG Grid switches between the two sets via data-ag-theme-mode on <html>.
const gridTheme = themeQuartz
  .withParams({
    fontFamily: 'inherit', fontSize: 13, headerFontWeight: 600, wrapperBorderRadius: 8, borderRadius: 6,
    accentColor: '#004aad', backgroundColor: '#ffffff', foregroundColor: '#16263a', headerBackgroundColor: '#eef2f6',
    headerTextColor: '#16263a', borderColor: '#d9e2ea', rowHoverColor: '#e6f0fa', oddRowBackgroundColor: '#fafcfd',
  }, 'light')
  .withParams({
    accentColor: '#4c70fc', backgroundColor: '#142331', foregroundColor: '#e6eef5', headerBackgroundColor: '#1a2c3e',
    headerTextColor: '#e6eef5', borderColor: '#24384b', rowHoverColor: '#1c3550', oddRowBackgroundColor: '#152534',
  }, 'dark')

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
        theme={gridTheme}
        columnDefs={columnDefs}
        rowData={rowData}
        domLayout={height ? 'normal' : 'autoHeight'}
        defaultColDef={{ sortable: true, filter: true, resizable: true, wrapText: true, autoHeight: true, wrapHeaderText: true, autoHeaderHeight: true }}
        getRowId={(p) => String(p.data[idKey])}
        rowClassRules={{ 'traces-highlight': (p) => highlightRowId != null && p.data != null && String(p.data[idKey]) === String(highlightRowId) }}
        onGridReady={(e) => { api.current = e.api; reveal() }}
        onRowClicked={onRowClicked ? (e: RowClickedEvent<T>) => e.data && onRowClicked(e.data) : undefined}
        overlayNoRowsTemplate="No rows"
      />
    </div>
  )
}
