import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'Match device', Icon: Monitor },
] as const

// Three-way switch: light, dark, or follow the device setting.
export function ThemeToggle({ className, tone = 'default' }: { className?: string; tone?: 'default' | 'sidebar' }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div role="radiogroup" aria-label="Colour theme"
      className={cn('inline-flex rounded-md p-0.5', tone === 'sidebar' ? 'bg-white/8' : 'bg-muted', className)}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mounted && theme === value
        return (
          <button key={value} type="button" role="radio" aria-checked={active} aria-label={label} title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'grid size-7 place-items-center rounded-[5px] transition-colors focus-visible:outline-2 focus-visible:outline-ring',
              tone === 'sidebar'
                ? active ? 'bg-white/15 text-white' : 'text-sidebar-foreground/70 hover:text-white'
                : active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}>
            <Icon className="size-3.5" />
          </button>
        )
      })}
    </div>
  )
}
