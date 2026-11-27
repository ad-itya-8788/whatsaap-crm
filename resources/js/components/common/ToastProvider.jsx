import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const itemsRef = useRef([])

  const commit = useCallback((items) => {
    itemsRef.current = items
    setToasts(items)
  }, [])

  const dismiss = useCallback((id) => {
    commit(itemsRef.current.filter((item) => item.id !== id))
  }, [commit])

  const push = useCallback((message, type = 'info') => {
    const text = String(message || '').trim()
    if (!text || itemsRef.current.some((item) => item.message === text && item.type === type)) return
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    commit([...itemsRef.current.slice(-3), { id, message: text, type }])
    window.setTimeout(() => dismiss(id), 4500)
  }, [commit, dismiss])

  const notify = useCallback((notice) => {
    const title = String(notice?.title || '').trim()
    const message = String(notice?.message || '').trim()
    if (!title && !message) return
    const type = ['success', 'error', 'warning', 'info'].includes(notice?.type) ? notice.type : 'info'
    if (itemsRef.current.some((item) => item.title === title && item.message === message && item.type === type)) return
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    commit([...itemsRef.current.slice(-2), {
      id,
      title,
      message,
      type,
      icon: notice?.icon || (type === 'error' || type === 'warning' ? 'alert' : 'bell'),
      href: notice?.href || '',
    }])
    window.setTimeout(() => dismiss(id), 6500)
  }, [commit, dismiss])

  const value = useMemo(() => ({
    success: (message) => push(message, 'success'),
    error: (message) => push(message, 'error'),
    warning: (message) => push(message, 'warning'),
    info: (message) => push(message, 'info'),
    notify,
  }), [push, notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => toast.title ? (
          <div className={`toast toast-${toast.type} toast-notice`} key={toast.id}>
            <span className="toast-notice-icon"><Icon name={toast.icon || 'bell'} size={17} /></span>
            <div className="toast-notice-copy">
              <strong>{toast.title}</strong>
              {toast.message && <span>{toast.message}</span>}
              {toast.href && <a className="toast-notice-action" href={toast.href}>Open <Icon name="arrowRight" size={12} /></a>}
            </div>
            <button type="button" className="icon-button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
              <Icon name="close" size={14} />
            </button>
          </div>
        ) : (
          <div className={`toast toast-${toast.type}`} key={toast.id}>
            <Icon name={toast.type === 'error' || toast.type === 'warning' ? 'alert' : toast.type === 'success' ? 'checkCircle' : 'chat'} size={16} />
            <span>{toast.message}</span>
            <button type="button" className="icon-button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used within ToastProvider')
  return value
}
