import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { errorMessage, extractList, extractPaginator, relativeTime } from '../lib/utils.js'

const ACTIVE = ['sending', 'scheduled']

export default function BroadcastsPage() {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [pagination, setPagination] = useState({ currentPage: 1, lastPage: 1, total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (page = 1) => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/api/app/broadcasts', { params: { per_page: 50, page } })
      setItems(extractList(data))
      setPagination(extractPaginator(data))
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load broadcasts.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const polling = items.some((item) => ACTIVE.includes(item.status))

  useEffect(() => {
    if (!polling) return undefined
    const timer = window.setInterval(() => load(pagination.currentPage), 5000)
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
        <Link className="button button-primary" to="/broadcasts/new"><Icon name="plus" size={15} /> New broadcast</Link>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <section className="dash-card">
        {loading ? (
          <div className="dash-empty"><span className="spinner" /> Loading broadcasts…</div>
        ) : items.length ? (
          <div className="bc-table-wrap">
            <table className="bc-table">
              <thead>
                <tr><th>Name</th><th>Status</th><th>Audience</th><th>Delivery</th><th>Created</th><th /></tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td><Link to={`/broadcasts/${item.id}`}><strong>{item.name}</strong></Link><small>{item.template?.name}</small></td>
                    <td><span className={`badge badge-${item.status === 'completed' ? 'approved' : item.status === 'failed' ? 'rejected' : 'pending'}`}>{item.status}</span></td>
                    <td>{item.total}</td>
                    <td><span className="bc-progress"><span className="bc-progress-bar" style={{ width: `${item.total ? Math.round((item.sent / item.total) * 100) : 0}%` }} /></span><small>{item.sent}/{item.total} · {item.failed} failed</small></td>
                    <td>{relativeTime(item.created_at)}</td>
                    <td className="bc-actions"><Link to={`/broadcasts/${item.id}`} className="icon-button" title="View"><Icon name="eye" size={15} /></Link><button type="button" className="icon-button" onClick={() => remove(item)} title="Delete"><Icon name="trash" size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dash-empty">
            <Icon name="radio" size={22} />
            <span>No broadcasts yet.</span>
            <Link className="button button-primary" to="/broadcasts/new">Create your first broadcast</Link>
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
