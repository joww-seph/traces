import {
  BookOpen, ClipboardCheck, FileText, History, KeyRound, LayoutDashboard, LogOut, Menu, QrCode, Settings, UserCog, Users, X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { cn } from '@/lib/utils'

type Item = { to: string; label: string; Icon: LucideIcon; end?: boolean }
const RECORDS: Item[] = [
  { to: '/', label: 'Dashboard', Icon: LayoutDashboard, end: true },
  { to: '/documents', label: 'ICS and PAR', Icon: FileText },
  { to: '/registry', label: 'Registry', Icon: BookOpen },
  { to: '/counts', label: 'Physical counts', Icon: ClipboardCheck },
  { to: '/stickers', label: 'Stickers', Icon: QrCode },
  { to: '/officers', label: 'Officers', Icon: Users },
]
const ADMIN: Item[] = [
  { to: '/admin/users', label: 'User accounts', Icon: UserCog },
  { to: '/admin/settings', label: 'Settings', Icon: Settings },
  { to: '/admin/audit', label: 'Audit log', Icon: History },
]
const ROLE_LABEL = { superadmin: 'Superadmin', supply_admin: 'Supply admin' } as const

function NavGroup({ title, items }: { title: string; items: Item[] }) {
  return (
    <div className="grid gap-0.5">
      <p className="px-3 pb-1 text-xs font-medium text-sidebar-foreground/80">{title}</p>
      {items.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end}
          className={({ isActive }) => cn(
            'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent hover:text-white',
            'focus-visible:outline-2 focus-visible:outline-sidebar-ring',
            isActive && 'bg-sidebar-accent font-medium text-white',
          )}>
          {({ isActive }) => (
            <>
              {/* the current page is marked with a quarter circle, the shape of the DOST mark */}
              <span aria-hidden className={cn('absolute top-1/2 -left-3 size-3 -translate-y-1/2 rounded-tr-full bg-cyan transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} />
              <Icon className="size-4 shrink-0 opacity-90" />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </div>
  )
}

function SidebarContents({ onLogout, showBrand = true }: { onLogout: () => void; showBrand?: boolean }) {
  const { user } = useAuth()
  return (
    <div className="flex h-full flex-col gap-6 px-3 py-5">
      {showBrand && <NavLink to="/" className="flex items-center gap-3 rounded-md px-3 focus-visible:outline-2 focus-visible:outline-sidebar-ring">
        <img src="/traces-logo.png" alt="" className="size-10 rounded-[3px] bg-white p-0.5" />
        <span className="grid leading-tight">
          <span className="font-display text-lg font-bold text-white">TRACES</span>
          <span className="text-xs text-sidebar-foreground/80">Supply Unit, DOST-1</span>
        </span>
      </NavLink>}

      <nav aria-label="Main" className="grid gap-6">
        <NavGroup title="Records" items={RECORDS} />
        {user?.role === 'superadmin' && <NavGroup title="Administration" items={ADMIN} />}
      </nav>

      <div className="mt-auto grid gap-3 border-t border-sidebar-border pt-4">
        <div className="grid gap-0.5 px-3">
          <span className="truncate text-sm font-medium text-white">{user?.displayName}</span>
          <span className="truncate text-xs text-sidebar-foreground/80">{user && ROLE_LABEL[user.role]}</span>
          <span className="truncate text-xs text-sidebar-foreground/80">{user?.email}</span>
        </div>
        <div className="grid gap-0.5">
          <NavLink to="/account/password" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-white">
            <KeyRound className="size-4" /> Change password
          </NavLink>
          <button type="button" onClick={onLogout} className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-white focus-visible:outline-2 focus-visible:outline-sidebar-ring">
            <LogOut className="size-4" /> Log out
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminLayout() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [location.pathname])

  const onLogout = async () => { await logout(); navigate('/login') }

  return (
    <div className="min-h-screen bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 overflow-y-auto bg-sidebar lg:block">
        <SidebarContents onLogout={onLogout} />
      </aside>

      {/* phone / tablet top bar with a slide-down menu */}
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-sidebar px-4 py-2.5 lg:hidden">
        <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-controls="mobile-nav"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          className="grid size-9 place-items-center rounded-md text-white hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-sidebar-ring">
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
        <img src="/traces-logo.png" alt="" className="size-8 rounded-[3px] bg-white p-0.5" />
        <span className="font-display text-base font-bold text-white">TRACES</span>
      </header>
      {menuOpen && (
        <div id="mobile-nav" className="fixed inset-x-0 top-14 bottom-0 z-20 overflow-y-auto bg-sidebar duration-150 animate-in fade-in slide-in-from-top-2 lg:hidden">
          <SidebarContents onLogout={onLogout} showBrand={false} />
        </div>
      )}

      <main id="main" className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
