import { useAuth } from '../context/AuthContext.jsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@inertiajs/react'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { errorMessage, extractList, extractPaginator, relativeTime } from '../lib/utils.js'
import { useToast } from '../components/common/ToastProvider.jsx'

export default function NotificationsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const [items, setItems] = useState([])
  const [pagination, setPagination] = useState({ currentPage: 1, lastPage: 1, total: 0 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(null)

  const load = useCallback(async (page = 1, background = false) => {
    if (background && request.current) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    if (!background) {
      setLoading(true)
      setError('')
    }
    try {
      const { data } = await api.get('/api/app/notifications', { params: { per_page: 50, page }, signal: controller.signal })
      if (controller.signal.aborted) return
      setError('')
      setItems(extractList(data))
      setPagination(extractPaginator(data))
    } catch (requestError) {
      if (!controller.signal.aborted && requestError.code !== 'ERR_CANCELED' && !background) setError(errorMessage(requestError, 'Unable to load notifications.'))
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
  useEffect(() => {
    if (busy || loading) return undefined
    const refresh = () => {
      if (document.visibilityState === 'visible') load(pagination.currentPage, true)
    }
    const timer = window.setInterval(refresh, 10000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [busy, load, loading, pagination.currentPage])

  const markRead = async (item) => {
    if (item.read_at) return
    setBusy(true)
    try {
      await api.post(`/api/app/notifications/${item.id}/read`)
      request.current?.abort()
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row))
      window.dispatchEvent(new Event('wacrm:notifications-changed'))
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to mark this notification as read.'))
    } finally {
      setBusy(false)
    }
  }

  const markAllRead = async () => {
    setBusy(true)
    try {
      await api.post('/api/app/notifications/read-all')
      request.current?.abort()
      setItems((current) => current.map((row) => ({ ...row, read_at: row.read_at || new Date().toISOString() })))
      toast.success('All notifications marked as read.')
      window.dispatchEvent(new Event('wacrm:notifications-changed'))
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to update notifications.'))
    } finally {
      setBusy(false)
    }
  }

  const unread = items.filter((item) => !item.read_at).length

  return (
    <div className="dash-page">
      <header className="dash-header">
        <div>
          <h1>Notifications</h1>
          <p>Updates from your team and conversations.</p>
        </div>
        {unread > 0 && can('notifications.mark_read') ? (
          <button type="button" className="button button-secondary" onClick={markAllRead} disabled={busy}>
            Mark all as read
          </button>
        ) : null}
      </header>

      {error ? <div className="alert alert-error">{error} <button type="button" className="link-button" onClick={() => load(pagination.currentPage)}>Retry</button></div> : null}

      <section className="dash-card">
        {loading ? (
          <div className="dash-empty"><span className="spinner" /> Loading notifications…</div>
        ) : items.length ? (
          <ul className="note-list">
            {items.map((item) => {
              const conversationId = item.data?.conversation_id || item.conversation_id
              const content = (
                <>
                  <span className={`dash-activity-icon${item.read_at ? ' is-read' : ''}`}>
                    <Icon name={item.type === 'conversation_assigned' ? 'users' : 'bell'} size={14} />
                  </span>
                  <span className="dash-activity-text">
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                  </span>
                  <time>{relativeTime(item.created_at)}</time>
                  {!item.read_at ? <span className="note-unread-dot" /> : null}
                </>
              )

              return (
                <li key={item.id} className={item.read_at ? '' : 'is-unread'}>
                  {conversationId ? (
                    <Link className="note-link" href={`/inbox?c=${conversationId}`} onClick={can('notifications.mark_read') ? () => markRead(item) : undefined}>
                      {content}
                    </Link>
                  ) : can('notifications.mark_read') ? (
                    <button type="button" className="note-link" onClick={() => markRead(item)} disabled={busy}>
                      {content}
                    </button>
                  ) : <div className="note-link">{content}</div>}
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="dash-empty">You are all caught up.</div>
        )}
        {pagination.lastPage > 1 ? (
          <div className="note-pagination">
            <button type="button" className="button button-secondary" disabled={busy || loading || pagination.currentPage <= 1} onClick={() => load(pagination.currentPage - 1)}>Previous</button>
            <span>Page {pagination.currentPage} of {pagination.lastPage}</span>
            <button type="button" className="button button-secondary" disabled={busy || loading || pagination.currentPage >= pagination.lastPage} onClick={() => load(pagination.currentPage + 1)}>Next</button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
