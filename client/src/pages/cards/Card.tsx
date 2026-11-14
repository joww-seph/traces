import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { api } from '@/api'
import { ExportButton } from '@/components/ExportButton'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { CardPanel } from '@/components/PropertyTabs'
import { buttonVariants } from '@/components/ui/button'
import type { CardRow } from '@/lib/propertyView'
import { useSettings } from '@/lib/queries'

type CardView = {
  header: {
    id: string; category: 'semi' | 'ppe'; article: string; description: string; unit: string
    propertyTypeCode: string; propertyTypeName: string; propertyNoFirst: string | null; propertyNoLast: string | null
  }
  rows: CardRow[]
}

// The property card of one model: SPC for semi-expendable, PC for PPE. Every issuance of the model is a row.
export default function Card() {
  const { itemId = '' } = useParams()
  const { data: settings } = useSettings()
  const { data, isLoading, error } = useQuery({
    queryKey: ['card', itemId], retry: false,
    queryFn: () => api.get<CardView>(`/api/views/card/${encodeURIComponent(itemId)}`),
  })
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading card</p>
  if (error || !data) {
    return <EmptyState title="Card not found" action={<Link to="/cards" className={buttonVariants()}>Back to the cards</Link>}>The link may be wrong, or the card was removed.</EmptyState>
  }
  const h = data.header
  const semi = h.category === 'semi'
  const title = semi ? 'SEMI-EXPENDABLE PROPERTY CARD' : 'PROPERTY CARD'
  return (
    <>
      <PageHeader crumbs={[{ label: 'Cards', to: '/cards' }, { label: h.article }]}
        title={title} description={`${h.article} · ${h.description}`}
        actions={<ExportButton path={`/api/exports/${semi ? 'spc' : 'pc'}?itemId=${h.id}`} label={semi ? 'Export SPC' : 'Export PC'} />} />
      <CardPanel card={{
        header: {
          title, category: h.category, entityName: settings?.entityName ?? '', fundCluster: settings?.defaultFundCluster ?? '',
          article: h.article, description: h.description, typeName: h.propertyTypeName, propertyNoFirst: h.propertyNoFirst, propertyNoLast: h.propertyNoLast,
        },
        rows: data.rows, highlightRowIds: [],
      }} />
    </>
  )
}
