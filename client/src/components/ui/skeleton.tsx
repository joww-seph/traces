import { cn } from '@/lib/utils'

// A grey placeholder in the shape of content that is still loading. Hidden from screen readers; the surrounding
// loading region carries the spoken label (see components/Loading.tsx).
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" aria-hidden className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)} {...props} />
}

export { Skeleton }
