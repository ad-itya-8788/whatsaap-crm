import { createInertiaApp } from '@inertiajs/react'
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from './components/common/ToastProvider.jsx'
import { startPrivateSession } from './api/client.js'
import { AuthProvider } from './context/AuthContext.jsx'
import * as authPages from './pages/AuthPages.jsx'
import './styles/index.css'

const workspacePages = import.meta.glob('./pages/*Page.jsx')
let workspaceLayout

async function loadWorkspaceLayout() {
  if (!workspaceLayout) {
    const [{ default: ProtectedRoute }, { default: AppLayout }] = await Promise.all([
      import('./components/common/ProtectedRoute.jsx'),
      import('./components/layout/AppLayout.jsx'),
    ])
    workspaceLayout ??= (page) => <ProtectedRoute><AppLayout>{page}</AppLayout></ProtectedRoute>
  }
  return workspaceLayout
}

createInertiaApp({
  progress: { color: 'var(--primary)', showSpinner: false },
  async resolve(name) {
    if (Object.hasOwn(authPages, name)) return authPages[name]

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
