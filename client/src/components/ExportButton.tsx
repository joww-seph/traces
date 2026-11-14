import { FileSpreadsheet, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

// Downloads an official-layout .xlsx from /api/exports. A failure is shown as a message instead of saving an error file.
export async function downloadExport(path: string) {
  const res = await fetch(path, { credentials: 'same-origin' })
  if (!res.ok) {
    const err = (await res.json().catch(() => null))?.error
    throw new Error(err?.message ?? 'The export failed')
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'export.xlsx'
  const url = URL.createObjectURL(await res.blob())
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return name
}

export function ExportButton({ path, label = 'Export to Excel', disabled }: { path: string; label?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button variant="outline" disabled={busy || disabled} onClick={async () => {
      setBusy(true)
      try { toast.success(`Saved ${await downloadExport(path)}`) } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
    }}>
      {busy ? <LoaderCircle className="animate-spin" /> : <FileSpreadsheet />} {label}
    </Button>
  )
}
