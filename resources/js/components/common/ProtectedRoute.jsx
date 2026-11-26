import { router } from '@inertiajs/react'
import { useEffect } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'

export default function ProtectedRoute({ children }) {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) router.visit('/login', { replace: true })
  }, [user])

  if (!user) return <div className="app-loading" role="status"><span className="spinner" /> Checking your session...</div>
  return children
}
