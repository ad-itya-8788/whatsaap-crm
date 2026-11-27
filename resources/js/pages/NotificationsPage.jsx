import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Link } from '@inertiajs/react'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { NotificationUnreadContext } from '../context/NotificationUnreadContext.js'
import { hasModuleAccess } from '../lib/moduleAccess.js'
import { notificationAppearance } from '../lib/notificationAppearance.js'
import { errorMessage, extractList, extractPaginator, relativeTime } from '../lib/utils.js'

function NotificationRow({ item, busy, canOpenInbox, markRead }) {
  const { icon, tone } = notificationAppearance(item.type)
  const conversationId = item.data?.conversation_id || item.conversation_id
  const title = item.title || 'Notification'

  return (
    <li className={item.read_at ? 'note-row' : 'note-row is-unread'}>
      <span className={`note-icon note-tone-${tone}`}><Icon name={icon} size={18} /></span>
      <div className="note-copy">
        {conversationId && canOpenInbox ? (
          <Link href={`/inbox?c=${encodeURIComponent(conversationId)}`} onClick={() => markRead(item)}>{title}</Link>
        ) : <strong>{title}</strong>}
        {item.body && <p>{item.body}</p>}
        {item.created_at && <time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()}>{relativeTime(item.created_at)}</time>}
      </div>
      {!item.read_at && (
        <button type="button" className="icon-button" onClick={() => markRead(item)} disabled={busy} aria-label={`Mark as read: ${title}`} title="Mark as read">
          <Icon name="check" size={16} />
        </button>
      )}
    </li>
  )
}

export default function NotificationsPage() {
  const toast = useToast()
  const { user } = useAuth()
  const unreadCount = useContext(NotificationUnreadContext)
  const [items, setItems] = useState([])
  const [pagination, setPagination] = useState({ currentPage: 1, lastPage: 1, total: 0 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const request = useRef(null)
  const mutationInFlight = useRef(false)

  const load = useCallback(async (page = 1, background = false) => {
    if (mutationInFlight.current || (background && request.current)) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    if (!background) {
      setLoading(true)
      setError(null)
    }
    try {
      const { data } = await api.get('/api/app/notifications', { params: { per_page: 50, page }, signal: controller.signal })
      if (controller.signal.aborted) return
      setError(null)
      setItems(extractList(data))
      setPagination(extractPaginator(data))
    } catch (requestError) {
      if (!controller.signal.aborted && requestError.code !== 'ERR_CANCELED' && !background) {
        setError({ page, message: errorMessage(requestError, 'Unable to load notifications.') })
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => load(), 0)
    return () => {
      window.clearTimeout(initial)
      request.current?.abort()
      request.current = null
    }
  }, [load])

  useEffect(() => {
    if (loading || busy || error) return undefined
    const refresh = () => {
      if (document.visibilityState === 'visible') load(pagination.currentPage, true)
    }
    const timer = window.setInterval(refresh, 10000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('wacrm:notifications-changed', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('wacrm:notifications-changed', refresh)
    }
  }, [busy, error, load, loading, pagination.currentPage])

  const markRead = async (item) => {
    if (mutationInFlight.current || item?.read_at) return
    mutationInFlight.current = true
    setBusy(true)
    request.current?.abort()
    try {
      const { data } = await api.post(item ? `/api/app/notifications/${item.id}/read` : '/api/app/notifications/read-all')
      const readAt = data?.read_at || new Date().toISOString()
      setItems((current) => current.map((row) => !row.read_at && (!item || row.id === item.id) ? { ...row, read_at: readAt } : row))
      if (!item && data?.updated > 0) toast.success('All notifications marked as read.')
      window.dispatchEvent(new Event('wacrm:notifications-changed'))
    } catch (requestError) {
      toast.error(errorMessage(requestError, item ? 'Unable to mark this notification as read.' : 'Unable to update notifications.'))
    } finally {
      mutationInFlight.current = false
      setBusy(false)
    }
  }

  const canOpenInbox = hasModuleAccess(user, 'inbox')
  const canMarkAll = items.some((item) => !item.read_at) || (unreadCount ?? 0) > 0

  return (
    <div className="dash-page">
      <header className="dash-header">
        <div>
          <h1>Notifications</h1>
          <p>Updates from your team and conversations.</p>
        </div>
        {!error && canMarkAll && (
          <button type="button" className="button button-secondary" onClick={() => markRead()} disabled={busy || loading}>
            <Icon name="checks" size={16} /> Mark all as read
          </button>
        )}
      </header>

      <section className="note-panel" aria-label="Notification history" aria-busy={loading}>
        {loading ? (
          <div className="note-state" role="status"><span className="spinner" aria-hidden="true" /> Loading notifications…</div>
        ) : error ? (
          <div className="note-state">
            <Icon name="errorCircle" size={24} className="note-error-icon" />
            <strong role="alert">{error.message}</strong>
            <button type="button" className="button button-secondary" onClick={() => load(error.page)}>
              <Icon name="refresh" size={16} /> Retry
            </button>
          </div>
        ) : items.length ? (
          <ul className="note-list">
            {items.map((item) => <NotificationRow key={item.id} item={item} busy={busy} canOpenInbox={canOpenInbox} markRead={markRead} />)}
          </ul>
        ) : (
          <div className="note-state">
            <span className="note-icon"><Icon name="bellOff" size={20} /></span>
            <strong>You’re all caught up</strong>
            <span>New team and conversation updates will appear here.</span>
          </div>
        )}
        {!error && pagination.lastPage > 1 && (
          <div className="note-pagination">
            <button type="button" className="button button-secondary" disabled={busy || loading || pagination.currentPage <= 1} onClick={() => load(pagination.currentPage - 1)}>Previous</button>
            <span>Page {pagination.currentPage} of {pagination.lastPage}</span>
            <button type="button" className="button button-secondary" disabled={busy || loading || pagination.currentPage >= pagination.lastPage} onClick={() => load(pagination.currentPage + 1)}>Next</button>
          </div>
        )}
      </section>
    </div>
  )
}
