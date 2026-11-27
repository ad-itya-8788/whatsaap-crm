import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, router, usePage } from '@inertiajs/react'
import api from '../api/client.js'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
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

function DeliveryFunnel({ broadcast }) {
  const steps = STATS.slice(1, 5)
  const max = Math.max(1, broadcast.total)

  return (
    <section className="dash-card bc-funnel">
      <h2>Delivery funnel</h2>
      <ul>
        {steps.map(([label, key]) => (
          <li key={key}>
            <span>{label}</span>
            <span className="bc-progress" aria-hidden="true"><span className={`bc-progress-bar bc-funnel-${key}`} style={{ width: `${Math.min(100, (broadcast[key] / max) * 100)}%` }} /></span>
            <strong>{broadcast[key]}</strong>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function BroadcastDetailPage() {
  const { id } = usePage().props
  const toast = useToast()
  const [broadcast, setBroadcast] = useState(null)
  const [recipients, setRecipients] = useState([])
  const [pagination, setPagination] = useState({ currentPage: 1, lastPage: 1, total: 0 })
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const request = useRef(null)
  const canSend = true

  const load = useCallback(async (page = 1, background = false) => {
    if (background && request.current) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    if (!background) {
      setError('')
      setLoading(true)
    }
    try {
      const { data } = await api.get(`/api/app/broadcasts/${id}`, {
        params: { per_page: 50, page, status },
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setError('')
      setBroadcast(data.broadcast)
      setRecipients(extractList(data.recipients))
      setPagination(extractPaginator(data.recipients))
    } catch (requestError) {
      if (!controller.signal.aborted && requestError.code !== 'ERR_CANCELED' && !background) {
        setError(errorMessage(requestError, 'Unable to load this broadcast.'))
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        setLoading(false)
      }
    }
  }, [id, status])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => {
      window.clearTimeout(timer)
      request.current?.abort()
      request.current = null
    }
  }, [load])

  const active = broadcast && ['sending', 'scheduled'].includes(broadcast.status)
  useEffect(() => {
    if (!active) return undefined
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !busy && !loading) load(pagination.currentPage, true)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [active, busy, loading, pagination.currentPage, load])

  const action = async (name) => {
    if (busy) return
    setBusy(name)
    try {
      const { data } = await api.post(`/api/app/broadcasts/${id}/${name}`)
      const messages = {
        send: data.status === 'scheduled' ? 'Broadcast scheduled.' : 'Broadcast queued.',
        resume: `${data.queued} failed recipient(s) queued again.`,
        'retry-pending': `${data.queued} pending recipient(s) queued again.`,
      }
      toast.success(messages[name])
      await load(pagination.currentPage)
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to update this broadcast.'))
    } finally {
      setBusy('')
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy('delete')
    try {
      await api.delete(`/api/app/broadcasts/${id}`)
      toast.success('Broadcast deleted.')
      router.visit('/broadcasts')
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to delete this broadcast.'))
    } finally {
      setBusy('')
    }
  }

  const pending = broadcast?.pending ?? (broadcast?.status === 'sending' ? Math.max(0, broadcast.total - broadcast.sent - broadcast.failed) : 0)
  const failed = broadcast?.failed || 0

  return (
    <div className="dash-page">
      <header className="dash-header">
        <div>
          <Link className="bc-back" href="/broadcasts"><Icon name="back" size={14} /> Broadcasts</Link>
          <div className="bc-detail-title">
            <h1>{broadcast?.name || 'Broadcast'}</h1>
            {broadcast && <span className="badge badge-pending">{broadcast.status}</span>}
          </div>
          {broadcast && <p>{broadcast.template?.name || broadcast.template_name || 'Template unavailable'} · Created {relativeTime(broadcast.created_at)}</p>}
        </div>
        <div className="bc-detail-actions">
          {canSend && broadcast?.status === 'draft' && <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => action('send')}>Send now</button>}
          {broadcast && (
            <button type="button" className="button button-danger" disabled={Boolean(busy) || broadcast.status === 'sending'} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={14} /> Delete</button>
          )}
        </div>
      </header>

      {error && <div className="alert alert-error">{error} <button type="button" className="link-button" onClick={() => load(pagination.currentPage)}>Retry</button></div>}
      {!broadcast && loading && <div className="dash-empty"><span className="spinner" /> Loading broadcast…</div>}

      {broadcast && canSend && broadcast.status !== 'scheduled' && (pending > 0 || failed > 0) && (
        <div className="dash-card bc-recovery">
          <div>
            <strong>Outstanding recipients</strong>
            <p className="muted">{pending} pending · {failed} failed</p>
          </div>
          <div className="bc-detail-actions">
            {pending > 0 && <button type="button" className="button button-sm button-primary" disabled={Boolean(busy)} onClick={() => action('retry-pending')}>Resume pending</button>}
            {failed > 0 && <button type="button" className="button button-sm button-secondary" disabled={Boolean(busy)} onClick={() => action('resume')}>Retry failed</button>}
          </div>
        </div>
      )}

      {broadcast && <div className="bc-stat-grid">
        {STATS.map(([label, key, icon]) => (
          <div className="dash-card bc-stat" key={key}>
            <span><Icon name={icon} size={15} /> {label}</span>
            <strong>{broadcast?.[key] ?? 0}</strong>
          </div>
        ))}
      </div>}
      {broadcast && <DeliveryFunnel broadcast={broadcast} />}

      {broadcast && <section className="dash-card">
        <header className="bc-recipients-header">
          <h2>Recipients ({pagination.total})</h2>
          <div className="bc-detail-actions">
            <select className="input bc-filter" aria-label="Filter recipients by status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {['pending', 'sent', 'delivered', 'read', 'replied', 'failed', 'skipped'].map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <a className="button button-secondary" href={`/api/app/broadcasts/${id}/export`}><Icon name="download" size={14} /> Export CSV</a>
          </div>
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
          {loading ? <div className="dash-empty"><span className="spinner" /> Loading recipients…</div> : !recipients.length && <div className="dash-empty">No recipients matched.</div>}
        </div>
        {pagination.lastPage > 1 ? (
          <div className="note-pagination">
            <button type="button" className="button button-secondary" disabled={pagination.currentPage <= 1} onClick={() => load(pagination.currentPage - 1)}>Previous</button>
            <span>Page {pagination.currentPage} of {pagination.lastPage}</span>
            <button type="button" className="button button-secondary" disabled={pagination.currentPage >= pagination.lastPage} onClick={() => load(pagination.currentPage + 1)}>Next</button>
          </div>
        ) : null}
      </section>}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete broadcast?"
        message="Delete this broadcast and its recipient history?"
        confirmLabel="Delete"
        busy={busy === 'delete'}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    </div>
  )
}
