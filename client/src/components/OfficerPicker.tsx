import { Check, ChevronsUpDown } from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import type { Officer } from '@/lib/queries'
import { cn } from '@/lib/utils'

type Props = {
  id: string
  officers: Officer[]
  value: string
  onChange: (officer: Officer | null) => void
  placeholder?: string
  noneLabel?: string
  invalid?: boolean
  className?: string
}

const label = (o: Officer) => `${o.fullName} (${o.shortName})`
const haystack = (o: Officer) => [o.fullName, o.shortName, o.position, o.office, ...o.designations].join(' ').toLowerCase()

export function OfficerPicker({ id, officers, value, onChange, placeholder = 'Type a name or program, e.g. SARAi', noneLabel, invalid, className }: Props) {
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const chosen = officers.find((o) => o.id === value)

  const matches = useMemo(() => {
    const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    return officers.filter((o) => words.every((w) => haystack(o).includes(w)))
  }, [officers, query])
  const options: (Officer | null)[] = noneLabel && !query ? [null, ...matches] : matches

  const pick = (o: Officer | null) => { onChange(o); setQuery(null); setOpen(false) }
  const move = (d: number) => { setOpen(true); setActive((a) => (options.length ? (a + d + options.length) % options.length : 0)) }

  return (
    <div className={cn('relative', className)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setOpen(false); setQuery(null) } }}>
      <Input ref={input} id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-invalid={invalid || undefined}
        aria-activedescendant={open && options[active] !== undefined ? `${listId}-${active}` : undefined}
        className="h-9 pr-9" autoComplete="off" placeholder={chosen ? undefined : placeholder}
        value={query ?? (chosen ? label(chosen) : '')}
        onFocus={(e) => { setOpen(true); setActive(0); e.currentTarget.select() }}
        onClick={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
          else if (e.key === 'Enter' && open && options[active] !== undefined) { e.preventDefault(); pick(options[active]) }
          else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQuery(null) }
        }} />
      <ChevronsUpDown aria-hidden className="pointer-events-none absolute top-2.5 right-3 size-4 text-muted-foreground" />
      {open && (
        <ul id={listId} role="listbox" aria-label="Officers"
          className="absolute inset-x-0 top-10 z-50 max-h-72 overflow-auto rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/5">
          {options.map((o, i) => (
            <li key={o?.id ?? 'none'} id={`${listId}-${i}`} role="option" aria-selected={(o?.id ?? '') === value}
              className={cn('flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5', i === active && 'bg-accent')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}>
              <Check aria-hidden className={cn('mt-0.5 size-4 shrink-0', (o?.id ?? '') === value ? 'text-primary' : 'invisible')} />
              {o ? (
                <span className="min-w-0">
                  <span className="font-medium">{o.fullName}</span> <span className="text-muted-foreground">({o.shortName}){o.active ? '' : ', inactive'}</span>
                  <span className="block text-xs text-muted-foreground">{[o.position, o.designations[0]].filter(Boolean).join(' · ')}</span>
                </span>
              ) : <span className="text-muted-foreground">{noneLabel}</span>}
            </li>
          ))}
          {!options.length && <li className="px-2 py-1.5 text-muted-foreground">No officer matches “{query}”.</li>}
        </ul>
      )}
    </div>
  )
}
