import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QrCode, RefreshCw } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { ApiError, api } from '@/api'
import { NativeSelect } from '@/components/NativeSelect'
import { ExportButton } from '@/components/ExportButton'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { PropertySummary, PropertyTabs } from '@/components/PropertyTabs'
import { TypeBadge } from '@/components/TypeBadge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PropertyView } from '@/lib/propertyView'
import { useSettings } from '@/lib/queries'
import { useState } from 'react'

// Blank inputs mean "clear the value"; the server validates what is sent (shared propertyPatch).
type Form = { serialNo: string; oldPropertyNo: string; componentLabel: string; condition: 'serviceable' | 'unserviceable' }

function EditPanel({ view }: { view: PropertyView }) {
  const qc = useQueryClient()
  const p = view.property
  const form = useForm<Form>({
    values: { serialNo: p.serialNo ?? '', oldPropertyNo: p.oldPropertyNo ?? '', componentLabel: p.componentLabel ?? '', condition: p.condition },
  })
  const save = useMutation({
    mutationFn: (v: Form) => api.patch(`/api/properties/${encodeURIComponent(p.propertyNo)}`, {
      serialNo: v.serialNo.trim() || null, oldPropertyNo: v.oldPropertyNo.trim() || null,
      ...(p.componentLabel !== null && v.componentLabel.trim() ? { componentLabel: v.componentLabel.trim() } : {}), condition: v.condition,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['property-view', p.propertyNo] }); toast.success('Property updated') },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save'),
  })
  const field = (id: string, label: string, el: React.ReactNode) => (
    <div className="grid content-start gap-1.5"><Label htmlFor={id}>{label}</Label>{el}</div>
  )
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5" noValidate>
      {field('serialNo', 'Serial number', <Input id="serialNo" {...form.register('serialNo')} />)}
      {field('oldPropertyNo', 'Old property number', <Input id="oldPropertyNo" placeholder="Printed in count remarks" {...form.register('oldPropertyNo')} />)}
      {p.componentLabel !== null && field('componentLabel', 'Component label', <Input id="componentLabel" {...form.register('componentLabel')} />)}
      {field('condition', 'Condition', (
        <NativeSelect id="condition" className="h-8" {...form.register('condition')}>
          <option value="serviceable">Serviceable</option><option value="unserviceable">Unserviceable</option>
        </NativeSelect>
      ))}
      <div className="flex items-end"><Button type="submit" disabled={save.isPending}>Save changes</Button></div>
    </form>
  )
}

export default function PropertyDetail() {
  const { no = '' } = useParams()
  const qc = useQueryClient()
  const { data: settings } = useSettings()
  const [confirm, setConfirm] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ['property-view', no], retry: false,
    queryFn: () => api.get<PropertyView>(`/api/properties/${encodeURIComponent(no)}/view`),
  })
  const rotate = useMutation({
    mutationFn: () => api.post<{ token: string }>(`/api/properties/${encodeURIComponent(no)}/qr/rotate`),
    onSuccess: () => {
      setConfirm(false)
      qc.invalidateQueries({ queryKey: ['property-view', no] })
      toast.success('New QR code issued. The old sticker now says it was replaced.')
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not replace the QR code'),
  })

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading property</p>
  if (error || !data) {
    return <EmptyState title="Property not found" action={<Link to="/registry" className={buttonVariants()}>Back to the registry</Link>}>
      The number may be mistyped, or the item was removed.
    </EmptyState>
  }
  const { property: p, document: d, line: l } = data
  const publicUrl = p.token && settings ? `${settings.publicBaseUrl.replace(/\/+$/, '')}/q/${p.token.trim()}` : null

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Registry', to: '/registry' }, { label: p.propertyNo }]}
        title={<span className="flex flex-wrap items-center gap-3"><TypeBadge type={d.type} className="h-7 w-12 text-sm" /><span className="figures">{p.propertyNo}</span></span>}
        description={`${l.article}${p.componentLabel ? `, ${p.componentLabel}` : ''}`}
        actions={<>
          <ExportButton path={`/api/exports/${p.category === 'semi' ? 'spc' : 'pc'}?no=${encodeURIComponent(p.propertyNo)}`} label={p.category === 'semi' ? 'Export SPC' : 'Export PC'} />
          <Link to={`/stickers?nos=${encodeURIComponent(p.propertyNo)}`} className={buttonVariants({ variant: 'outline' })}><QrCode /> Print sticker</Link>
          <Button variant="outline" onClick={() => setConfirm(true)}><RefreshCw /> Replace QR code</Button>
        </>}
        meta={publicUrl && (
          <p className="text-sm text-muted-foreground">
            Scan link: <a href={publicUrl} target="_blank" rel="noreferrer" className="figures font-medium break-all text-primary underline underline-offset-2">{publicUrl}</a>
          </p>
        )}
      />
      <div className="grid gap-5 [&>*]:min-w-0">
        <PropertySummary view={data} />
        <section aria-label="Edit this property"><EditPanel view={data} /></section>
        <PropertyTabs view={data} />
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace the QR code?</DialogTitle>
            <DialogDescription>
              The sticker already on the item will stop working and show “replaced”. Print the new sticker and put it on the item.
              Use this when a sticker is lost, damaged or copied.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Keep the current code</Button>
            <Button onClick={() => rotate.mutate()} disabled={rotate.isPending}>Replace the code</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
