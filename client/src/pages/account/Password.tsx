import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { changePasswordInput } from '@traces/shared'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { ApiError, api } from '@/api'
import { useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const schema = changePasswordInput
  .extend({ confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
type Form = z.infer<typeof schema>

export default function Password() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const form = useForm<Form>({ resolver: zodResolver(schema) })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      await api.post('/api/me/password', { currentPassword, newPassword })
      await qc.invalidateQueries({ queryKey: ['me'] }) // clears mustChangePassword
      toast.success('Password changed')
      navigate('/', { replace: true })
    } catch (e) {
      form.setError('root', { message: e instanceof ApiError ? e.message : 'Could not reach the server' })
    }
  })

  const field = (name: keyof Form, label: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} type="password" autoComplete={name === 'currentPassword' ? 'current-password' : 'new-password'}
        aria-invalid={!!errors[name]} {...form.register(name)} />
      {errors[name] && <p className="text-xs text-destructive">{errors[name]?.message}</p>}
    </div>
  )

  return (
    <div className="mx-auto max-w-md p-4">
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          {user?.mustChangePassword && (
            <CardDescription>You are using a temporary password. Choose a new one to continue.</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            {field('currentPassword', 'Current password')}
            {field('newPassword', 'New password (min. 10 characters)')}
            {field('confirm', 'Confirm new password')}
            {errors.root && <p role="alert" className="text-sm text-destructive">{errors.root.message}</p>}
            <Button type="submit" disabled={isSubmitting}>Change password</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
