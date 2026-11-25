import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/common/ProtectedRoute.jsx'
import AppLayout from './components/layout/AppLayout.jsx'
import { LoginPage, RegisterPage } from './pages/AuthPages.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import ChatsPage from './pages/ChatsPage.jsx'
import NotificationsPage from './pages/NotificationsPage.jsx'
import BroadcastsPage from './pages/BroadcastsPage.jsx'
import BroadcastWizardPage from './pages/BroadcastWizardPage.jsx'
import BroadcastDetailPage from './pages/BroadcastDetailPage.jsx'
import AgentsPage from './pages/AgentsPage.jsx'
import AutomationsPage from './pages/AutomationsPage.jsx'
import AutomationEditorPage from './pages/AutomationEditorPage.jsx'
import AutomationLogsPage from './pages/AutomationLogsPage.jsx'
import FlowsPage from './pages/FlowsPage.jsx'
import FlowEditorPage from './pages/FlowEditorPage.jsx'
import FlowRunsPage from './pages/FlowRunsPage.jsx'
import ContactsPage from './pages/ContactsPage.jsx'
import TemplatesPage from './pages/TemplatesPage.jsx'
import WorkspacePage from './pages/WorkspacePage.jsx'
import ReportsPage from './pages/ReportsPage.jsx'
import TeamPage from './pages/TeamPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/inbox" element={<ChatsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/broadcasts" element={<BroadcastsPage />} />
          <Route path="/broadcasts/new" element={<BroadcastWizardPage />} />
          <Route path="/broadcasts/:id" element={<BroadcastDetailPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/automations/new" element={<AutomationEditorPage />} />
          <Route path="/automations/:id/edit" element={<AutomationEditorPage />} />
          <Route path="/automations/:id/logs" element={<AutomationLogsPage />} />
          <Route path="/flows" element={<FlowsPage />} />
          <Route path="/flows/:id/edit" element={<FlowEditorPage />} />
          <Route path="/flows/:id/runs" element={<FlowRunsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/chats" element={<Navigate to="/inbox" replace />} />
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
