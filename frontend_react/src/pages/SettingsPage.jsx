import { useCallback, useEffect, useState } from 'react'
import api from '../api/client.js'
import PageHeader from '../components/common/PageHeader.jsx'
import Icon from '../components/common/Icon.jsx'
import { errorMessage } from '../lib/utils.js'

const blankConfig = { waba_id: '', phone_number_id: '', access_token: '', verify_token: '' }

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
  const [form, setForm] = useState(blankConfig)
  const [status, setStatus] = useState('disconnected')
  const [connectionError, setConnectionError] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
      setConnectionError(config.connection_error || health.connection_error || health.error || '')
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
    setSaving(true)
    setError('')
    setNotice('')
    const payload = {
      waba_id: form.waba_id,
      phone_number_id: form.phone_number_id,
    }
    if (form.access_token.trim()) payload.access_token = form.access_token.trim()
    if (form.verify_token.trim()) payload.verify_token = form.verify_token.trim()
    try {
      await api.post('/api/app/whatsapp/config', payload)
      setNotice('WhatsApp configuration saved.')
      await load()
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to save WhatsApp configuration.'))
    } finally {
      setSaving(false)
    }
  }

  const disconnect = async () => {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await api.post('/api/app/whatsapp/config/disconnect')
      setNotice('WhatsApp disconnected.')
      await load()
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to disconnect WhatsApp.'))
    } finally {
      setSaving(false)
    }
  }

  const connected = ['connected', 'ok', 'active'].includes(String(status).toLowerCase())
  const badgeTone = connectionError ? 'rejected' : connected ? 'approved' : 'pending'

  return (
    <>
      <PageHeader title="WhatsApp Settings" subtitle="Connect and manage your Meta WhatsApp Cloud API account." />
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <div className="settings-layout">
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
              <button type="button" className="icon-button" onClick={() => navigator.clipboard?.writeText(webhookUrl)} aria-label="Copy webhook URL" title="Copy URL"><Icon name="copy" size={15} /></button>
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
                <input id="wa-waba-id" className="input" value={form.waba_id} onChange={(event) => setForm({ ...form, waba_id: event.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="wa-phone-id">Phone Number ID</label>
                <input id="wa-phone-id" className="input" value={form.phone_number_id} onChange={(event) => setForm({ ...form, phone_number_id: event.target.value })} />
              </div>
              <div className="field field-full">
                <label className="field-label" htmlFor="wa-token">Access token</label>
                <input id="wa-token" className="input" type="password" autoComplete="new-password" placeholder="Leave blank to keep the saved token" value={form.access_token} onChange={(event) => setForm({ ...form, access_token: event.target.value })} />
              </div>
              <div className="field field-full">
                <label className="field-label" htmlFor="wa-verify-token">Webhook verify token</label>
                <input id="wa-verify-token" className="input" type="password" autoComplete="new-password" placeholder="Leave blank to keep the saved token" value={form.verify_token} onChange={(event) => setForm({ ...form, verify_token: event.target.value })} />
              </div>
            </div>
            <p className="field-hint settings-hint">Secret fields stay blank when loaded and are only sent when you enter a new value.</p>
            <div className="settings-actions">
              <button type="submit" className="button button-primary" disabled={saving || loading}>Save &amp; connect</button>
              <button type="button" className="button button-secondary" onClick={disconnect} disabled={saving || loading}>Disconnect</button>
            </div>
          </form>
        </section>
      </div>
    </>
  )
}
