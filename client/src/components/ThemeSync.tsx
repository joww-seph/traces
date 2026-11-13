import { useTheme } from 'next-themes'
import { useEffect } from 'react'

// AG Grid reads its light/dark parameter set from data-ag-theme-mode; keep it in step with next-themes.
export function ThemeSync() {
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    document.documentElement.dataset.agThemeMode = resolvedTheme === 'dark' ? 'dark' : 'light'
  }, [resolvedTheme])
  return null
}
