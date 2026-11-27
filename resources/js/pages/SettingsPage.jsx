import { useCallback, useEffect, useState } from 'react'
import { Link, router } from '@inertiajs/react'
import { ChevronRight, Crown, ExternalLink, House, Layers, Palette, Wrench } from 'lucide-react'
import { hasModuleAccess } from '../lib/moduleAccess.js'
import { useSearchParams } from '../lib/navigation.js'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import BrowserNotificationsCard from '../components/common/BrowserNotificationsCard.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import ApiKeysPanel from '../components/settings/ApiKeysPanel.jsx'
import { changeAppearance, useAccentTheme, useColorMode } from '../lib/appearance.js'
import { useWhatsappConfig } from '../lib/whatsappConfig.js'
import { errorMessage, extractList, relativeTime } from '../lib/utils.js'

const blankConfig = { waba_id: '', phone_number_id: '', access_token: '', verify_token: '', pin: '' }

const THEMES = [
  { id: 'emerald', name: 'Emerald', tagline: 'Default green.', swatch: '#22c55e' },
  { id: 'amber', name: 'Gold', tagline: "Aayojan AI's gold accent.", swatch: 'oklch(0.745 0.16 65)' },
  { id: 'violet', name: 'Violet', tagline: 'Confident and playful.', swatch: 'oklch(0.526 0.247 293)' },
  { id: 'cobalt', name: 'Cobalt', tagline: 'Clean B2B blue.', swatch: 'oklch(0.585 0.2 254)' },
  { id: 'rose', name: 'Rose', tagline: 'Bold and modern.', swatch: 'oklch(0.645 0.22 16)' },
]

function resolveStatus(config, health) {
  if (config.connection_status) return config.connection_status
  if (health.connection_status) return health.connection_status
  if (health.connected === true) return 'connected'
  return health.status || 'disconnected'
}

export function resolveOverviewConnectionStatus(config, health) {
  const statuses = [config?.connection_status, config?.status, health?.connection_status, health?.status]
    .map((status) => String(status || '').trim().toLowerCase())

  if (health?.connected === true || statuses.some((status) => ['connected', 'ok', 'active', 'verified'].includes(status))) {
    return 'connected'
  }
  if (statuses.some((status) => ['disconnected', 'not_connected', 'inactive', 'unconfigured'].includes(status))) {
    return 'disconnected'
  }
  return 'unknown'
}

