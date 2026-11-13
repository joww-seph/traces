import { NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/documents', label: 'Documents' },
  { to: '/registry', label: 'Registry' },
  { to: '/counts', label: 'Counts' },
  { to: '/officers', label: 'Officers' },
  { to: '/stickers', label: 'Stickers' },
]
const ADMIN_NAV = [
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/settings', label: 'Settings' },
  { to: '/admin/audit', label: 'Audit' },
]

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const links = user?.role === 'superadmin' ? [...NAV, ...ADMIN_NAV] : NAV

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2">
          <NavLink to="/" aria-label="TRACES home" className="flex shrink-0 items-center gap-2 font-semibold tracking-wide text-primary">
            <img src="/traces-logo.png" alt="" className="size-7" />
            <span className="hidden sm:inline">TRACES</span>
          </NavLink>
          {/* scrolls sideways on narrow screens */}
          <nav className="flex flex-1 gap-1 overflow-x-auto" aria-label="Main">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to}
                className={({ isActive }) => cn('rounded-md px-2.5 py-1 text-sm whitespace-nowrap hover:bg-muted', isActive && 'bg-muted font-medium')}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <NavLink to="/account/password" className="hidden text-sm text-muted-foreground hover:underline sm:inline">
            {user?.displayName}
          </NavLink>
          <Button variant="outline" size="sm" onClick={async () => { await logout(); navigate('/login') }}>Log out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4">
        <Outlet />
      </main>
    </div>
  )
}
