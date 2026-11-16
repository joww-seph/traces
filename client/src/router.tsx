import { createBrowserRouter, Navigate, useParams } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
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
import LineForm from '@/pages/lines/LineForm'
import Officers from '@/pages/officers/List'
import Units from '@/pages/units/Units'
import Card from '@/pages/cards/Card'
import Cards from '@/pages/cards/List'
import IssueForm from '@/pages/issue/IssueForm'
import Reports from '@/pages/reports/Reports'
import PropertyTypes from '@/pages/types/PropertyTypes'
import PropertyDetail from '@/pages/properties/Detail'
import QrView from '@/pages/public/QrView'
import Registry from '@/pages/registry/Registry'
import StickerSheet from '@/pages/stickers/StickerSheet'

// the old entry addresses open the issuance form on that document
function ToIssue() {
  const { id } = useParams()
  return <Navigate to={id ? `/issue?documentId=${id}` : '/issue'} replace />
}

// the IT officer starts on the accounts page; the dashboard is about the records
function Home() {
  return useAuth().user?.role === 'superadmin' ? <Navigate to="/admin/users" replace /> : <Dashboard />
}

export const router = createBrowserRouter([
  { path: '/q/:token', element: <QrView /> }, // public, no login
  { path: '/login', element: <Login /> },
  {
    element: <RequireRole roles={['supply_admin', 'superadmin']} />,
    children: [{
      element: <AdminLayout />,
      children: [
        { index: true, element: <Home /> },
        { path: 'account/password', element: <Password /> },
        {
          element: <RequireRole roles={['supply_admin']} />, // least privilege: the IT officer does not touch the records
          children: [
            { path: 'documents', element: <Documents /> },
            { path: 'issue', element: <IssueForm /> },
            { path: 'documents/new', element: <Navigate to="/issue" replace /> },
            { path: 'documents/:id', element: <DocumentDetail /> },
            { path: 'documents/:id/entry', element: <ToIssue /> },
            { path: 'documents/:id/lines/new', element: <ToIssue /> },
            { path: 'lines/:lineId/edit', element: <LineForm /> },
            { path: 'properties/:no', element: <PropertyDetail /> },
            { path: 'registry', element: <Registry /> },
            { path: 'cards', element: <Cards /> },
            { path: 'cards/:itemId', element: <Card /> },
            { path: 'reports', element: <Reports /> },
            { path: 'stickers', element: <StickerSheet /> },
          ],
        },
        {
          element: <RequireRole roles={['superadmin']} />,
          children: [
            { path: 'officers', element: <Officers /> }, // kept by the IT officer
            { path: 'property-types', element: <PropertyTypes /> },
            { path: 'units', element: <Units /> },
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
