import { useCallback, useEffect, useState } from 'react'
import api from '../api/client.js'
import PageHeader from '../components/common/PageHeader.jsx'
import Icon from '../components/common/Icon.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { errorMessage, extractList, extractPaginator, isAdmin } from '../lib/utils.js'

const blankCreate = { name: '', email: '', password: '', password_confirmation: '', role: 'agent' }
const blankEdit = { name: '', email: '', role: 'agent', password: '', password_confirmation: '', is_active: true }

function roleLabel(role) {
  const value = String(role || 'agent')
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export default function TeamPage() {
  const { user } = useAuth()
  const toast = useToast()
  const isOwner = String(user?.role || '').toLowerCase() === 'owner'
  const canManage = isAdmin(user)
  const roles = isOwner ? ['agent', 'admin', 'owner'] : ['agent']
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [paginator, setPaginator] = useState({ currentPage: 1, lastPage: 1, total: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ ...blankCreate, role: roles[0] })
  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState(blankEdit)
  const [deactivationTarget, setDeactivationTarget] = useState(null)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/api/app/users', {
        params: { search: debouncedSearch || undefined, page, per_page: 15 },
      })
      setUsers(extractList(data))
      setPaginator(extractPaginator(data))
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load team members.'))
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, page])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => { if (canManage) loadUsers() }, [canManage, loadUsers])

  const startCreate = () => {
    setShowCreate(true)
    setEditId(null)
    setCreateForm({ ...blankCreate, role: roles[0] })
    setError('')
    setNotice('')
  }

  const create = async (event) => {
    event.preventDefault()
    if (!createForm.name.trim() || !createForm.email.trim() || !createForm.password) {
      setError('Name, email and password are required.')
      return
    }
    if (createForm.password !== createForm.password_confirmation) {
      setError('Passwords do not match.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await api.post('/api/app/users', {
        name: createForm.name.trim(),
        email: createForm.email.trim(),
        password: createForm.password,
        password_confirmation: createForm.password_confirmation,
        role: createForm.role,
      })
      setNotice('Team member created.')
      toast.success('Team member created.')
      setShowCreate(false)
      setCreateForm({ ...blankCreate, role: roles[0] })
      await loadUsers()
    } catch (requestError) {
      const message = errorMessage(requestError, 'Unable to create the team member.')
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (member) => {
    setEditId(member.id)
    setShowCreate(false)
    setEditForm({
      name: member.name || '',
      email: member.email || '',
      role: roles.includes(member.role) ? member.role : roles[0],
      password: '',
      password_confirmation: '',
      is_active: member.is_active !== false,
    })
    setError('')
    setNotice('')
  }

  const toggleActive = (checked, member) => {
    if (!checked) {
      setDeactivationTarget(member)
      return
    }
    setEditForm((current) => ({ ...current, is_active: true }))
  }

  const confirmDeactivation = () => {
    setEditForm((current) => ({ ...current, is_active: false }))
    setDeactivationTarget(null)
  }

  const update = async (event) => {
    event.preventDefault()
    if (!editForm.name.trim() || !editForm.email.trim()) {
      setError('Name and email are required.')
      return
    }
    if (editForm.password && editForm.password !== editForm.password_confirmation) {
      setError('Passwords do not match.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    const payload = {
      name: editForm.name.trim(),
      email: editForm.email.trim(),
      role: editForm.role,
      is_active: editForm.is_active,
    }
    if (editForm.password) {
      payload.password = editForm.password
      payload.password_confirmation = editForm.password_confirmation
    }
    try {
      await api.patch(`/api/app/users/${editId}`, payload)
      setNotice('Team member updated.')
      toast.success('Team member updated.')
      setEditId(null)
      await loadUsers()
    } catch (requestError) {
      const current = users.find((member) => member.id === editId)
      setEditForm((formState) => ({
        ...formState,
        is_active: current ? current.is_active !== false : formState.is_active,
      }))
      const message = errorMessage(requestError, 'Unable to update the team member.')
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return (
      <>
        <PageHeader title="Team" subtitle="Manage the people who work in this workspace." />
        <div className="card team-empty"><Icon name="shield" size={28} /><p>Only admins and owners can manage team members.</p></div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Manage team members, roles and access."
        actions={<button type="button" className="button button-primary" onClick={startCreate}><Icon name="plus" size={16} /> Add member</button>}
      />
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {showCreate && (
        <section className="team-card team-form">
          <header className="panel-header">
            <h2>New team member</h2>
            <button type="button" className="icon-button" onClick={() => setShowCreate(false)} aria-label="Close form"><Icon name="close" size={18} /></button>
          </header>
          <form onSubmit={create}>
            <div className="form-grid">
              <div className="field">
                <label className="field-label" htmlFor="team-create-name">Name</label>
                <input id="team-create-name" className="input" required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="team-create-email">Email</label>
                <input id="team-create-email" className="input" type="email" required value={createForm.email} onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="team-create-role">Role</label>
                <select id="team-create-role" className="select" value={createForm.role} onChange={(event) => setCreateForm({ ...createForm, role: event.target.value })}>
                  {roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="team-create-password">Password</label>
                <input id="team-create-password" className="input" type="password" autoComplete="new-password" required value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="team-create-confirm">Confirm password</label>
                <input id="team-create-confirm" className="input" type="password" autoComplete="new-password" required value={createForm.password_confirmation} onChange={(event) => setCreateForm({ ...createForm, password_confirmation: event.target.value })} />
              </div>
            </div>
            <div className="team-actions">
              <button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Creating...' : 'Create member'}</button>
              <button type="button" className="button button-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </section>
      )}

      <div className="team-grid">
        <section className="team-card">
          <div className="card-toolbar">
            <div className="search-wrap search-wide">
              <Icon name="search" size={16} />
              <input
                className="input search-input"
                type="search"
                aria-label="Search team members"
                placeholder="Search name or email..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <span className="muted">{paginator.total} members</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {users.map((member) => (
                  editId === member.id ? (
                    <tr key={member.id} className="team-edit-row">
                      <td colSpan="5">
                        <form className="team-form" onSubmit={update}>
                          <div className="form-grid">
                            <div className="field">
                              <label className="field-label" htmlFor={`team-edit-name-${member.id}`}>Name</label>
                              <input id={`team-edit-name-${member.id}`} className="input" required value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} />
                            </div>
                            <div className="field">
                              <label className="field-label" htmlFor={`team-edit-email-${member.id}`}>Email</label>
                              <input id={`team-edit-email-${member.id}`} className="input" type="email" required value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} />
                            </div>
                            <div className="field">
                              <label className="field-label" htmlFor={`team-edit-role-${member.id}`}>Role</label>
                              <select id={`team-edit-role-${member.id}`} className="select" value={editForm.role} disabled={Number(user?.id) === Number(member.id)} onChange={(event) => setEditForm({ ...editForm, role: event.target.value })}>
                                {roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                              </select>
                            </div>
                            <div className="field">
                              <label className="field-label" htmlFor={`team-edit-password-${member.id}`}>New password (optional)</label>
                              <input id={`team-edit-password-${member.id}`} className="input" type="password" autoComplete="new-password" value={editForm.password} onChange={(event) => setEditForm({ ...editForm, password: event.target.value })} />
                            </div>
                            <div className="field">
                              <label className="field-label" htmlFor={`team-edit-confirm-${member.id}`}>Confirm password</label>
                              <input id={`team-edit-confirm-${member.id}`} className="input" type="password" autoComplete="new-password" value={editForm.password_confirmation} onChange={(event) => setEditForm({ ...editForm, password_confirmation: event.target.value })} />
                            </div>
                            <div className="field">
                              <label className="field-label" htmlFor={`team-edit-active-${member.id}`}>Active</label>
                              <input id={`team-edit-active-${member.id}`} type="checkbox" checked={editForm.is_active} disabled={Number(user?.id) === Number(member.id)} onChange={(event) => toggleActive(event.target.checked, member)} />
                            </div>
                          </div>
                          <div className="team-actions">
                            <button type="submit" className="button button-sm button-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                            <button type="button" className="button button-sm button-secondary" onClick={() => setEditId(null)}>Cancel</button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={member.id} className={member.is_active === false ? 'is-inactive' : ''}>
                      <td><strong>{member.name || 'Unnamed member'}</strong>{Number(user?.id) === Number(member.id) && <span className="muted"> (you)</span>}</td>
                      <td>{member.email}</td>
                      <td><span className={`role-badge role-${String(member.role || 'agent').toLowerCase()}`}>{roleLabel(member.role)}</span></td>
                      <td><span className={`status-dot ${member.is_active === false ? 'is-offline' : 'is-online'}`} /> {member.is_active === false ? 'Inactive' : 'Active'}</td>
                      <td>
                        <div className="team-actions">
                          <button type="button" className="button button-sm button-secondary" onClick={() => startEdit(member)}><Icon name="edit" size={14} /> Edit</button>
                        </div>
                      </td>
                    </tr>
                  )
                ))}
                {loading && <tr><td colSpan="5" className="table-empty"><span className="spinner" /> Loading team members...</td></tr>}
                {!loading && !users.length && <tr><td colSpan="5" className="team-empty">{search ? 'No team members match your search.' : 'No team members yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span className="muted">{loading ? 'Loading team...' : `Page ${paginator.currentPage} of ${paginator.lastPage}`}</span>
            <div className="pagination-actions">
              <button type="button" className="button button-sm button-secondary" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
              <button type="button" className="button button-sm button-secondary" disabled={loading || page >= paginator.lastPage} onClick={() => setPage((value) => value + 1)}>Next</button>
            </div>
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={Boolean(deactivationTarget)}
        title="Deactivate team member?"
        message={deactivationTarget ? `${deactivationTarget.name || 'This member'} will no longer be able to sign in until reactivated.` : ''}
        confirmLabel="Deactivate"
        busy={saving}
        onConfirm={confirmDeactivation}
        onCancel={() => setDeactivationTarget(null)}
      />
    </>
  )
}
