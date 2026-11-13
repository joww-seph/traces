import { EmptyState, PageHeader } from '@/components/PageHeader'

// Stand-in for pages built in later tasks.
export default function Placeholder({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title="Not built yet">This page arrives in a later release of TRACES.</EmptyState>
    </>
  )
}
