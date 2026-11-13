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

// The DOST Ilocos building, the region's own landmark.
function BrandPanel() {
  return (
    <section aria-label="TRACES" className="relative isolate flex min-h-[29rem] flex-col overflow-hidden bg-sky sm:min-h-[34rem] lg:min-h-screen">
      <img src="/login-bg.webp" alt="" className="absolute inset-0 -z-10 size-full object-cover object-bottom duration-700 animate-in fade-in slide-in-from-bottom-4" />

      <div className="flex flex-col gap-6 px-6 pt-8 pb-40 sm:px-10 lg:px-14 lg:pt-16 xl:px-20">
        <div className="flex items-center gap-4">
          <Dost1Mark className="h-14 w-auto lg:h-20" />
          <span aria-hidden className="h-12 w-px bg-ink/25 lg:h-16" />
          <TracesMark className="h-14 w-auto rounded-sm lg:h-20" />
        </div>
        <div className="max-w-xl">
          <h1 className="font-display text-5xl leading-none font-extrabold text-ink lg:text-7xl">TRACES</h1>
          <p className="mt-3 font-display text-lg leading-snug font-semibold text-ink/85 lg:text-2xl">
            Tagged Records of Accountable Equipment and Supplies
          </p>
          <p className="mt-4 hidden max-w-md text-[15px] leading-relaxed text-ink/70 lg:block">
            Every ICS and PAR line becomes its own property card, registry entry and QR sticker, kept by the Supply Unit of DOST Region 1.
          </p>
        </div>
      </div>
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
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <BrandPanel />

      <main className="relative flex flex-col px-6 py-10 sm:px-10 lg:px-16">
        <div className="m-auto w-full max-w-sm">
          <h2 className="text-3xl font-bold">Sign in</h2>
          <p className="mt-2 text-sm text-muted-foreground">Use the email and password the IT superadmin set up for you.</p>

          <form onSubmit={onSubmit} className="mt-8 grid gap-5" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="email">Email address</Label>
              <Input id="email" type="email" autoComplete="username" autoFocus placeholder="name@dost1.gov.ph"
                className="h-11 px-3.5 text-base" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined}
                {...form.register('email')} />
              {errors.email && <p id="email-error" className="text-sm text-destructive">Enter your email address, like name@dost1.gov.ph.</p>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                  className="h-11 pr-11 pl-3.5 text-base" aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? 'password-error' : undefined} {...form.register('password')} />
                <button type="button" onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
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

            <Button type="submit" size="lg" className="h-11 text-base" disabled={isSubmitting}>
              {isSubmitting && <LoaderCircle className="animate-spin" />}
              {isSubmitting ? 'Signing in' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-sm text-muted-foreground">
            Forgot your password? Ask the IT superadmin to reset it; there is no self-service reset.
          </p>
        </div>

        <footer className="mx-auto mt-10 flex w-full max-w-sm items-center justify-between gap-4 border-t pt-6">
          <DostIlocosLockup className="h-8 w-auto" />
          <span className="text-right text-xs text-muted-foreground">Supply Unit<br />Property records</span>
        </footer>
      </main>
    </div>
  )
}
