import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// A titled block of a long form: what the fields are for on the left, the fields on the right.
export function FormSection({ title, hint, children, className }: { title: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('grid gap-x-10 gap-y-4 border-b py-6 first:pt-0 last:border-b-0 md:grid-cols-[14rem_1fr]', className)}>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
      <div className="grid content-start gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

export function Field({ label, htmlFor, error, hint, children, wide }: {
  label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode; wide?: boolean
}) {
  return (
    <div className={cn('grid content-start gap-1.5', wide && 'sm:col-span-2')}>
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
