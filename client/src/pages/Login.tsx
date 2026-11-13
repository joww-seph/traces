import { zodResolver } from '@hookform/resolvers/zod'
import { loginInput } from '@traces/shared'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation, useNavigate } from 'react-router'
import type { z } from 'zod'
import { ApiError } from '@/api'
import { useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Form = z.infer<typeof loginInput>

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/'
  const form = useForm<Form>({ resolver: zodResolver(loginInput) })
  const { errors, isSubmitting } = form.formState

  if (user) return <Navigate to={user.mustChangePassword ? '/account/password' : from} replace />

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const u = await login(values.email, values.password)
      navigate(u.mustChangePassword ? '/account/password' : from, { replace: true })
    } catch (e) {
      form.setError('root', { message: e instanceof ApiError ? e.message : 'Could not reach the server' })
    }
  })

  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="justify-items-center text-center">
          <img src="/traces-logo.png" alt="" className="mb-2 size-24" />
          <CardTitle className="text-xl tracking-wide">TRACES</CardTitle>
          <CardDescription>Tagged Records of Accountable Equipment and Supplies</CardDescription>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <img src="/dost-logo.png" alt="DOST" className="h-7 w-auto" />
            <span className="text-left leading-tight">Supply Unit<br />DOST Region 1</span>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" autoFocus aria-invalid={!!errors.email} {...form.register('email')} />
              {errors.email && <p className="text-xs text-destructive">Enter a valid email</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...form.register('password')} />
              {errors.password && <p className="text-xs text-destructive">Enter your password</p>}
            </div>
            {errors.root && <p role="alert" className="text-sm text-destructive">{errors.root.message}</p>}
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
