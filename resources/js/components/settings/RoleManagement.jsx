import { useState } from 'react'
import api from '../../api/client.js'
import { errorMessage } from '../../lib/utils.js'
import { useToast } from '../common/ToastProvider.jsx'

const blankRole = { name: '', module_access: [] }
const defaults = ['owner', 'agent', 'viewer']

export default function RoleManagement({ catalog, onSaved }) {
  const toast = useToast()
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const payload = { name: draft.name, module_access: draft.module_access }
      if (draft.id) await api.patch('/api/app/roles/' + draft.id, payload)
      else await api.post('/api/app/roles', payload)
      setDraft(null)
      await onSaved()
      toast.success(draft.id ? 'Role updated successfully.' : 'Role created successfully.')
    } catch (failure) {
      setError(errorMessage(failure, 'Unable to save role.'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(role) {
    if (busy || !window.confirm('Delete the ' + role.name + ' role?')) return
    setBusy(true)
    setError('')
    try {
      await api.delete('/api/app/roles/' + role.id)
      if (draft?.id === role.id) setDraft(null)
      await onSaved()
      toast.success('Role deleted.')
    } catch (failure) {
      setError(errorMessage(failure, 'Unable to delete role.'))
    } finally {
      setBusy(false)
    }
  }

  if (!catalog) return <p role="status">Loading roles...</p>

  const modules = Object.entries(catalog.modules)
  return <div className="team-grid">
    <section className="team-card">
      <header className="team-card-head">
        <h2>Roles</h2>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => setDraft(blankRole)}>New role</button>
      </header>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Role</th><th>Modules</th><th>Members</th><th>Actions</th></tr></thead>
        <tbody>{catalog.roles.map((role) => <tr key={role.id}>
          <td>{role.name}</td>
          <td>{role.slug === 'owner' ? 'All' : role.module_access.length}</td>
          <td>{role.users_count}</td>
          <td><div className="team-actions">
            {role.slug === 'owner' ? <span className="muted">Protected</span> :
              <button type="button" className="button button-secondary button-sm" disabled={busy} onClick={() => setDraft(role)}>Edit</button>}
            {!defaults.includes(role.slug) && role.users_count === 0 &&
              <button type="button" className="button button-danger button-sm" disabled={busy} onClick={() => remove(role)}>Delete</button>}
          </div></td>
        </tr>)}</tbody>
      </table></div>
    </section>
    {draft && <form className="team-card team-form" onSubmit={save}>
      <h2>{draft.id ? 'Edit role' : 'New role'}</h2>
      <label className="field">Role name<input className="input" required maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <fieldset className="team-module-options" disabled={busy}>
        <legend>Module access</legend>
        <div className="team-actions">
          <button type="button" className="button button-secondary button-sm" onClick={() => setDraft({ ...draft, module_access: modules.map(([key]) => key) })}>Select all</button>
          <button type="button" className="button button-secondary button-sm" onClick={() => setDraft({ ...draft, module_access: [] })}>Deselect all</button>
        </div>
        {modules.map(([key, module]) => <label className="team-module-option" key={key}>
          <input type="checkbox" checked={draft.module_access.includes(key)} onChange={(event) => setDraft({ ...draft, module_access: event.target.checked ? [...draft.module_access, key] : draft.module_access.filter((value) => value !== key) })} />
          {module.label}
        </label>)}
      </fieldset>
      <div className="team-actions">
        <button className="button button-primary" disabled={busy}>{busy ? 'Saving...' : 'Save role'}</button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
      </div>
    </form>}
  </div>
}
