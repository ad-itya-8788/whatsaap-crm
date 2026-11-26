import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import ProtectedRoute from './components/common/ProtectedRoute.jsx'
import { ForgotPasswordPage, InviteJoinPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/AuthPages.jsx'

const AppLayout = lazy(() => import('./components/layout/AppLayout.jsx'))
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'))
const ChatsPage = lazy(() => import('./pages/ChatsPage.jsx'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage.jsx'))
const BroadcastsPage = lazy(() => import('./pages/BroadcastsPage.jsx'))
const BroadcastWizardPage = lazy(() => import('./pages/BroadcastWizardPage.jsx'))
const BroadcastDetailPage = lazy(() => import('./pages/BroadcastDetailPage.jsx'))
const AgentsPage = lazy(() => import('./pages/AgentsPage.jsx'))
const ContactsPage = lazy(() => import('./pages/ContactsPage.jsx'))
const TemplatesPage = lazy(() => import('./pages/TemplatesPage.jsx'))
const WorkspacePage = lazy(() => import('./pages/WorkspacePage.jsx'))
const ReportsPage = lazy(() => import('./pages/ReportsPage.jsx'))
const TeamPage = lazy(() => import('./pages/TeamPage.jsx'))
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'))

function ChatsRedirect() {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const conversation = params.get('c') || params.get('conversation')
  const target = new URLSearchParams()
  const filter = params.get('filter')
  if (filter) target.set('filter', filter)
  if (conversation) target.set('c', conversation)
  const search = target.toString()
  return <Navigate to={search ? `/inbox?${search}` : '/inbox'} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/signup" element={<InviteJoinPage />} />
      <Route path="/join/:token" element={<InviteJoinPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={
          <Suspense fallback={<div className="app-loading" role="status"><span className="spinner" /> Loading workspace…</div>}>
            <AppLayout />
          </Suspense>
        }>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/inbox" element={<ChatsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/broadcasts" element={<BroadcastsPage />} />
          <Route path="/broadcasts/new" element={<BroadcastWizardPage />} />
          <Route path="/broadcasts/:id" element={<BroadcastDetailPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/chats" element={<ChatsRedirect />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/templates/create" element={<TemplatesPage />} />
          <Route path="/templates/:templateId/edit" element={<TemplatesPage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/team" element={<TeamPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
