import { usePage } from '@inertiajs/react'
import { useAuth } from '../../context/AuthContext.jsx'

import { hasModuleAccess, moduleForPath } from '../../lib/moduleAccess.js'
import AuthShell from './AuthShell.jsx'
import AccessDeniedPage from '../../pages/AccessDeniedPage.jsx'

export default function ProtectedRoute({ children }) {
  const { user } = useAuth()
  const { url } = usePage()
  const module = moduleForPath(user, url)

  if (!user) return (
    <AuthShell title="Sign in to continue" subtitle="We could not verify your session. Sign in to return to your workspace.">
      <a className="button button-primary button-block" href="/login?reauth=1">Sign in again</a>
    </AuthShell>
  )
  return children({ denied: module && !hasModuleAccess(user, module) ? <AccessDeniedPage /> : null })
}
