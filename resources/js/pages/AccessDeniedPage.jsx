import { Link } from '@inertiajs/react'
import { useAuth } from '../context/AuthContext.jsx'
import { firstAccessiblePage } from '../lib/permissions.js'

export default function AccessDeniedPage() {
  const { user } = useAuth()
  return <section className="panel" role="alert">
    <h1>Access denied</h1>
    <p>Your account does not have permission to open this page.</p>
    {user?.permissions?.length > 0 && <Link href={firstAccessiblePage(user)}>Go to workspace</Link>}
  </section>
}
