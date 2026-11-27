import { router, usePage } from '@inertiajs/react'
import { useEffect } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'

import { hasModuleAccess, moduleForPath } from '../../lib/moduleAccess.js'
import AccessDeniedPage from '../../pages/AccessDeniedPage.jsx'

export default function ProtectedRoute({ children }) {
  const { user } = useAuth()
  const { url } = usePage()
  const module = moduleForPath(user, url)

  useEffect(() => {
    if (!user) router.visit('/login', { replace: true })
  }, [user])

  if (!user) return <div className="app-loading" role="status"><span className="spinner" /> Checking your session...</div>
  return children({ denied: module && !hasModuleAccess(user, module) ? <AccessDeniedPage /> : null })
}
