import { cn } from '@/lib/utils'

// Light and dark versions of every brand asset live side by side in /public (*-dark.png for dark mode).
export function ThemedImg({ name, ext = 'png', alt, className }: { name: string; ext?: string; alt: string; className?: string }) {
  return (
    <>
      <img src={`/${name}.${ext}`} alt={alt} className={cn('dark:hidden', className)} />
      <img src={`/${name}-dark.${ext}`} alt={alt} className={cn('hidden dark:block', className)} />
    </>
  )
}

export const TracesMark = ({ className }: { className?: string }) => <ThemedImg name="traces-logo" alt="" className={className} />
export const Dost1Mark = ({ className }: { className?: string }) => <ThemedImg name="dost1-logo" alt="DOST-1" className={className} />
export const DostIlocosLockup = ({ className }: { className?: string }) => (
  <ThemedImg name="dost-ilocos" alt="DOST Ilocos Region" className={className} />
)
