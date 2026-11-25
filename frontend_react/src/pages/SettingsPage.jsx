import { useCallback, useEffect, useState } from 'react'
import api from '../api/client.js'
import PageHeader from '../components/common/PageHeader.jsx'
import Icon from '../components/common/Icon.jsx'
import BrowserNotificationsCard from '../components/common/BrowserNotificationsCard.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { errorMessage, isAdmin } from '../lib/utils.js'

const blankConfig = { waba_id: '', phone_number_id: '', access_token: '', verify_token: '' }

const THEMES = [
  { id: 'amber', name: 'Gold', tagline: "Aayojan AI's gold accent.", swatch: 'oklch(0.745 0.16 65)' },
  { id: 'violet', name: 'Violet', tagline: 'Confident and playful.', swatch: 'oklch(0.526 0.247 293)' },
  { id: 'emerald', name: 'Emerald', tagline: 'Growth-oriented green.', swatch: 'oklch(0.62 0.16 162)' },
  { id: 'cobalt', name: 'Cobalt', tagline: 'Clean B2B blue.', swatch: 'oklch(0.585 0.2 254)' },
  { id: 'rose', name: 'Rose', tagline: 'Bold and modern.', swatch: 'oklch(0.645 0.22 16)' },
]

function resolveStatus(config, health) {
  if (config.connection_status) return config.connection_status
  if (health.connection_status) return health.connection_status
  if (health.connected === true) return 'connected'
  return health.status || 'disconnected'
}

