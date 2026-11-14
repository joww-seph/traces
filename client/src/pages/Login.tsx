import { zodResolver } from '@hookform/resolvers/zod'
import { loginInput } from '@traces/shared'
import { Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation, useNavigate } from 'react-router'
import type { z } from 'zod'
import { ApiError } from '@/api'
import { useAuth } from '@/auth/AuthProvider'
import { Dost1Mark, DostIlocosLockup, TracesMark } from '@/components/Brand'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Form = z.infer<typeof loginInput>

// Logos, wordmark and full name, centred. Sized up on the desktop panel, compact on phones.
function BrandBlock({ large }: { large?: boolean }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className={large ? 'flex items-center gap-5' : 'flex items-center gap-3'}>
        <Dost1Mark className={large ? 'h-24 w-auto' : 'h-14 w-auto'} />
        <span aria-hidden className={large ? 'h-16 w-px bg-ink/25' : 'h-10 w-px bg-ink/20'} />
        <TracesMark className={large ? 'h-24 w-auto rounded-sm' : 'h-14 w-auto rounded-sm'} />
      </div>
      <h1 className={large ? 'mt-8 text-7xl leading-none font-extrabold text-ink' : 'mt-4 text-4xl leading-none font-extrabold text-ink'}>TRACES</h1>
      <p className={large ? 'mt-4 max-w-md text-2xl leading-snug font-semibold text-ink/85' : 'mt-2 max-w-xs text-sm leading-snug font-semibold text-ink/70'}>
        Tagged Records of Accountable Equipment and Supplies
      </p>
    </div>
  )
}

// Desktop only: the DOST Ilocos building spans the narrow left panel, at its bottom. Phones skip the illustration so the form is reachable at once.
function BrandPanel() {
  return (
    <section aria-label="TRACES" className="relative isolate hidden min-h-screen items-center justify-center overflow-hidden bg-[#baccd8] px-10 pb-[25vh] lg:flex">
      {/* the whole art, proportions kept, as wide as the narrow brand panel; only its top (plain sky) fades */}
      <img src="/login-bg.webp" alt="" style={{ maskImage: 'linear-gradient(to bottom, transparent, #000 25%)', clipPath: 'inset(0 2px 0 0)' }}
        className="absolute inset-x-0 bottom-0 -z-10 h-auto w-full duration-700 animate-in fade-in" />
      <BrandBlock large />
    </section>
  )
}

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/'
  const [showPassword, setShowPassword] = useState(false)
  const form = useForm<Form>({ resolver: zodResolver(loginInput) })
  const { errors, isSubmitting } = form.formState

  if (user) return <Navigate to={user.mustChangePassword ? '/account/password' : from} replace />

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const u = await login(values.email, values.password)
      navigate(u.mustChangePassword ? '/account/password' : from, { replace: true })
    } catch (e) {
      form.setError('root', {
        message: e instanceof ApiError
          ? e.status === 429 ? 'Too many attempts. Wait 15 minutes, then try again.' : e.message
          : 'The server could not be reached. Check your connection and try again.',
      })
    }
  })

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)]">
      <BrandPanel />

      <main className="relative flex min-h-dvh flex-col px-5 pt-8 pb-6 sm:px-10 lg:px-16 lg:py-10">
        <div className="m-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden"><BrandBlock /></div>
          <h2 className="text-2xl font-bold lg:text-3xl">Sign in</h2>
          <p className="mt-2 text-sm text-muted-foreground">Use the email and password the IT superadmin set up for you.</p>

          <form onSubmit={onSubmit} className="mt-8 grid gap-5" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="email">Email address</Label>
              <Input id="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
                autoFocus={typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches} placeholder="name@dost1.gov.ph"
                className="h-12 px-3.5 text-base" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined}
                {...form.register('email')} />
              {errors.email && <p id="email-error" className="text-sm text-destructive">Enter your email address, like name@dost1.gov.ph.</p>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                  className="h-12 pr-12 pl-3.5 text-base" enterKeyHint="go" aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? 'password-error' : undefined} {...form.register('password')} />
                <button type="button" onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {errors.password && <p id="password-error" className="text-sm text-destructive">Enter your password.</p>}
            </div>

            {errors.root && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/8 px-3.5 py-2.5 text-sm text-destructive">
                {errors.root.message}
              </p>
            )}

            <Button type="submit" size="lg" className="h-12 text-base" disabled={isSubmitting}>
              {isSubmitting && <LoaderCircle className="animate-spin" />}
              {isSubmitting ? 'Signing in' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-sm text-muted-foreground">
            Forgot your password? Ask the IT superadmin to reset it; there is no self-service reset.
          </p>
        </div>

        <footer className="mx-auto mt-8 flex w-full max-w-sm justify-center border-t pt-5">
          <DostIlocosLockup className="h-8 w-auto" />
        </footer>
      </main>
    </div>
  )
}
