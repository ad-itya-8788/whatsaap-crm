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

  const value = useMemo(() => ({
    success: (message) => push(message, 'success'),
    error: (message) => push(message, 'error'),
    warning: (message) => push(message, 'warning'),
    info: (message) => push(message, 'info'),
  }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
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
