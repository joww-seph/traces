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
import { useOfficers, useSettings, type Settings } from '@/lib/queries'

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

  if (!d) return <p className="text-sm text-muted-foreground">Loading settings</p>
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
              {centavos === null ? 'Enter pesos, for example 50,000.00.' : `Items costing ${formatPeso(centavos)} or more are PPE. Existing records keep their category.`}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="s-cardRowMode">Property card rows</Label>
            <NativeSelect id="s-cardRowMode" value={d.cardRowMode} onChange={set('cardRowMode')}>
              <option value="merged">Merged: issue and return on one row</option>
              <option value="split">Split: one row per movement</option>
            </NativeSelect>
          </div>
          {text('ppeRegistryTitle', 'PPE registry title')}
        </section>
        <section className="grid gap-3 rounded-xl border bg-card p-5 sm:grid-cols-2">
          <h2 className="font-medium sm:col-span-2">Generated ICS and PAR</h2>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="s-issuer">Issued by / Received from (default)</Label>
            <NativeSelect id="s-issuer" value={d.issuer} onChange={set('issuer')}>
              <option value="">None, choose on each issuance</option>
              {officers.map((o) => <option key={o.id} value={o.id}>{o.fullName} ({o.shortName})</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">The supply officer printed as the issuer on every new form. It can still be changed on the form.</p>
          </div>
          {text('icsFormCode', 'ICS form code')}
          {text('icsFormRevision', 'ICS revision')}
          {text('parFormCode', 'PAR form code')}
          {text('parFormRevision', 'PAR revision')}
        </section>
        <div><Button type="submit" disabled={save.isPending}>Save settings</Button></div>
      </form>
    </>
  )
}
