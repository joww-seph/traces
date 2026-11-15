import { cn } from '@/lib/utils'

// A grey placeholder in the shape of content that is still loading. Hidden from screen readers; the surrounding
// loading region carries the spoken label (see components/Loading.tsx).
// A <span> shown as a block, so it can also sit inside a <p> or a <dd> while text loads.
function Skeleton({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="skeleton" aria-hidden className={cn('block animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)} {...props} />
}

export { Skeleton }
