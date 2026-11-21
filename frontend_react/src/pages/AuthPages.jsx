import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import Icon from '../components/common/Icon.jsx'
import { errorMessage } from '../lib/utils.js'

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <div className="auth-brand"><Icon name="chat" size={20} /> WhatsApp CRM</div>
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
  if (user) return <Navigate to="/chats" replace />

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await login(values)
      navigate('/chats', { replace: true })
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
      footer={<>New here? <Link to="/register">Create an account</Link></>}
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
  const { user, loading, register } = useAuth()
  const navigate = useNavigate()
  const [values, setValues] = useState({ name: '', email: '', password: '', password_confirmation: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  if (loading) return <div className="app-loading"><span className="spinner" /></div>
  if (user) return <Navigate to="/chats" replace />

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await register(values)
      navigate('/chats', { replace: true })
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to create your account.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Set up a workspace to manage your WhatsApp conversations."
      footer={<>Already registered? <Link to="/login">Sign in</Link></>}
    >
      <form className="auth-form" onSubmit={submit}>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="field">
          <label className="field-label" htmlFor="register-name">Full name</label>
          <input id="register-name" className="input" autoComplete="name" required value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="register-email">Email address</label>
          <input id="register-email" className="input" type="email" autoComplete="email" required value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="register-password">Password</label>
          <input id="register-password" className="input" type="password" autoComplete="new-password" minLength={8} required value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="register-password-confirmation">Confirm password</label>
          <input id="register-password-confirmation" className="input" type="password" autoComplete="new-password" minLength={8} required value={values.password_confirmation} onChange={(event) => setValues({ ...values, password_confirmation: event.target.value })} />
        </div>
        <button className="button button-primary button-block" disabled={saving}>{saving ? 'Creating account...' : 'Create account'}</button>
      </form>
    </AuthShell>
  )
}
