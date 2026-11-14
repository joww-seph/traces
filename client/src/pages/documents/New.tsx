import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { documentMeta, formatLongDate, isIsoDate, nonEmpty } from '@traces/shared'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import type { z } from 'zod'
import { ApiError, api } from '@/api'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FileUp } from 'lucide-react'
import { Field, FormSection } from '@/components/FormSection'
import { PageHeader } from '@/components/PageHeader'
import { Textarea } from '@/components/ui/textarea'
import { useOfficers, useSettings } from '@/lib/queries'

// Positions are required here: the admin sees (and may edit) what will be printed on the form.
const schema = documentMeta.extend({ issuedByPosition: nonEmpty, receivedByPosition: nonEmpty })
type Form = z.input<typeof schema>

export default function NewDocument() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: officers = [] } = useOfficers(true)
  const { data: settings } = useSettings()
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { type: 'ICS', purpose: '' } })
  const { errors } = form.formState
  const { watch } = form

  useEffect(() => {
    if (settings && !form.getValues('fundCluster')) form.setValue('fundCluster', settings.defaultFundCluster)
  }, [settings, form])

  const pickOfficer = (idField: 'issuedByOfficerId' | 'receivedByOfficerId', posField: 'issuedByPosition' | 'receivedByPosition') => ({
    ...form.register(idField),
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
      form.setValue(idField, e.target.value, { shouldValidate: true })
      form.setValue(posField, officers.find((o) => o.id === e.target.value)?.position ?? '', { shouldValidate: true })
    },
  })

  const create = useMutation({
    mutationFn: (v: Form) => {
      const body = new FormData()
      body.append('meta', JSON.stringify(v))
      body.append('pdf', file!)
      return api.post<{ id: string }>('/api/documents', body)
    },
    onSuccess: (doc) => { qc.invalidateQueries({ queryKey: ['documents'] }); toast.success('Document saved'); navigate(`/documents/${doc.id}`) },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'DUPLICATE_DOCUMENT_NO') form.setError('docNo', { message: e.message })
      else if (e instanceof ApiError && e.code === 'INVALID_PDF') setFileError(e.message)
      else toast.error(e instanceof ApiError ? e.message : 'Could not save')
    },
  })

  const onSubmit = form.handleSubmit((v) => {
    if (!file) return setFileError('Attach the signed PDF of this form.')
    setFileError('')
    create.mutate(v)
  })

  const msg = (name: keyof Form) => errors[name]?.message as string | undefined
  const isIcs = watch('type') === 'ICS'
  const officerOptions = (<><option value="">Choose an officer</option>{officers.map((o) => <option key={o.id} value={o.id}>{o.fullName} ({o.shortName})</option>)}</>)

  return (
    <>
      <PageHeader title="New ICS or PAR" crumbs={[{ label: 'ICS and PAR', to: '/documents' }, { label: 'New' }]}
        description="Enter the header exactly as printed on the signed form, attach its PDF, then add the lines." />
      <form onSubmit={onSubmit} noValidate className="rounded-xl border bg-card px-5 py-6 sm:px-8">
        <FormSection title="Document" hint="ICS for semi-expendable items, PAR for property, plant and equipment.">
          <Field label="Type" htmlFor="type">
            <NativeSelect id="type" className="h-9" {...form.register('type')}>
              <option value="ICS">ICS, Inventory Custodian Slip</option><option value="PAR">PAR, Property Acknowledgment Receipt</option>
            </NativeSelect>
          </Field>
          <Field label={isIcs ? 'ICS number' : 'PAR number'} htmlFor="docNo" error={msg('docNo')}>
            <Input id="docNo" className="figures h-9" placeholder={isIcs ? '2026-03SARAi-005' : '2025-RO-68'} aria-invalid={!!errors.docNo} {...form.register('docNo')} />
          </Field>
          <Field label="Fund cluster" htmlFor="fundCluster" error={msg('fundCluster')}>
            <Input id="fundCluster" className="h-9" aria-invalid={!!errors.fundCluster} {...form.register('fundCluster')} />
          </Field>
          <Field label="Date issued" htmlFor="issuedDate" error={msg('issuedDate')}
            hint={(() => { const d = watch('issuedDate'); return d && isIsoDate(d) ? formatLongDate(d) : undefined })()}>
            <Input id="issuedDate" type="date" className="h-9" aria-invalid={!!errors.issuedDate} {...form.register('issuedDate')} />
          </Field>
        </FormSection>

        <FormSection title="Signatories" hint="Positions fill in from the officer list. Change them if the form printed something else.">
          <Field label={isIcs ? 'Received from (Supply Unit)' : 'Issued by (property custodian)'} htmlFor="issuedBy" error={msg('issuedByOfficerId')}>
            <NativeSelect id="issuedBy" className="h-9" aria-invalid={!!errors.issuedByOfficerId} {...pickOfficer('issuedByOfficerId', 'issuedByPosition')}>{officerOptions}</NativeSelect>
          </Field>
          <Field label="Position as printed" htmlFor="issuedByPosition" error={msg('issuedByPosition')}>
            <Input id="issuedByPosition" className="h-9" aria-invalid={!!errors.issuedByPosition} {...form.register('issuedByPosition')} />
          </Field>
          <Field label="Received by (accountable officer)" htmlFor="receivedBy" error={msg('receivedByOfficerId')}>
            <NativeSelect id="receivedBy" className="h-9" aria-invalid={!!errors.receivedByOfficerId} {...pickOfficer('receivedByOfficerId', 'receivedByPosition')}>{officerOptions}</NativeSelect>
          </Field>
          <Field label="Position as printed" htmlFor="receivedByPosition" error={msg('receivedByPosition')}>
            <Input id="receivedByPosition" className="h-9" aria-invalid={!!errors.receivedByPosition} {...form.register('receivedByPosition')} />
          </Field>
          {!officers.length && (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              No officers yet. <Link to="/officers" className="font-medium text-primary underline underline-offset-2">Add officers</Link> first.
            </p>
          )}
        </FormSection>

        <FormSection title="Purpose" hint="Shown as the remarks column of the registry.">
          <Field label="Purpose or remarks" htmlFor="purpose" wide>
            <Textarea id="purpose" rows={2} placeholder="ICT equipment for SARAi staff operations" {...form.register('purpose')} />
          </Field>
        </FormSection>

        <FormSection title="Signed copy" hint="The scanned, signed form. PDF only, up to 20 MB.">
          <Field label="PDF file" htmlFor="pdf" error={fileError || undefined} wide>
            <label htmlFor="pdf" className={`flex cursor-pointer items-center gap-4 rounded-lg border border-dashed px-4 py-5 transition-colors hover:bg-accent/50 ${fileError ? 'border-destructive' : 'border-input'}`}>
              <FileUp aria-hidden className="size-6 shrink-0 text-primary" />
              <span className="grid min-w-0 text-sm">
                <span className="truncate font-medium">{file ? file.name : 'Choose the signed PDF'}</span>
                <span className="text-muted-foreground">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'Click to browse your files'}</span>
              </span>
            </label>
            <input id="pdf" type="file" accept="application/pdf" className="sr-only" aria-invalid={!!fileError}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setFileError('') }} />
          </Field>
        </FormSection>

        <div className="flex justify-end gap-2 border-t pt-6">
          <Button type="button" variant="outline" onClick={() => navigate('/documents')}>Cancel</Button>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Uploading' : 'Save and add lines'}</Button>
        </div>
      </form>
    </>
  )
}
