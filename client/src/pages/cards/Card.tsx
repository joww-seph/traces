import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { ApiError, api } from '@/api'
import { ExportButton } from '@/components/ExportButton'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { CardPanel } from '@/components/PropertyTabs'
import { buttonVariants } from '@/components/ui/button'
import type { CardRow } from '@/lib/propertyView'
import { useSettings } from '@/lib/queries'
import { PageSkeleton } from '@/components/Loading'

type CardView = {
  header: {
    id: string; propertyNo: string; category: 'semi' | 'ppe'; article: string; description: string; unit: string
    propertyTypeCode: string; propertyTypeName: string; documentId: string; docType: 'ICS' | 'PAR'; docNo: string
    components: { propertyNo: string; label: string; serialNo: string | null }[]
  }
  rows: CardRow[]
}

// The card of one property (decision 2026-11-18): SPC for semi-expendable, PC for PPE. Its issuance is the first row;
// the Remarks of each row can be typed here (for later transfers).
export default function Card() {
  const { propertyId = '' } = useParams()
  const qc = useQueryClient()
  const { data: settings } = useSettings()
  const { data, isLoading, error } = useQuery({
    queryKey: ['card', propertyId], retry: false,
    queryFn: () => api.get<CardView>(`/api/views/card/${encodeURIComponent(propertyId)}`),
  })
  const remarks = useMutation({
    mutationFn: (v: { rowId: string; remarks: string }) => api.patch(`/api/views/card-rows/${v.rowId}`, { remarks: v.remarks }),
    onSuccess: () => { toast.success('Remarks saved'); qc.invalidateQueries({ queryKey: ['card', propertyId] }) },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the remarks'),
  })
  if (isLoading) return <PageSkeleton label="Loading the card" />
  if (error || !data) {
    return <EmptyState title="Card not found" action={<Link to="/cards" className={buttonVariants()}>Back to the cards</Link>}>The link may be wrong, or the property was removed.</EmptyState>
  }
  const h = data.header
  const semi = h.category === 'semi'
  const title = semi ? 'SEMI-EXPENDABLE PROPERTY CARD' : 'PROPERTY CARD'
  return (
    <>
      <PageHeader crumbs={[{ label: 'Cards', to: '/cards' }, { label: h.propertyNo }]}
        title={title} description={`${h.propertyNo} · ${h.article}${h.components.length ? ` · with ${h.components.map((c) => `${c.label} (${c.propertyNo})`).join(', ')}` : ''}`}
        actions={<>
          <Link to={`/documents/${h.documentId}`} className={buttonVariants({ variant: 'outline' })}><ExternalLink /> Open {h.docType} {h.docNo}</Link>
          <ExportButton path={`/api/exports/${semi ? 'spc' : 'pc'}?cardId=${h.id}`} label={semi ? 'Export SPC' : 'Export PC'} />
        </>} />
      <CardPanel onRemarks={(rowId, value) => remarks.mutate({ rowId, remarks: value })} card={{
        header: {
          title, category: h.category, entityName: settings?.entityName ?? '', fundCluster: settings?.defaultFundCluster ?? '',
          article: h.article, description: h.description, typeName: h.propertyTypeName, propertyNo: h.propertyNo,
        },
        rows: data.rows, highlightRowIds: [],
      }} />
    </>
  )
}
