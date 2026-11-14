import { Link } from 'react-router'
import { EmptyState } from '@/components/PageHeader'
import { buttonVariants } from '@/components/ui/button'

export default function NotFound() {
  return (
    <EmptyState title="Page not found" action={<Link to="/" className={buttonVariants()}>Go to the dashboard</Link>}>
      This address does not exist. Check the link, or use the menu.
    </EmptyState>
  )
}
