import { usePage } from '@inertiajs/react'
import { useAuth } from '../../context/AuthContext.jsx'

import { hasModuleAccess, moduleForPath } from '../../lib/moduleAccess.js'
import AccessDeniedPage from '../../pages/AccessDeniedPage.jsx'

export default function ProtectedRoute({ children }) {
  const { user } = useAuth()
  const { url } = usePage()
  const module = moduleForPath(user, url)

  if (!user) return (
    <div className="app-loading">
      <p role="status">Your session could not be verified.</p>
      <a className="button button-primary" href="/login?reauth=1">Sign in again</a>
    </div>
  )
  return children({ denied: module && !hasModuleAccess(user, module) ? <AccessDeniedPage /> : null })
}
