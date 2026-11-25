import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { errorMessage, extractList, extractPaginator, relativeTime } from '../lib/utils.js'

const STATS = [
  ['Total', 'total', 'users'],
  ['Sent', 'sent', 'send'],
  ['Delivered', 'delivered', 'checkCircle'],
  ['Read', 'read', 'eye'],
  ['Replied', 'replied', 'reply'],
  ['Failed', 'failed', 'alertCircle'],
]

export default function BroadcastDetailPage() {
  const { id } = useParams()
  const toast = useToast()
  const [broadcast, setBroadcast] = useState(null)
  const [recipients, setRecipients] = useState([])
  const [pagination, setPagination] = useState({ currentPage: 1, lastPage: 1, total: 0 })
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (page = 1) => {
    setError('')
    try {
      const { data } = await api.get(`/api/app/broadcasts/${id}`, {
        params: { per_page: 50, page, status },
      })
      setBroadcast(data.broadcast)
      setRecipients(extractList(data.recipients))
      setPagination(extractPaginator(data.recipients))
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load this broadcast.'))
    }
  }, [id, status])

  useEffect(() => { load() }, [load])

  const active = broadcast && ['sending', 'scheduled'].includes(broadcast.status)
  useEffect(() => {
    if (!active) return undefined
    const timer = window.setInterval(() => load(pagination.currentPage), 5000)
    return () => window.clearInterval(timer)
  }, [active, pagination.currentPage, load])

  const action = async (name) => {
    try {
      const { data } = await api.post(`/api/app/broadcasts/${id}/${name}`)
      toast.success(name === 'resume' ? `${data.queued} failed recipient(s) queued again.` : `${data.queued} pending recipient(s) queued again.`)
      load(pagination.currentPage)
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to update this broadcast.'))
    }
  }

  const remove = async () => {
    if (!window.confirm('Delete this broadcast and its recipient history?')) return
    try {
      await api.delete(`/api/app/broadcasts/${id}`)
      toast.success('Broadcast deleted.')
      window.location.assign('/broadcasts')
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to delete this broadcast.'))
    }
  }

  return (
    <div className="dash-page">
      <header className="dash-header">
        <div>
          <Link className="bc-back" to="/broadcasts"><Icon name="back" size={14} /> Broadcasts</Link>
          <h1>{broadcast?.name || 'Broadcast'}</h1>
          <p>{broadcast?.template?.name} · Created {broadcast ? relativeTime(broadcast.created_at) : '…'}</p>
        </div>
        <div className="bc-detail-actions">
          <a className="button button-secondary" href={`/api/app/broadcasts/${id}/export`}><Icon name="download" size={14} /> Export CSV</a>
          {broadcast?.status === 'failed' || broadcast?.failed ? <button type="button" className="button button-secondary" onClick={() => action('resume')}>Retry failed</button> : null}
          {broadcast?.status === 'draft' ? <button type="button" className="button button-primary" onClick={() => action('send')}>Send now</button> : null}
          <button type="button" className="button button-danger" onClick={remove}><Icon name="trash" size={14} /></button>
        </div>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {broadcast ? <div className="badge badge-pending bc-status">Status: {broadcast.status}</div> : null}

      <div className="bc-stat-grid">
        {STATS.map(([label, key, icon]) => (
          <div className="dash-card bc-stat" key={key}>
            <span><Icon name={icon} size={15} /> {label}</span>
            <strong>{broadcast?.[key] ?? 0}</strong>
          </div>
        ))}
      </div>

      <section className="dash-card">
        <header className="bc-recipients-header">
          <h2>Recipients</h2>
          <select className="input bc-filter" value={status} onChange={(event) => { setStatus(event.target.value); load(1) }}>
            <option value="">All statuses</option>
            {['pending', 'sent', 'delivered', 'read', 'replied', 'failed', 'skipped'].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </header>
        <div className="bc-table-wrap">
          <table className="bc-table">
            <thead><tr><th>Contact</th><th>Phone</th><th>Status</th><th>Sent</th><th>Error</th></tr></thead>
            <tbody>
              {recipients.map((item) => (
                <tr key={item.id}>
                  <td>{item.contact?.name || 'Unknown'}</td>
                  <td>{item.contact?.phone || '—'}</td>
                  <td><span className={`badge badge-${item.status === 'failed' ? 'rejected' : item.status === 'read' || item.status === 'replied' ? 'approved' : 'pending'}`}>{item.status}</span></td>
                  <td>{item.sent_at ? relativeTime(item.sent_at) : '—'}</td>
                  <td className="bc-error">{item.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!recipients.length ? <div className="dash-empty">No recipients matched.</div> : null}
        </div>
        {pagination.lastPage > 1 ? (
          <div className="note-pagination">
            <button type="button" className="button button-secondary" disabled={pagination.currentPage <= 1} onClick={() => load(pagination.currentPage - 1)}>Previous</button>
            <span>Page {pagination.currentPage} of {pagination.lastPage}</span>
            <button type="button" className="button button-secondary" disabled={pagination.currentPage >= pagination.lastPage} onClick={() => load(pagination.currentPage + 1)}>Next</button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
