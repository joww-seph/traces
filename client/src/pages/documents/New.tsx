import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { documentMeta, nonEmpty } from '@traces/shared'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import type { z } from 'zod'
import { ApiError, api } from '@/api'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
    if (!file) return setFileError('Attach the signed ICS/PAR PDF')
    setFileError('')
    create.mutate(v)
  })

  const err = (name: keyof Form) => errors[name] && <p className="text-xs text-destructive">{errors[name]?.message as string}</p>
  const officerOptions = (<><option value="">Select officer…</option>{officers.map((o) => <option key={o.id} value={o.id}>{o.shortName} — {o.fullName}</option>)}</>)

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader><CardTitle>New ICS / PAR</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
            <div className="grid gap-1.5">
              <Label htmlFor="type">Type</Label>
              <NativeSelect id="type" {...form.register('type')}><option value="ICS">ICS (semi-expendable)</option><option value="PAR">PAR (PPE)</option></NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="docNo">Document number</Label>
              <Input id="docNo" placeholder="2026-03SARAi-005" aria-invalid={!!errors.docNo} {...form.register('docNo')} />
              {err('docNo')}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fundCluster">Fund cluster</Label>
              <Input id="fundCluster" aria-invalid={!!errors.fundCluster} {...form.register('fundCluster')} />
              {err('fundCluster')}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="issuedDate">Date issued</Label>
              <Input id="issuedDate" type="date" aria-invalid={!!errors.issuedDate} {...form.register('issuedDate')} />
              {err('issuedDate')}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="issuedBy">Issued by</Label>
              <NativeSelect id="issuedBy" aria-invalid={!!errors.issuedByOfficerId} {...pickOfficer('issuedByOfficerId', 'issuedByPosition')}>{officerOptions}</NativeSelect>
              {err('issuedByOfficerId')}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="issuedByPosition">Position as printed</Label>
              <Input id="issuedByPosition" aria-invalid={!!errors.issuedByPosition} {...form.register('issuedByPosition')} />
              {err('issuedByPosition')}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="receivedBy">Received by (accountable officer)</Label>
              <NativeSelect id="receivedBy" aria-invalid={!!errors.receivedByOfficerId} {...pickOfficer('receivedByOfficerId', 'receivedByPosition')}>{officerOptions}</NativeSelect>
              {err('receivedByOfficerId')}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="receivedByPosition">Position as printed</Label>
              <Input id="receivedByPosition" aria-invalid={!!errors.receivedByPosition} {...form.register('receivedByPosition')} />
              {err('receivedByPosition')}
            </div>

            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="purpose">Purpose / remarks</Label>
              <Textarea id="purpose" rows={2} {...form.register('purpose')} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="pdf">Signed ICS/PAR (PDF, max 20 MB)</Label>
              <Input id="pdf" type="file" accept="application/pdf" aria-invalid={!!fileError}
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setFileError('') }} />
              {fileError && <p className="text-xs text-destructive">{fileError}</p>}
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => navigate('/documents')}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Uploading…' : 'Save and add lines'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
