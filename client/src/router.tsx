import { createBrowserRouter } from 'react-router'
import { RequireRole } from '@/auth/RequireRole'
import AdminLayout from '@/layouts/AdminLayout'
import Dashboard from '@/pages/Dashboard'
import Login from '@/pages/Login'
import NotFound from '@/pages/NotFound'
import Password from '@/pages/account/Password'
import Audit from '@/pages/admin/Audit'
import SettingsPage from '@/pages/admin/Settings'
import Users from '@/pages/admin/Users'
import DocumentDetail from '@/pages/documents/Detail'
import Documents from '@/pages/documents/List'
import NewDocument from '@/pages/documents/New'
import LineForm from '@/pages/lines/LineForm'
import Officers from '@/pages/officers/List'
import Card from '@/pages/cards/Card'
import CountDetail from '@/pages/counts/Detail'
import Counts from '@/pages/counts/List'
import PropertyDetail from '@/pages/properties/Detail'
import QrView from '@/pages/public/QrView'
import Registry from '@/pages/registry/Registry'
import StickerSheet from '@/pages/stickers/StickerSheet'

export const router = createBrowserRouter([
  { path: '/q/:token', element: <QrView /> }, // public, no login
  { path: '/login', element: <Login /> },
  {
    element: <RequireRole roles={['supply_admin', 'superadmin']} />,
    children: [{
      element: <AdminLayout />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: 'documents', element: <Documents /> },
        { path: 'documents/new', element: <NewDocument /> },
        { path: 'documents/:id', element: <DocumentDetail /> },
        { path: 'documents/:id/lines/new', element: <LineForm /> },
        { path: 'lines/:lineId/edit', element: <LineForm /> },
        { path: 'properties/:no', element: <PropertyDetail /> },
        { path: 'registry', element: <Registry /> },
        { path: 'cards/:no', element: <Card /> },
        { path: 'counts', element: <Counts /> },
        { path: 'counts/:id', element: <CountDetail /> },
        { path: 'officers', element: <Officers /> },
        { path: 'stickers', element: <StickerSheet /> },
        { path: 'account/password', element: <Password /> },
        {
          element: <RequireRole roles={['superadmin']} />,
          children: [
            { path: 'admin/users', element: <Users /> },
            { path: 'admin/settings', element: <SettingsPage /> },
            { path: 'admin/audit', element: <Audit /> },
          ],
        },
        { path: '*', element: <NotFound /> },
      ],
    }],
  },
])
