import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client.js'
import ConfirmDialog from '../common/ConfirmDialog.jsx'
import Icon from '../common/Icon.jsx'
import { useToast } from '../common/ToastProvider.jsx'
import { errorMessage, formatDate } from '../../lib/utils.js'

const scopeLabels = {
  'messages:send': 'Send messages',
  'messages:read': 'Read messages',
  'contacts:read': 'Read contacts',
  'contacts:write': 'Write contacts',
  'conversations:read': 'Read conversations',
  'broadcasts:send': 'Launch broadcasts',
  'webhooks:manage': 'Manage webhooks',
}

export default function ApiKeysPanel({ can }) {
  const toast = useToast()
  const [keys, setKeys] = useState([])
  const [availableScopes, setAvailableScopes] = useState([])
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState([])
  const [token, setToken] = useState('')
  const [revoking, setRevoking] = useState(null)
  const canManage = can('api_keys.view')
  const [loading, setLoading] = useState(canManage)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (signal) => {
    try {
      const { data } = await api.get('/api/app/api-keys', { signal })
      setKeys(data.data)
      setAvailableScopes(data.scopes)
    } catch (err) {
      if (!signal?.aborted) setError(errorMessage(err, 'Unable to load API keys.'))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canManage) return
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [canManage, load])

  const create = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { data } = await api.post('/api/app/api-keys', { name, scopes })
      setKeys((items) => [data.data, ...items])
      setToken(data.token)
      setName('')
      setScopes([])
    } catch (err) {
      setError(errorMessage(err, 'Unable to create API key.'))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    setBusy(true)
    setError('')
    try {
      const { data } = await api.delete('/api/app/api-keys/' + revoking.id)
      setKeys((items) => items.map((key) => key.id === revoking.id ? data.data : key))
      setRevoking(null)
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to revoke API key.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card settings-panel">
      <header className="panel-header"><h2>API keys</h2></header>
      {!canManage ? <p className="muted">Only administrators can manage API keys.</p> : (
        <div className="settings-panel-stack">
          {error && <div className="alert alert-error">{error}</div>}
          {token && <div className="alert alert-info">
            <p>Copy this key now. It will only be shown once.</p>
            <input aria-label="New API key" className="input" readOnly value={token} onFocus={(e) => e.target.select()} />
            <div className="settings-actions">
              <button type="button" className="button button-sm button-secondary" onClick={async () => {
                try { await navigator.clipboard.writeText(token); toast.success('API key copied.') }
                catch { toast.error('Select and copy the key from the field.') }
              }}><Icon name="copy" size={15} /> Copy key</button>
              <button type="button" className="button button-sm button-ghost" onClick={() => setToken('')}>Done</button>
            </div>
          </div>}
          {can('api_keys.create') && !token && <form onSubmit={create} className="settings-panel-stack">
            <div className="field">
              <label className="field-label" htmlFor="key-name">Key name</label>
              <input className="input" id="key-name" value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} />
            </div>
            <fieldset>
              <legend className="field-label">Scopes</legend>
              {availableScopes.map((scope) => <label className="checkbox-label" key={scope}>
                <input type="checkbox" checked={scopes.includes(scope)} onChange={(e) => setScopes((items) => e.target.checked ? [...items, scope] : items.filter((item) => item !== scope))} />
                {scopeLabels[scope] || scope}
              </label>)}
            </fieldset>
            <div><button type="submit" className="button button-primary" disabled={busy || loading || !name.trim()}>Create API key</button></div>
          </form>}
          {loading && <p className="muted">Loading API keys…</p>}
          {!loading && keys.length === 0 && <p className="muted">No API keys yet.</p>}
          {keys.length > 0 && <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Scopes</th><th>Last used</th><th>Status</th></tr></thead>
              <tbody>{keys.map((key) => <tr key={key.id}>
                <td><strong>{key.name}</strong><br /><code>{key.key_prefix}…</code></td>
                <td>{key.scopes?.length ? key.scopes.join(', ') : '—'}</td>
                <td>{key.last_used_at ? formatDate(key.last_used_at) : 'Never'}</td>
                <td>{key.revoked_at ? 'Revoked' : can('api_keys.delete') && <button type="button" className="button button-sm button-secondary" onClick={() => setRevoking(key)}>Revoke</button>}</td>
              </tr>)}</tbody>
            </table>
          </div>}
          <ConfirmDialog open={Boolean(revoking)} title="Revoke API key?" message={revoking?.name} confirmLabel="Revoke key" busy={busy} onCancel={() => setRevoking(null)} onConfirm={revoke} />
        </div>
      )}
    </section>
  )
}
