import { useAuth } from './context/AuthContext.jsx'
import { usePageLocation } from './lib/navigation.js'
import { permissionsForPath } from './lib/permissions.js'
import AccessDeniedPage from './pages/AccessDeniedPage.jsx'
import { createInertiaApp } from '@inertiajs/react'
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from './components/common/ToastProvider.jsx'
import { startPrivateSession } from './api/client.js'
import { AuthProvider } from './context/AuthContext.jsx'
import * as authPages from './pages/AuthPages.jsx'
import './styles/index.css'

const workspacePages = import.meta.glob(['./pages/*Page.jsx', '!./pages/AccessDeniedPage.jsx'])
let workspaceLayout

function AuthorizedContent({ children }) {
  const { canAny } = useAuth()
  const { pathname } = usePageLocation()
  const permissions = permissionsForPath(pathname)
  if (permissions.length && !canAny(permissions)) return <AccessDeniedPage />
  return children
}

async function loadWorkspaceLayout() {
  if (!workspaceLayout) {
    const [{ default: ProtectedRoute }, { default: AppLayout }] = await Promise.all([
      import('./components/common/ProtectedRoute.jsx'),
      import('./components/layout/AppLayout.jsx'),
    ])
    function WorkspaceFrame({ children }) {
      const { user } = useAuth()
      const accessKey = JSON.stringify([user?.id, user?.role, user?.permissions])
      return <ProtectedRoute><AppLayout key={accessKey}><AuthorizedContent>{children}</AuthorizedContent></AppLayout></ProtectedRoute>
    }
    workspaceLayout ??= (page) => <WorkspaceFrame>{page}</WorkspaceFrame>
  }
  return workspaceLayout
}

createInertiaApp({
  progress: { color: 'var(--primary)', showSpinner: false },
  async resolve(name) {
    if (Object.hasOwn(authPages, name)) return authPages[name]
    if (name === 'AccessDeniedPage') {
      AccessDeniedPage.layout = await loadWorkspaceLayout()
      return AccessDeniedPage
    }

    const [{ default: Page }, layout] = await Promise.all([
      resolvePageComponent(`./pages/${name}.jsx`, workspacePages),
      loadWorkspaceLayout(),
    ])
    Page.layout = layout
    return Page
  },
  setup({ el, App, props }) {
    if (props.initialPage.props.realtime) window.__WACRM_REALTIME__ = props.initialPage.props.realtime
    if (props.initialPage.props.auth?.user) startPrivateSession()
    createRoot(el).render(
      <StrictMode>
        <AuthProvider initialUser={props.initialPage.props.auth?.user}>
          <ToastProvider>
            <App {...props} />
          </ToastProvider>
        </AuthProvider>
      </StrictMode>,
    )
  },
})
