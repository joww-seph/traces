import { Navigate, Outlet, useLocation } from 'react-router'
import type { Role } from '@/api'
import { useAuth } from './AuthProvider'

// Layout route: renders its children only for a logged-in user with one of `roles`.
export function RequireRole({ roles }: { roles: Role[] }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.mustChangePassword && location.pathname !== '/account/password') {
    return <Navigate to="/account/password" replace />
  }
  if (!roles.includes(user.role)) {
    return <p className="p-6 text-sm text-destructive">You do not have access to this page.</p>
  }
  return <Outlet />
}