function labelFor(status) {
  return String(status || 'disconnected').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function SettingsPage() {
  const { user } = useAuth()
  const toast = useToast()
  const canManage = isAdmin(user)
  const [form, setForm] = useState(blankConfig)
  const [status, setStatus] = useState('disconnected')
  const [connectionError, setConnectionError] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [mode, setMode] = useState(() => localStorage.getItem('wacrm.mode') || 'light')
  const [theme, setTheme] = useState(() => localStorage.getItem('wacrm.theme') || 'amber')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [configResult, healthResult] = await Promise.all([
        api.get('/api/app/whatsapp/config'),
        api.get('/api/app/whatsapp/health').catch(() => ({ data: {} })),
      ])
      const config = configResult.data || {}
      const health = healthResult.data || {}
      setForm({
        waba_id: config.waba_id || '',
        phone_number_id: config.phone_number_id || '',
        access_token: '',
        verify_token: '',
      })
      setStatus(resolveStatus(config, health))
      setConnectionError(config.last_registration_error || health.message || '')
      setWebhookUrl(config.webhook_url || config.callback_url || `${window.location.origin}/api/whatsapp/webhook`)
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load WhatsApp settings.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async (event) => {
    event.preventDefault()
    if (!canManage) return
    setSaving(true)
    setError('')
    const payload = {
      waba_id: form.waba_id,
      phone_number_id: form.phone_number_id,
    }
    if (form.access_token.trim()) payload.access_token = form.access_token.trim()
    if (form.verify_token.trim()) payload.verify_token = form.verify_token.trim()
    try {
      await api.post('/api/app/whatsapp/config', payload)
      toast.success('WhatsApp configuration saved.')
      await load()
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to save WhatsApp configuration.'))
      toast.error(errorMessage(requestError, 'Unable to save WhatsApp configuration.'))
    } finally {
      setSaving(false)
    }
  }

  const disconnect = async () => {
    if (!canManage) return
    setSaving(true)
    setError('')
    try {
      await api.post('/api/app/whatsapp/config/disconnect')
      toast.success('WhatsApp disconnected.')
      setConfirmDisconnect(false)
      await load()
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to disconnect WhatsApp.'))
      toast.error(errorMessage(requestError, 'Unable to disconnect WhatsApp.'))
    } finally {
      setSaving(false)
    }
  }

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      toast.success('Webhook URL copied.')
    } catch {
      toast.error('Copy failed. Your browser blocked clipboard access.')
    }
  }

  const changeAppearance = (next = {}) => {
    const nextMode = next.mode || mode
    const nextTheme = next.theme || theme
    setMode(nextMode)
    setTheme(nextTheme)
    document.documentElement.dataset.mode = nextMode
    document.documentElement.dataset.theme = nextTheme
    localStorage.setItem('wacrm.mode', nextMode)
    localStorage.setItem('wacrm.theme', nextTheme)
    window.dispatchEvent(new CustomEvent('wacrm:theme-changed', { detail: { mode: nextMode, theme: nextTheme } }))
  }

  const connected = ['connected', 'ok', 'active'].includes(String(status).toLowerCase())
  const badgeTone = connectionError ? 'rejected' : connected ? 'approved' : 'pending'

  return (
    <>
      <PageHeader title="WhatsApp Settings" subtitle="Connect and manage your Meta WhatsApp Cloud API account." />
      {error && <div className="alert alert-error">{error}</div>}
      {!canManage && <div className="alert alert-info">Only administrators can change WhatsApp connection settings.</div>}

      <div className="settings-layout">
        <section className="card appearance-card">
          <header className="panel-header"><h2>Appearance</h2></header>
          <div className="appearance-body">
            <div className="appearance-row">
              <div>
                <h3 className="settings-section-title">Mode</h3>
                <p className="field-hint">Choose how Aayojan AI CRM looks on this device.</p>
              </div>
              <div className="mode-switch" role="group" aria-label="Color mode">
                <button type="button" className={mode === 'light' ? 'is-active' : ''} onClick={() => changeAppearance({ mode: 'light' })}>
                  <Icon name="sun" size={15} /> Light
                </button>
                <button type="button" className={mode === 'dark' ? 'is-active' : ''} onClick={() => changeAppearance({ mode: 'dark' })}>
                  <Icon name="moon" size={15} /> Dark
                </button>
              </div>
            </div>
            <div className="appearance-row is-column">
              <div>
                <h3 className="settings-section-title">Accent color</h3>
                <p className="field-hint">Gold is the default Aayojan AI accent.</p>
              </div>
              <div className="theme-grid">
                {THEMES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`theme-option${theme === item.id ? ' is-active' : ''}`}
                    onClick={() => changeAppearance({ theme: item.id })}
                    aria-pressed={theme === item.id}
                  >
                    <span className="theme-swatch" style={{ background: item.swatch }} />
                    <span className="theme-copy"><strong>{item.name}</strong><small>{item.tagline}</small></span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <BrowserNotificationsCard />

        <section className="card connection-card">
          <header className="panel-header">
            <h2>Connection</h2>
            <span className={`badge badge-${badgeTone}`}>{labelFor(status)}</span>
          </header>
          <div className="connection-body">
            <div className="status-row"><span className={`status-dot ${connected ? 'is-online' : 'is-offline'}`} /> {connected ? 'Connected to WhatsApp' : 'Not connected'}</div>
            {connectionError && <div className="alert alert-error alert-inline">{connectionError}</div>}
            <h3 className="settings-section-title">Webhook callback URL</h3>
            <div className="webhook-box">
              <code>{webhookUrl}</code>
              <button type="button" className="icon-button" onClick={copyWebhook} aria-label="Copy webhook URL" title="Copy URL"><Icon name="copy" size={15} /></button>
            </div>
            <p className="guidance">
              Add this URL in WhatsApp Manager under <strong>Configuration → Webhook</strong>, enter the verify token below,
              and subscribe to the <strong>messages</strong> field. Save the configuration, then confirm the connection in Meta.
            </p>
          </div>
        </section>

        <section className="card settings-card">
          <header className="panel-header"><h2>Cloud API credentials</h2></header>
          <form onSubmit={save}>
            {loading && <div className="list-placeholder"><span className="spinner" /> Loading configuration...</div>}
            <div className="form-grid">
              <div className="field">
                <label className="field-label" htmlFor="wa-waba-id">WABA ID</label>
                <input id="wa-waba-id" className="input" disabled={!canManage || loading} value={form.waba_id} onChange={(event) => setForm({ ...form, waba_id: event.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="wa-phone-id">Phone Number ID</label>
                <input id="wa-phone-id" className="input" disabled={!canManage || loading} value={form.phone_number_id} onChange={(event) => setForm({ ...form, phone_number_id: event.target.value })} />
              </div>
              <div className="field field-full">
                <label className="field-label" htmlFor="wa-token">Access token</label>
                <input id="wa-token" className="input" type="password" autoComplete="new-password" placeholder="Leave blank to keep the saved token" disabled={!canManage || loading} value={form.access_token} onChange={(event) => setForm({ ...form, access_token: event.target.value })} />
              </div>
              <div className="field field-full">
                <label className="field-label" htmlFor="wa-verify-token">Webhook verify token</label>
                <input id="wa-verify-token" className="input" type="password" autoComplete="new-password" placeholder="Leave blank to keep the saved token" disabled={!canManage || loading} value={form.verify_token} onChange={(event) => setForm({ ...form, verify_token: event.target.value })} />
              </div>
            </div>
            <p className="field-hint settings-hint">Secret fields stay blank when loaded and are only sent when you enter a new value.</p>
            <div className="settings-actions">
              <button type="submit" className="button button-primary" disabled={saving || loading || !canManage}>Save &amp; connect</button>
              <button type="button" className="button button-danger" onClick={() => setConfirmDisconnect(true)} disabled={saving || loading || !canManage}>Disconnect</button>
            </div>
          </form>
        </section>
      </div>
      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect WhatsApp?"
        message="Sending will be disabled until the Cloud API is connected again. Existing messages and contacts are preserved."
        confirmLabel="Disconnect"
        busy={saving}
        onConfirm={disconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </>
  )
}
