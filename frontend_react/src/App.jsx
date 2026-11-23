import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/common/ProtectedRoute.jsx'
import AppLayout from './components/layout/AppLayout.jsx'
import { LoginPage, RegisterPage } from './pages/AuthPages.jsx'
import ChatsPage from './pages/ChatsPage.jsx'
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
          <Route index element={<Navigate to="/chats" replace />} />
          <Route path="/chats" element={<ChatsPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/templates/create" element={<TemplatesPage />} />
          <Route path="/templates/:templateId/edit" element={<TemplatesPage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/team" element={<TeamPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/chats" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
