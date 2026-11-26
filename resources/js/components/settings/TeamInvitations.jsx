import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client.js'
import { errorMessage, extractList, formatDate } from '../../lib/utils.js'
import ConfirmDialog from '../common/ConfirmDialog.jsx'
import Icon from '../common/Icon.jsx'
import { useToast } from '../common/ToastProvider.jsx'

export default function TeamInvitations({ showForm, onClose }) {
  const toast = useToast()
  const [list, setList] = useState([])
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revoking, setRevoking] = useState(null)
  const [url, setUrl] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/api/app/invitations', { params: { page } })
      setLastPage(data.last_page)
      if (page > data.last_page) setPage(data.last_page)
      setList(extractList(data))
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load pending invitations.'))
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => { void load() }, [load])

  async function create(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const { data } = await api.post('/api/app/invitations', {
        role: form.get('role'),
        label: form.get('label') || null,
        expiresInDays: Number(form.get('expiresInDays')),
      })
      setUrl(new URL(data.path, window.location.origin).href)
      if (page === 1) void load()
      else setPage(1)
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to create the invitation.'))
    } finally {
      setBusy(false)
    }
  }

  function close() {
    setUrl('')
    onClose()
  }

  async function revoke() {
    setBusy(true)
    setError('')
    try {
      await api.delete(`/api/app/invitations/${revoking.id}`)
      setRevoking(null)
      await load()
      toast.success('Invitation revoked.')
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to revoke the invitation.'))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Invitation link copied.')
    } catch {
      toast.error('Select and copy the invitation link.')
    }
  }

  return (
    <section className="team-card team-invitations">
      <header className="team-card-head"><h2>Pending invitations</h2></header>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {showForm && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) close() }}>
          <div className="confirm-dialog member-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="member-invite-title">
            <h2 id="member-invite-title">{url ? 'Invitation created' : 'Invite a team member'}</h2>
            {url ? (
              <div className="team-form">
                <p>Copy the link before closing. The link can only be shared from this screen.</p>
                <input className="input" aria-label="Invitation link" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
                <div className="team-actions">
                  <button type="button" className="button button-primary" onClick={copy}>Copy link</button>
                  <a className="button button-secondary" href={`https://wa.me/?text=${encodeURIComponent(`Join our WhatsApp CRM workspace: ${url}`)}`} target="_blank" rel="noreferrer">Send via WhatsApp</a>
                  <button type="button" className="button button-secondary" onClick={close}>Done</button>
                </div>
              </div>
            ) : (
              <form className="team-form" onSubmit={create}>
                <p>Create a one-time invitation link for your workspace.</p>
                {error && <div className="alert alert-error" role="alert">{error}</div>}
                <div className="form-grid">
                  <label className="field">Role<select className="select" name="role" defaultValue="agent"><option value="admin">Admin</option><option value="agent">Agent</option><option value="viewer">Viewer</option></select></label>
                  <label className="field">Expires after<select className="select" name="expiresInDays" defaultValue="7"><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></label>
                </div>
                <label className="field">Label (optional)<input className="input" name="label" maxLength={80} /></label>
                <div className="team-actions">
                  <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create invitation'}</button>
                  <button type="button" className="button button-secondary" disabled={busy} onClick={close}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Label</th><th>Role</th><th>Expires</th><th>Actions</th></tr></thead>
          <tbody>
            {list.map((invite) => <tr key={invite.id}>
              <td>{invite.label || '—'}</td>
              <td><span className={`role-badge role-${invite.role}`}>{invite.role}</span></td>
              <td>{formatDate(invite.expires_at)}</td>
              <td><button type="button" className="button button-sm button-secondary" onClick={() => setRevoking(invite)}><Icon name="trash" size={14} /> Revoke</button></td>
            </tr>)}
            {loading && <tr><td colSpan="4" className="table-empty"><span className="spinner" /> Loading invitations…</td></tr>}
            {!loading && !list.length && !error && <tr><td colSpan="4" className="team-empty">No pending invitations.</td></tr>}
          </tbody>
        </table>
      </div>
      {lastPage > 1 && (
        <div className="pagination">
          <span className="muted">Page {page} of {lastPage}</span>
          <div className="pagination-actions">
            <button type="button" className="button button-sm button-secondary" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button type="button" className="button button-sm button-secondary" disabled={loading || page >= lastPage} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      )}
      <ConfirmDialog open={Boolean(revoking)} title="Revoke invitation?" message="Anyone with this link will lose access to it." confirmLabel="Revoke invitation" busy={busy} onConfirm={revoke} onCancel={() => setRevoking(null)} />
    </section>
  )
}
