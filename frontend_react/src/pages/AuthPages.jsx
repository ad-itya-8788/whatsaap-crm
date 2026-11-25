import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import BrandLogo from '../components/common/BrandLogo.jsx'
import { errorMessage } from '../lib/utils.js'

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <div className="auth-brand"><BrandLogo className="auth-logo" /></div>
        <h1 className="auth-title">{title}</h1>
        <p className="auth-subtitle">{subtitle}</p>
        {children}
        <div className="auth-footer">{footer}</div>
      </section>
    </main>
  )
}

export function LoginPage() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const [values, setValues] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  if (loading) return <div className="app-loading"><span className="spinner" /></div>
  if (user) return <Navigate to="/dashboard" replace />

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await login(values)
      navigate('/dashboard', { replace: true })
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to sign in.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your WhatsApp CRM workspace."
      footer={<>Need access? Ask an administrator to add your account.</>}
    >
      <form className="auth-form" onSubmit={submit}>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="field">
          <label className="field-label" htmlFor="login-email">Email address</label>
          <input id="login-email" className="input" type="email" autoComplete="email" required value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="login-password">Password</label>
          <input id="login-password" className="input" type="password" autoComplete="current-password" required value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} />
        </div>
        <button className="button button-primary button-block" disabled={saving}>{saving ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </AuthShell>
  )
}

export function RegisterPage() {
  return (
    <AuthShell
      title="Registration is disabled"
      subtitle="Aayojan AI CRM accounts are created by an administrator."
      footer={<>Already have an account? <Link to="/login">Sign in</Link></>}
    >
      <div className="alert alert-info">Ask your administrator to add you as a team member, then sign in with the credentials they provide.</div>
    </AuthShell>
  )
}
