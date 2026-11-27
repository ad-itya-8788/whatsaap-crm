import { useEffect, useState } from 'react'
import { Link, router, usePage } from '@inertiajs/react'
import { useSearchParams } from '../lib/navigation.js'
import api, { csrf } from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import AuthShell from '../components/common/AuthShell.jsx'
import { errorMessage } from '../lib/utils.js'

export function LoginPage() {
  const { login } = useAuth()
  const [values, setValues] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)


  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await login(values)
      window.location.replace('/')
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
      footer={<>Need access? Ask your workspace administrator for an invitation.</>}
    >
      <form className="auth-form" onSubmit={submit}>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <div className="field">
          <label className="field-label" htmlFor="login-email">Email address</label>
          <input id="login-email" className="input" type="email" autoComplete="email" required value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} />
        </div>
        <div className="field">
          <div className="field-label-row">
            <label className="field-label" htmlFor="login-password">Password</label>
            <Link className="field-link" href="/forgot-password">Forgot password?</Link>
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
      title="Join by invitation"
      subtitle="Ask your workspace administrator for an invitation."
    >
      <Link className="button button-primary button-block" href="/login">Back to sign in</Link>
    </AuthShell>
  )
}

export function InviteJoinPage() {
  const { inviteToken: token } = usePage().props
  const { user, logout, setUser } = useAuth()
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

  const submit = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setSaving(true)
    setError('')
    try {
      await csrf()
      const { data } = await api.post(`/api/invitations/${encodeURIComponent(token)}/redeem`, values)
      setUser(data.user)
      window.location.replace('/')
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to accept the invitation.'))
    } finally {
      setSaving(false)
    }
  }

  const loadingPage = loadingInvite
  const signOut = async () => {
    setError('')
    try {
      await logout()
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to sign out.'))
    }
  }

  return (
    <AuthShell
      title="Join your workspace"
      icon="users"
      subtitle={invitation ? `You’ve been invited to join as ${invitation.role}.` : 'Accept your team invitation.'}
      footer={<Link href={user ? '/' : '/login'}>{user ? 'Go to dashboard' : 'Back to sign in'}</Link>}
    >
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {loadingPage && <div className="app-loading"><span className="spinner" /> Checking the invitation…</div>}
      {!loadingPage && !invitation && !error && <div className="alert alert-error" role="alert">This invitation link is missing or invalid.</div>}
      {!loadingPage && invitation && (user ? (
        <div className="auth-form">
          <div className="alert alert-info">You’re signed in as {user.email}. Sign out to register with this invitation.</div>
          <button type="button" className="button button-secondary button-block" onClick={signOut}>Sign out</button>
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
      await api.post('/api/forgot-password', { email })
      setSent(true)
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to send the reset link.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      icon="send"
      subtitle="Enter your email address and we will send you a reset link."
      footer={<>Remembered your password? <Link href="/login">Back to sign in</Link></>}
    >
      {sent ? (
        <div className="alert alert-success" role="status">If the email belongs to an account, a reset link has been sent.</div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
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
      router.visit('/login', { replace: true })
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
      footer={<>Need a new link? <Link href="/forgot-password">Request another</Link></>}
    >
      {!token || !email ? (
        <div className="alert alert-error">This reset link is invalid. Request a new one.</div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
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
