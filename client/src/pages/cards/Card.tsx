import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { api } from '@/api'
import { ExportButton } from '@/components/ExportButton'
import { CardPanel } from '@/components/PropertyTabs'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { buttonVariants } from '@/components/ui/button'
import type { PropertyView } from '@/lib/propertyView'

// The full property card of one item: SPC for semi-expendable, PC for PPE.
export default function Card() {
  const { no = '' } = useParams()
  const { data, isLoading, error } = useQuery({
    queryKey: ['property-view', no], retry: false,
    queryFn: () => api.get<PropertyView>(`/api/properties/${encodeURIComponent(no)}/view`),
  })
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading card</p>
  if (error || !data) {
    return <EmptyState title="Card not found" action={<Link to="/registry" className={buttonVariants()}>Back to the registry</Link>}>The property number may be mistyped.</EmptyState>
  }
  return (
    <>
      <PageHeader crumbs={[{ label: 'Registry', to: '/registry' }, { label: data.property.propertyNo, to: `/properties/${encodeURIComponent(data.property.propertyNo)}` }, { label: 'Card' }]}
        title={data.tabs.card.header.title} description={`${data.line.article} · ${data.property.propertyNo}`}
        actions={<ExportButton path={`/api/exports/${data.property.category === 'semi' ? 'spc' : 'pc'}?no=${encodeURIComponent(data.property.propertyNo)}`} label={data.property.category === 'semi' ? 'Export SPC' : 'Export PC'} />} />
      <CardPanel view={data} />
    </>
  )
}
