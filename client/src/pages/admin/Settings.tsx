import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatPeso, pesoToCentavos } from '@traces/shared'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, api } from '@/api'
import { NativeSelect } from '@/components/NativeSelect'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useOfficers, useSettings, useUnits, type Settings, type Unit } from '@/lib/queries'
import { PageSkeleton } from '@/components/Loading'
import { OfficerPicker } from '@/components/OfficerPicker'

type Draft = Omit<Settings, 'ppeThresholdCentavos' | 'defaultIssuedByOfficerId'> & { threshold: string; issuer: string }

const toDraft = (s: Settings): Draft => { const { defaultIssuedByOfficerId, ...rest } = s; return { ...rest, threshold: (s.ppeThresholdCentavos / 100).toFixed(2), issuer: defaultIssuedByOfficerId ?? '' } }

const centavosOrNull = (v: string) => { try { return pesoToCentavos(v) } catch { return null } }

export default function SettingsPage() {
  const qc = useQueryClient()
  const { data } = useSettings()
  const { data: officers = [] } = useOfficers(true)
  const [d, setD] = useState<Draft | null>(null)
  useEffect(() => { if (data) setD(toDraft(data)) }, [data])

  const save = useMutation({
    mutationFn: (body: Partial<Settings>) => api.patch<Settings>('/api/admin/settings', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Settings saved') },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save'),
  })

  if (!d) return <PageSkeleton label="Loading settings" />
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value })
  const text = (k: keyof Draft, label: string, hint?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`s-${k}`}>{label}</Label>
      <Input id={`s-${k}`} value={d[k]} onChange={set(k)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )

  const centavos = centavosOrNull(d.threshold)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (centavos === null) return toast.error('Enter the threshold as pesos, for example 50,000.00')
    const { threshold: _threshold, issuer, ...rest } = d
    save.mutate({ ...rest, ppeThresholdCentavos: centavos, defaultIssuedByOfficerId: issuer || null })
  }

  return (
    <>
      <PageHeader title="Settings" description="Office details, the PPE threshold, who issues by default and the form codes printed on the generated ICS and PAR." />
      <form onSubmit={submit} className="grid max-w-2xl gap-5">
        <section className="grid gap-3 rounded-xl border bg-card p-5">
          <h2 className="font-medium">Office</h2>
          {text('entityName', 'Entity name')}
          {text('defaultFundCluster', 'Fund cluster')}
          {text('publicBaseUrl', 'Public base URL', 'The address inside every QR code. Stickers already printed keep the old address.')}
        </section>
        <section className="grid gap-3 rounded-xl border bg-card p-5">
          <h2 className="font-medium">Property rules</h2>
          <div className="grid gap-1.5">
            <Label htmlFor="s-threshold">PPE threshold (pesos)</Label>
            <Input id="s-threshold" inputMode="decimal" aria-invalid={centavos === null} value={d.threshold} onChange={set('threshold')} />
            <p className="text-xs text-muted-foreground">
              {centavos === null ? 'Enter pesos, for example 50,000.00.' : `PPE from ${formatPeso(centavos)}.`}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="s-cardRowMode">Property card rows</Label>
            <NativeSelect id="s-cardRowMode" value={d.cardRowMode} onChange={set('cardRowMode')}>
              <option value="merged">Merged: receipt and issue on one row</option>
              <option value="split">Split: one row per movement</option>
            </NativeSelect>
          </div>
          {text('ppeRegistryTitle', 'PPE registry title')}
        </section>
        <section className="grid gap-3 rounded-xl border bg-card p-5 sm:grid-cols-2">
          <h2 className="font-medium sm:col-span-2">Generated ICS and PAR</h2>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="s-issuer">Issued by / Received from (default)</Label>
            <OfficerPicker id="s-issuer" officers={officers} value={d.issuer} noneLabel="None, choose on each issuance" onChange={(o) => setD({ ...d, issuer: o?.id ?? '' })} />
          </div>
          {text('icsFormCode', 'ICS form code')}
          {text('icsFormRevision', 'ICS revision')}
          {text('parFormCode', 'PAR form code')}
          {text('parFormRevision', 'PAR revision')}
        </section>
        <div><Button type="submit" disabled={save.isPending}>Save settings</Button></div>
      </form>
      <UnitsSection />
    </>
  )
}

// The units whose code goes inside ICS/PAR numbers (2026-11SARAi-001). Saved at once, not with the form above.
function UnitsSection() {
  const qc = useQueryClient()
  const { data: units = [] } = useUnits()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const done = () => qc.invalidateQueries({ queryKey: ['units'] })
  const add = useMutation({
    mutationFn: () => api.post<Unit>('/api/units', { code: code.trim(), name: name.trim() }),
    onSuccess: (u) => { done(); setCode(''); setName(''); setError(''); toast.success(`Unit ${u.code} added`) },
    onError: (e) => setError(e instanceof ApiError ? (e.status === 409 ? 'That unit code is already on the list.' : e.message) : 'Could not add the unit'),
  })
  const toggle = useMutation({
    mutationFn: (u: Unit) => api.patch<Unit>(`/api/units/${u.code}`, { active: !u.active }),
    onSuccess: (u) => { done(); toast.success(u.active ? `${u.code} is offered again` : `${u.code} is no longer offered`) },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save'),
  })
  return (
    <section aria-labelledby="units-h" className="mt-5 grid max-w-2xl gap-3 rounded-xl border bg-card p-5">
      <h2 id="units-h" className="font-medium">Units for ICS/PAR numbers</h2>
      <p className="text-sm text-muted-foreground">The unit code goes inside the suggested number, for example 2026-11<b>SARAi</b>-001.</p>
      {units.length > 0 && (
        <ul className="divide-y rounded-md border">
          {units.map((u) => (
            <li key={u.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="figures font-semibold">{u.code}</span>
              <span className="min-w-0 flex-1 break-words text-muted-foreground">{u.name}{!u.active && ' (not offered)'}</span>
              <Button type="button" variant="ghost" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(u)}>{u.active ? 'Stop offering' : 'Offer again'}</Button>
            </li>
          ))}
        </ul>
      )}
      <form className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
        <div className="grid gap-1.5"><Label htmlFor="u-code">Code</Label><Input id="u-code" className="figures" value={code} aria-invalid={!!error} onChange={(e) => setCode(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="u-name">Name</Label><Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <Button type="submit" variant="outline" disabled={add.isPending || !code.trim() || !name.trim()}>Add unit</Button>
        {error && <p role="alert" className="text-sm text-destructive sm:col-span-3">{error}</p>}
      </form>
    </section>
  )
}
