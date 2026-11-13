import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

// A native <select> styled like <Input>: reliable with react-hook-form and best on phones.
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors',
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
