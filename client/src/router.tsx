import { createBrowserRouter } from 'react-router'
import { RequireRole } from '@/auth/RequireRole'
import AdminLayout from '@/layouts/AdminLayout'
import Dashboard from '@/pages/Dashboard'
import Login from '@/pages/Login'
import Password from '@/pages/account/Password'
import Placeholder from '@/pages/Placeholder'

const p = (title: string) => <Placeholder title={title} />

export const router = createBrowserRouter([
  { path: '/q/:token', element: p('Property view') }, // public; built in Task 16
  { path: '/login', element: <Login /> },
  {
    element: <RequireRole roles={['supply_admin', 'superadmin']} />,
    children: [{
      element: <AdminLayout />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: 'documents', element: p('Documents') },
        { path: 'documents/new', element: p('New ICS/PAR') },
        { path: 'documents/:id', element: p('Document') },
        { path: 'documents/:id/lines/new', element: p('New line') },
        { path: 'lines/:lineId/edit', element: p('Edit line') },
        { path: 'properties/:no', element: p('Property') },
        { path: 'registry', element: p('Registry') },
        { path: 'cards/:no', element: p('Card') },
        { path: 'counts', element: p('Physical counts') },
        { path: 'counts/:id', element: p('Physical count') },
        { path: 'officers', element: p('Officers') },
        { path: 'stickers', element: p('Stickers') },
        { path: 'account/password', element: <Password /> },
        {
          element: <RequireRole roles={['superadmin']} />,
          children: [
            { path: 'admin/users', element: p('Users') },
            { path: 'admin/settings', element: p('Settings') },
            { path: 'admin/audit', element: p('Audit log') },
          ],
        },
      ],
    }],
  },
])
