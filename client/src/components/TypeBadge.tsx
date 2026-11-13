import { cn } from '@/lib/utils'

// ICS (semi-expendable) and PAR (PPE) are told apart at a glance in every list.
export function TypeBadge({ type, className }: { type: 'ICS' | 'PAR'; className?: string }) {
  return (
    <span className={cn(
      'inline-flex h-6 w-11 items-center justify-center rounded-md text-xs font-semibold',
      type === 'ICS' ? 'bg-cyan/15 text-[#00739e] dark:text-cyan' : 'bg-primary/12 text-primary',
      className,
    )}>
      {type}
    </span>
  )
}
