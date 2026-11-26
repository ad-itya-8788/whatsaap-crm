import { createInertiaApp } from '@inertiajs/react'
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from './components/common/ToastProvider.jsx'
import ProtectedRoute from './components/common/ProtectedRoute.jsx'
import AppLayout from './components/layout/AppLayout.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import * as authPages from './pages/AuthPages.jsx'
import './styles/index.css'

const workspacePages = import.meta.glob('./pages/*Page.jsx')
const workspaceLayout = (page) => <ProtectedRoute><AppLayout>{page}</AppLayout></ProtectedRoute>

createInertiaApp({
  progress: { color: 'var(--primary)', showSpinner: false },
  async resolve(name) {
    if (Object.hasOwn(authPages, name)) return authPages[name]

    const { default: Page } = await resolvePageComponent(`./pages/${name}.jsx`, workspacePages)
    Page.layout = workspaceLayout
    return Page
  },
  setup({ el, App, props }) {
    createRoot(el).render(
      <StrictMode>
        <AuthProvider initialUser={props.initialPage.props.auth.user}>
          <ToastProvider>
            <App {...props} />
          </ToastProvider>
        </AuthProvider>
      </StrictMode>,
    )
  },
})