function labelFor(status) {
  return String(status || 'disconnected').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

const SECTIONS = [
  { id: 'overview', label: 'Overview', group: 'Account', glyph: House },
  { id: 'profile', label: 'Your profile', group: 'Account', icon: 'user' },
  { id: 'security', label: 'Login & security', group: 'Account', icon: 'shield' },
  { id: 'appearance', label: 'Appearance', group: 'Workspace', glyph: Palette },
  { id: 'whatsapp', label: 'WhatsApp', group: 'Workspace', icon: 'whatsapp' },
  { id: 'templates', label: 'Templates', group: 'Workspace', icon: 'template', module: 'templates', to: '/templates' },
  { id: 'quick-replies', label: 'Quick replies', group: 'Workspace', icon: 'zap', module: 'workspace', to: '/workspace?tab=quick-replies' },
  { id: 'inbox', label: 'Inbox', group: 'Workspace', icon: 'inbox' },
  { id: 'fields', label: 'Fields & tags', group: 'Workspace', icon: 'tag', module: 'workspace', to: '/workspace?tab=tags' },
  { id: 'members', label: 'Team members', group: 'Workspace', icon: 'users', module: 'team', to: '/team' },
  { id: 'api', label: 'API keys', group: 'Workspace', glyph: Wrench, ownerOnly: true },
]

const TAB_ALIASES = { tags: 'fields', 'custom-fields': 'fields' }

const STATS = [
  { id: 'members', label: 'Team members', icon: 'users', module: 'team', url: '/api/app/users?per_page=1', to: '/team' },
  { id: 'templates', label: 'Templates', icon: 'template', module: 'templates', url: '/api/app/whatsapp/templates', to: '/templates' },
  { id: 'tags', label: 'Tags', icon: 'tag', module: 'workspace', url: '/api/app/tags', to: '/workspace?tab=tags' },
  { id: 'fields', label: 'Custom fields', glyph: Layers, module: 'workspace', url: '/api/app/custom-fields', to: '/workspace?tab=fields' },
]

const QUICK_ACTIONS = [
  { label: 'Manage WhatsApp', description: 'Connection & settings', icon: 'whatsapp', to: '/settings?tab=whatsapp' },
  { label: 'Message Templates', description: 'Create & manage templates', icon: 'template', module: 'templates', to: '/templates' },
  { label: 'Team Members', description: 'Add or manage your team', icon: 'users', module: 'team', to: '/team' },
  { label: 'Tags & Fields', description: 'Organize your contacts', icon: 'tag', module: 'workspace', to: '/workspace?tab=tags' },
]

const CONNECTION_COPY = {
  checking: ['Checking WhatsApp connection', 'Checking your current connection status.'],
  connected: ['WhatsApp connected', 'Your WhatsApp number is active and ready to use.'],
  disconnected: ['WhatsApp disconnected', 'Connect your WhatsApp number to send and receive messages.'],
  unknown: ['WhatsApp status unavailable', 'Open connection settings to check your configuration.'],
}

function SettingsGlyph({ item, size = 19 }) {
  const Glyph = item.glyph
  return Glyph ? <Glyph size={size} strokeWidth={1.8} aria-hidden="true" /> : <Icon name={item.icon} size={size} />
}

function SettingsRail({ sections, active, params }) {
  const hrefFor = (section) => {
    if (section.to) return section.to
    const query = new URLSearchParams(params)
    query.set('tab', section.id)
    return `/settings?${query}`
  }

  return (
    <nav className="settings-rail" aria-label="Settings sections">
      <label className="settings-section-select">
        <span>Settings section</span>
        <select className="select" value={active} onChange={(event) => {
          const section = sections.find((item) => item.id === event.target.value)
          if (section) router.visit(hrefFor(section))
        }}>
          {['Account', 'Workspace'].map((group) => (
            <optgroup key={group} label={group}>
              {sections.filter((section) => section.group === group).map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {['Account', 'Workspace'].map((group) => (
        <div className="settings-rail-group" key={group}>
          <span className="settings-rail-label">{group}</span>
          {sections.filter((section) => section.group === group).map((section) => (
            <Link key={section.id} className={`settings-rail-item${active === section.id ? ' is-active' : ''}`}
              href={hrefFor(section)} aria-current={active === section.id ? 'page' : undefined}>
              <SettingsGlyph item={section} />
              {section.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  )
}

function OverviewPanel({ user }) {
  const accessTeam = hasModuleAccess(user, 'team')
  const accessTemplates = hasModuleAccess(user, 'templates')
  const accessWorkspace = hasModuleAccess(user, 'workspace')
  const access = { team: accessTeam, templates: accessTemplates, workspace: accessWorkspace }
  const [counts, setCounts] = useState({})
  const { data: whatsapp, error: connectionError } = useWhatsappConfig()
  const connectionStatus = connectionError ? 'unknown' : whatsapp ? resolveOverviewConnectionStatus(whatsapp) : 'checking'
  const [connectionTitle, connectionDescription] = CONNECTION_COPY[connectionStatus]

  useEffect(() => {
    const controller = new AbortController()
    const enabled = { team: accessTeam, templates: accessTemplates, workspace: accessWorkspace }
    const tasks = STATS.filter((tile) => enabled[tile.module]).map(async (tile) => {
      try {
        const { data } = await api.get(tile.url, { signal: controller.signal })
        return [tile.id, data?.total ?? extractList(data).length]
      } catch {
        return [tile.id, null]
      }
    })
    Promise.all(tasks).then((results) => {
      if (!controller.signal.aborted) setCounts(Object.fromEntries(results))
    })
    return () => controller.abort()
  }, [accessTeam, accessTemplates, accessWorkspace])

  const avatar = user?.avatar_url
  const avatarSrc = avatar && (/^(?:https?:\/\/|\/)/i.test(avatar) ? avatar : `/storage/${avatar}`)
  const role = user?.role_name || user?.role
  const tiles = STATS.filter((tile) => access[tile.module])

  return (
    <div className="settings-panel-stack">
      <section className="card settings-panel settings-overview" aria-labelledby="settings-overview-title">
        <header className="settings-card-heading">
          <h2 id="settings-overview-title">Workspace overview</h2>
          <p>Key details and usage for your workspace.</p>
        </header>
        <div className="settings-profile-card">
          <span className="settings-profile-avatar" aria-hidden="true">
            {user?.name?.trim().charAt(0).toUpperCase() || '?'}
            {avatarSrc && <img key={avatarSrc} src={avatarSrc} alt="" onError={(event) => { event.currentTarget.hidden = true }} />}
          </span>
          <div className="settings-profile-copy">
            <strong>{user?.name || 'Team member'}</strong>
            {user?.email && <span>{user.email}</span>}
          </div>
          {role && <span className="settings-role">{user?.role === 'owner' ? <Crown size={16} aria-hidden="true" /> : <Icon name="shield" size={16} />}{role}</span>}
        </div>
        {tiles.length > 0 && <div className="settings-overview-grid">
          {tiles.map((tile) => (
            <Link className="settings-overview-tile" href={tile.to} key={tile.id}>
              <span className="settings-tile-icon"><SettingsGlyph item={tile} size={25} /></span>
              <span className="settings-tile-copy">
                <strong title={counts[tile.id] === null ? 'Count unavailable' : undefined}>{counts[tile.id] ?? '—'}</strong>
                <span>{tile.label}</span>
              </span>
            </Link>
          ))}
        </div>}
      </section>
      <section className="card settings-panel settings-status-row" aria-labelledby="settings-connection-title">
        <span className={`settings-tile-icon settings-connection-icon${connectionStatus === 'connected' ? ' is-connected' : ''}`}>
          <Icon name="whatsapp" size={29} />
        </span>
        <header className="settings-card-heading" aria-live="polite">
          <h2 id="settings-connection-title">{connectionTitle}</h2>
          <p>{connectionDescription}</p>
        </header>
        <Link className="button button-secondary settings-connection-link" href="/settings?tab=whatsapp">
          Open connection settings <ExternalLink size={15} aria-hidden="true" />
        </Link>
      </section>
      <section className="card settings-panel settings-quick-actions" aria-labelledby="settings-quick-actions-title">
        <header className="settings-card-heading">
          <h2 id="settings-quick-actions-title">Quick actions</h2>
          <p>Common workspace configurations.</p>
        </header>
        <div className="settings-overview-grid">
          {QUICK_ACTIONS.filter((action) => !action.module || access[action.module]).map((action) => (
            <Link className="settings-overview-tile settings-action-tile" href={action.to} key={action.label}>
              <span className={`settings-tile-icon${action.icon === 'whatsapp' ? ' is-connected' : ''}`}><SettingsGlyph item={action} size={23} /></span>
              <span className="settings-tile-copy"><strong>{action.label}</strong><span>{action.description}</span></span>
              <ChevronRight size={16} className="settings-action-chevron" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function ProfilePanel() {
  const { user, setUser } = useAuth()
  const toast = useToast()
  const [values, setValues] = useState({ name: user?.name || '', email: user?.email || '' })
  const [avatar, setAvatar] = useState(null)
  const [removeAvatar, setRemoveAvatar] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '')
  const [saving, setSaving] = useState(false)

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = new FormData()
      payload.append('name', values.name)
      payload.append('email', values.email)
      if (avatar) payload.append('avatar', avatar)
      if (removeAvatar) payload.append('remove_avatar', '1')
      const { data } = await api.post('/api/app/profile', payload)
      setAvatarUrl(data?.user?.avatar_url || '')
      setAvatar(null)
      setRemoveAvatar(false)
      setUser({ ...user, ...data.user })
      toast.success('Profile updated.')
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to update your profile.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-panel-stack">
      <section className="card settings-panel">
        <header className="panel-header"><h2>Your profile</h2></header>
        <form className="form-grid" onSubmit={save}>
          <div className="field field-full">
            <label className="field-label" htmlFor="profile-avatar">Profile photo</label>
            <div className="avatar-editor">
              {avatarUrl && !removeAvatar ? (
                <img className="avatar-editor-preview" src={`/storage/${avatarUrl}`} alt="Current profile" />
              ) : (
                <span className="chat-avatar avatar-lg">{String(values.name || '?').charAt(0).toUpperCase()}</span>
              )}
              <input id="profile-avatar" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { setAvatar(event.target.files?.[0] || null); setRemoveAvatar(false) }} />
              {(avatarUrl || avatar) && <button type="button" className="button button-sm button-secondary" onClick={() => { setAvatar(null); setRemoveAvatar(true) }}>Remove photo</button>}
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="profile-name">Full name</label>
            <input id="profile-name" className="input" required value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="profile-email">Email address</label>
            <input id="profile-email" className="input" type="email" required value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} />
          </div>
          <div className="field field-full settings-actions">
            <button className="button button-primary" disabled={saving}>{saving ? 'Saving...' : 'Save profile'}</button>
          </div>
        </form>
      </section>
      <BrowserNotificationsCard />
    </div>
  )
}

function SecurityPanel() {
  const toast = useToast()
  const [values, setValues] = useState({ current_password: '', password: '', password_confirmation: '' })
  const [sessions, setSessions] = useState([])
  const [saving, setSaving] = useState(false)

  const loadSessions = useCallback(() => {
    api.get('/api/app/sessions').then(({ data }) => setSessions(data?.sessions || [])).catch(() => {})
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  const changePassword = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      await api.post('/api/app/password', values)
      setValues({ current_password: '', password: '', password_confirmation: '' })
      toast.success('Password updated.')
      loadSessions()
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to update your password.'))
    } finally {
      setSaving(false)
    }
  }

  const signOutEverywhere = async () => {
    try {
      await api.delete('/api/app/sessions')
      toast.success('Other sessions signed out.')
      loadSessions()
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to end other sessions.'))
    }
  }

  return (
    <div className="settings-panel-stack">
      <section className="card settings-panel">
        <header className="panel-header"><h2>Change password</h2></header>
        <form className="form-grid" onSubmit={changePassword}>
          <div className="field field-full">
            <label className="field-label" htmlFor="current-password">Current password</label>
            <input id="current-password" className="input" type="password" autoComplete="current-password" required value={values.current_password} onChange={(event) => setValues({ ...values, current_password: event.target.value })} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="new-password">New password</label>
            <input id="new-password" className="input" type="password" autoComplete="new-password" minLength="8" required value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="confirm-password">Confirm new password</label>
            <input id="confirm-password" className="input" type="password" autoComplete="new-password" minLength="8" required value={values.password_confirmation} onChange={(event) => setValues({ ...values, password_confirmation: event.target.value })} />
          </div>
          <div className="field field-full settings-actions">
            <button className="button button-primary" disabled={saving}>{saving ? 'Saving...' : 'Change password'}</button>
          </div>
        </form>
      </section>
      <section className="card settings-panel">
        <header className="panel-header">
          <h2>Active sessions</h2>
          <button type="button" className="button button-sm button-secondary" onClick={signOutEverywhere}>Sign out everywhere else</button>
        </header>
        {sessions.length ? (
          <ul className="settings-session-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <span><strong>{session.current ? 'This device' : session.ip_address || 'Another device'}</strong><small>{session.user_agent || 'Unknown browser'}</small></span>
                <time>{relativeTime(session.last_activity ? Number(session.last_activity) * 1000 : null)}</time>
              </li>
            ))}
          </ul>
        ) : <div className="dash-empty">No active sessions found.</div>}
      </section>
    </div>
  )
}

function InboxPanel() {
  const { user } = useAuth()
  const toast = useToast()
  const [target, setTarget] = useState('5')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/api/app/inbox-settings').then(({ data }) => setTarget(String(data?.reply_target_minutes ?? 5))).catch(() => {})
  }, [])

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      const { data } = await api.patch('/api/app/inbox-settings', { reply_target_minutes: Number(target) })
      setTarget(String(data.reply_target_minutes))
      toast.success('Reply target updated.')
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to update the reply target.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card settings-panel">
      <header className="panel-header"><h2>Inbox</h2></header>
      <form className="form-grid" onSubmit={save}>
        <div className="field field-full">
          <label className="field-label" htmlFor="reply-target">First reply target (minutes)</label>
          <input id="reply-target" className="input" type="number" min="1" max="1440" required value={target} onChange={(event) => setTarget(event.target.value)} />
          <p className="field-hint">Dashboard attention alerts use this target. Between 1 and 1440 minutes.</p>
        </div>
        <div className="field field-full settings-actions">
          <button className="button button-primary" disabled={saving}>{saving ? 'Saving...' : 'Save inbox settings'}</button>
        </div>
      </form>
    </section>
  )
}

export default function SettingsPage() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const requestedTab = TAB_ALIASES[params.get('tab')] || params.get('tab')
  const sections = SECTIONS.filter((section) => (!section.module || hasModuleAccess(user, section.module)) && (!section.ownerOnly || user?.role === 'owner'))
  const activeSection = sections.find((section) => section.id === requestedTab) || sections[0]
  const tab = activeSection.id
  const externalTab = activeSection.to

  useEffect(() => {
    if (externalTab) router.visit(externalTab, { replace: true })
  }, [externalTab])
  const toast = useToast()
  const canManage = user?.role === 'owner'
  const [form, setForm] = useState(blankConfig)
  const [savedConfig, setSavedConfig] = useState(null)
  const [registration, setRegistration] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [savingMirror, setSavingMirror] = useState(false)
  const [status, setStatus] = useState('disconnected')
  const [connectionError, setConnectionError] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const mode = useColorMode()
  const theme = useAccentTheme()

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
      setSavedConfig(config)
      setForm({
        ...blankConfig,
        waba_id: config.waba_id || '',
        phone_number_id: config.phone_number_id || '',
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

  useEffect(() => {
    if (tab === 'whatsapp') load()
  }, [load, tab])

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
    if (form.pin.trim()) payload.pin = form.pin.trim()
    try {
      const { data } = await api.post('/api/app/whatsapp/config', payload)
      setRegistration(null)
      if (data.success === false) {
        toast.error(data.last_registration_error || 'WhatsApp registration failed.')
      } else {
        toast.success('WhatsApp settings saved successfully.')
      }
      await load()
      window.dispatchEvent(new Event('wacrm:whatsapp-changed'))
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
      setRegistration(null)
      setConfirmDisconnect(false)
      await load()
      window.dispatchEvent(new Event('wacrm:whatsapp-changed'))
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

  const verifyRegistration = async () => {
    setVerifying(true)
    setError('')
    try {
      const { data } = await api.get('/api/app/whatsapp/config/verify-registration')
      setRegistration(data)
      window.dispatchEvent(new Event('wacrm:whatsapp-changed'))
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to verify WhatsApp registration.'))
    } finally {
      setVerifying(false)
    }
  }

  const updateMirrorMedia = async (enabled) => {
    setSavingMirror(true)
    setError('')
    try {
      const { data } = await api.patch('/api/app/whatsapp/config/mirror-media', { mirror_inbound_media: enabled })
      setSavedConfig((current) => ({ ...current, mirror_inbound_media: data.mirror_inbound_media }))
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to update inbound media mirroring.'))
    } finally {
      setSavingMirror(false)
    }
  }

  const connected = ['connected', 'ok', 'active'].includes(String(status).toLowerCase())
  const badgeTone = connectionError ? 'rejected' : connected ? 'approved' : 'pending'

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <span className="settings-heading-icon"><Icon name="settings" size={31} /></span>
        <div><h1>Settings</h1><p>Manage your account, workspace and WhatsApp connection.</p></div>
      </header>
      <div className="settings-shell">
        <SettingsRail active={tab} sections={sections} params={params} />
        <div className="settings-main">
          {externalTab && <p role="status" className="muted">Opening {activeSection.label}…</p>}
          {tab === 'overview' && <OverviewPanel user={user} />}
          {tab === 'profile' && <ProfilePanel />}
          {tab === 'security' && <SecurityPanel />}
          {tab === 'inbox' && <InboxPanel />}
          {tab === 'api' && <ApiKeysPanel canManage={canManage} />}
          {tab === 'appearance' && (
            <div className="settings-layout">
              <section className="card appearance-card">
                <header className="panel-header"><h2>Appearance</h2></header>
                <div className="appearance-body">
                  <div className="appearance-row">
                    <div>
                      <h3 className="settings-section-title">Mode</h3>
                      <p className="field-hint">Choose how Aayojan AI Ping looks on this device.</p>
                    </div>
                    <div className="mode-switch" role="group" aria-label="Color mode">
                      <button type="button" aria-pressed={mode === 'light'} className={mode === 'light' ? 'is-active' : ''} onClick={() => changeAppearance({ mode: 'light' })}>
                        <Icon name="sun" size={15} /> Light
                      </button>
                      <button type="button" aria-pressed={mode === 'dark'} className={mode === 'dark' ? 'is-active' : ''} onClick={() => changeAppearance({ mode: 'dark' })}>
                        <Icon name="moon" size={15} /> Dark
                      </button>
                    </div>
                  </div>
                  <div className="appearance-row is-column">
                    <div>
                      <h3 className="settings-section-title">Accent color</h3>
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
            </div>
          )}
          {tab === 'whatsapp' && (
            <>
              {error && <div className="alert alert-error">{error}</div>}
              {!canManage && <div className="alert alert-info">Only the Owner can change WhatsApp connection settings.</div>}
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
                      <button type="button" className="icon-button" onClick={copyWebhook} aria-label="Copy webhook URL" title="Copy URL"><Icon name="copy" size={15} /></button>
                    </div>
                    <p className="guidance">
                      Add this URL in WhatsApp Manager under <strong>Configuration → Webhook</strong>, enter the verify token below,
                      and subscribe to the <strong>messages</strong> field. Save the configuration, then confirm the connection in Meta.
                    </p>
                    {savedConfig?.configured && (
                      <>
                        <h3 className="settings-section-title">Registration</h3>
                        <p className="guidance">{savedConfig.registered_at
                          ? `Registered ${new Date(savedConfig.registered_at).toLocaleString()}.`
                          : 'This number has no recorded registration. To register a production number, enter its Meta two-step verification PIN.'}</p>
                        <button type="button" className="button" onClick={verifyRegistration} disabled={verifying || saving}>
                          {verifying ? 'Verifying…' : 'Verify registration'}
                        </button>
                        {registration && (
                          <div className={`alert ${registration.live ? 'alert-info' : 'alert-error'} alert-inline`} role="status">
                            <strong>{registration.live ? 'Registration verified' : 'Registration checks are incomplete'}</strong>
                            {registration.checks?.phone_metadata_ok != null && <div>Phone metadata {registration.checks.phone_metadata_ok ? 'verified' : 'failed'}</div>}
                            {registration.checks?.waba_subscribed_to_app != null && <div>WABA subscription {registration.checks.waba_subscribed_to_app ? 'verified' : 'failed'}</div>}
                            {(registration.errors || []).map((message) => <div key={message}>{message}</div>)}
                          </div>
                        )}
                        <h3 className="settings-section-title">Inbound media</h3>
                        <label className="status-row">
                          <input type="checkbox" checked={savedConfig.mirror_inbound_media !== false}
                            disabled={!canManage || savingMirror || saving} onChange={(event) => updateMirrorMedia(event.target.checked)} />
                          Save copies of incoming attachments
                        </label>
                        <p className="guidance">Keeps incoming attachments up to 16 MB available after Meta removes them.</p>
                      </>
                    )}
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
                      <div className="field field-full">
                        <label className="field-label" htmlFor="wa-pin">Registration PIN</label>
                        <input id="wa-pin" className="input" type="password" inputMode="numeric" autoComplete="new-password"
                          pattern="[0-9]{6}" maxLength={6} placeholder="6-digit PIN from Meta WhatsApp Manager" disabled={!canManage || loading}
                          value={form.pin} onChange={(event) => setForm({ ...form, pin: event.target.value })} />
                        <span className="field-hint">Optional for Meta test numbers and previously registered numbers.</span>
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
            </>
          )}
        </div>
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
    </div>
  )
}
