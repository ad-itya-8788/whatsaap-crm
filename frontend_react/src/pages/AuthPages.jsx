import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import api, { csrf } from '../api/client.js'
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
  const [showPassword, setShowPassword] = useState(false)
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
          <div className="field-label-row">
            <label className="field-label" htmlFor="login-password">Password</label>
            <Link className="field-link" to="/forgot-password">Forgot password?</Link>
          </div>
          <div className="password-field">
            <input id="login-password" className="input" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} />
            <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
          </div>
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

export function InviteJoinPage() {
  const { token: pathToken } = useParams()
  const [params] = useSearchParams()
  const token = pathToken || params.get('invite') || ''
  const { user, loading, logout, refresh } = useAuth()
  const navigate = useNavigate()
  const [invitation, setInvitation] = useState(null)
  const [loadingInvite, setLoadingInvite] = useState(Boolean(token))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!token) return undefined
    const request = new AbortController()
    setLoadingInvite(true)
    setInvitation(null)
    setError('')
    api.get(`/api/invitations/${encodeURIComponent(token)}/peek`, { signal: request.signal })
      .then(({ data }) => setInvitation(data))
      .catch((requestError) => {
        if (!request.signal.aborted) setError(errorMessage(requestError, 'The invitation could not be loaded.'))
      })
      .finally(() => { if (!request.signal.aborted) setLoadingInvite(false) })
    return () => request.abort()
  }, [token])

  if (!token) return <Navigate to="/login" replace />

  const submit = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setSaving(true)
    setError('')
    try {
      await csrf()
      await api.post(`/api/invitations/${encodeURIComponent(token)}/redeem`, values)
      await refresh()
      navigate('/dashboard', { replace: true })
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to accept the invitation.'))
    } finally {
      setSaving(false)
    }
  }

  const loadingPage = loading || loadingInvite

  return (
    <AuthShell
      title="Join your workspace"
      subtitle={invitation ? `You’ve been invited to join as ${invitation.role}.` : 'Accept your team invitation.'}
      footer={<Link to={user ? '/dashboard' : '/login'}>{user ? 'Go to dashboard' : 'Back to sign in'}</Link>}
    >
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {loadingPage && <div className="app-loading"><span className="spinner" /> Checking the invitation…</div>}
      {!loadingPage && invitation && (user ? (
        <div className="auth-form">
          <div className="alert alert-info">You’re signed in as {user.email}. Sign out to register with this invitation.</div>
          <button type="button" className="button button-secondary button-block" onClick={logout}>Sign out</button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label className="field"><span className="field-label">Full name</span><input className="input" name="name" autoComplete="name" maxLength={120} required /></label>
          <label className="field"><span className="field-label">Email address</span><input className="input" type="email" name="email" autoComplete="email" maxLength={255} required /></label>
          <label className="field"><span className="field-label">Password</span><input className="input" type="password" name="password" autoComplete="new-password" minLength={8} required /></label>
          <label className="field"><span className="field-label">Confirm password</span><input className="input" type="password" name="password_confirmation" autoComplete="new-password" minLength={8} required /></label>
          <button className="button button-primary button-block" disabled={saving}>{saving ? 'Joining…' : 'Create account and join'}</button>
        </form>
      ))}
    </AuthShell>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [saving, setSaving] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await csrf()
      const { data } = await api.post('/api/forgot-password', { email })
      setSent(true)
      setError(data?.status || '')
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to send the reset link.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email address and we will send you a reset link."
      footer={<>Remembered your password? <Link to="/login">Back to sign in</Link></>}
    >
      {sent ? (
        <div className="alert alert-success">If the email belongs to an account, a reset link has been sent.</div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="field">
            <label className="field-label" htmlFor="forgot-email">Email address</label>
            <input id="forgot-email" className="input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <button className="button button-primary button-block" disabled={saving}>{saving ? 'Sending...' : 'Send reset link'}</button>
        </form>
      )}
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''
  const email = params.get('email') || ''
  const [values, setValues] = useState({ password: '', password_confirmation: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await csrf()
      await api.post('/api/reset-password', { token, email, ...values })
      navigate('/login', { replace: true, state: { reset: true } })
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to reset the password.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Use at least eight characters for your new password."
      footer={<>Need a new link? <Link to="/forgot-password">Request another</Link></>}
    >
      {!token || !email ? (
        <div className="alert alert-error">This reset link is invalid. Request a new one.</div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="field">
            <label className="field-label" htmlFor="reset-password">New password</label>
            <input id="reset-password" className="input" type="password" autoComplete="new-password" minLength="8" required value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="reset-confirm">Confirm password</label>
            <input id="reset-confirm" className="input" type="password" autoComplete="new-password" minLength="8" required value={values.password_confirmation} onChange={(event) => setValues({ ...values, password_confirmation: event.target.value })} />
          </div>
          <button className="button button-primary button-block" disabled={saving}>{saving ? 'Saving...' : 'Reset password'}</button>
        </form>
      )}
    </AuthShell>
  )
}
