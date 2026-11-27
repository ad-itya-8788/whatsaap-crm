import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, router } from '@inertiajs/react'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { errorMessage, extractList, extractPaginator } from '../lib/utils.js'

const ACTIVE = ['sending', 'scheduled']

function RateCell({ value, total, read = false }) {
  const percent = total ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div className="bc-rate">
      <span className="bc-progress" aria-hidden="true"><span className={`bc-progress-bar${read ? ' bc-progress-read' : ''}`} style={{ width: `${percent}%` }} /></span>
      <small>{percent}%</small>
    </div>
  )
}

export default function BroadcastsPage() {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [pagination, setPagination] = useState({ currentPage: 1, lastPage: 1, total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const request = useRef(null)

  const load = useCallback(async (page = 1, background = false) => {
    if (background && request.current) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    if (!background) setLoading(true)
    if (!background) setError('')
    try {
      const { data } = await api.get('/api/app/broadcasts', { params: { per_page: 50, page }, signal: controller.signal })
      if (controller.signal.aborted) return
      setError('')
      setItems(extractList(data))
      setPagination(extractPaginator(data))
    } catch (requestError) {
      if (!background && requestError.code !== 'ERR_CANCELED') {
        setError(errorMessage(requestError, 'Unable to load broadcasts.'))
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => {
      window.clearTimeout(timer)
      request.current?.abort()
      request.current = null
    }
  }, [load])

  const polling = items.some((item) => ACTIVE.includes(item.status))

  useEffect(() => {
    if (!polling) return undefined
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(pagination.currentPage, true)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [polling, pagination.currentPage, load])

  const remove = async (item) => {
    if (!window.confirm(`Delete broadcast "${item.name}"? Recipient history will be removed.`)) return
    try {
      await api.delete(`/api/app/broadcasts/${item.id}`)
      toast.success('Broadcast deleted.')
      load(pagination.currentPage)
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to delete broadcast.'))
    }
  }

  return (
    <div className="dash-page">
      <header className="dash-header">
        <div>
          <h1>Broadcasts</h1>
          <p>Send approved templates to a targeted audience.</p>
        </div>
        <Link className="button button-primary" href="/broadcasts/new"><Icon name="plus" size={15} /> New broadcast</Link>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <section className="dash-card">
        {loading ? (
          <div className="dash-empty"><span className="spinner" /> Loading broadcasts…</div>
        ) : items.length ? (
          <div className="bc-table-wrap">
            <table className="bc-table">
              <thead>
                <tr>
                  <th>Name</th><th className="bc-col-medium">Template</th><th className="bc-col-small">Recipients</th>
                  <th className="bc-col-large">Delivery</th><th className="bc-col-large">Read</th>
                  <th>Status</th><th className="bc-col-small">Date</th><th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="bc-campaign-row" onClick={(event) => {
                    if (!event.target.closest('a, button')) router.visit(`/broadcasts/${item.id}`)
                  }}>
                    <td><Link href={`/broadcasts/${item.id}`}><strong>{item.name}</strong></Link></td>
                    <td className="bc-col-medium">{item.template?.name || item.template_name || '—'}</td>
                    <td className="bc-col-small">{item.total}</td>
                    <td className="bc-col-large"><RateCell value={item.delivered} total={item.total} /></td>
                    <td className="bc-col-large"><RateCell value={item.read} total={item.total} read /></td>
                    <td><span className={`badge badge-${item.status === 'completed' ? 'approved' : item.status === 'failed' ? 'rejected' : 'pending'}`}>{item.status}</span></td>
                    <td className="bc-col-small">{item.created_at ? new Date(item.created_at).toLocaleDateString() : '—'}</td>
                    <td><button type="button" className="icon-button is-danger" disabled={item.status === 'sending'} onClick={() => remove(item)} aria-label={`Delete ${item.name}`}><Icon name="trash" size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dash-empty">
            <Icon name="radio" size={22} />
            <span>No broadcasts yet.</span>
            <Link className="button button-primary" href="/broadcasts/new">Create your first broadcast</Link>
          </div>
        )}
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
