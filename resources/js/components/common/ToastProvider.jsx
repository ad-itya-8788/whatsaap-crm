import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react'

const ToastContext = createContext(null)
const variants = {
  success: { title: 'Success', Glyph: CircleCheck, duration: 4500 },
  error: { title: 'Action failed', Glyph: CircleX, duration: 7000 },
  warning: { title: 'Warning', Glyph: TriangleAlert, duration: 6500 },
  info: { title: 'Information', Glyph: Info, duration: 4500 },
}

function Toast({ item, onDismiss }) {
  const { Glyph } = variants[item.type]
  return (
    <div className={`toast toast-${item.type}`}>
      <span className="toast-icon"><Glyph size={18} strokeWidth={1.8} aria-hidden="true" /></span>
      <div className="toast-copy">
        <div role={item.type === 'error' ? 'alert' : 'status'}>
          <strong>{item.title}</strong>
          {item.message && <p>{item.message}</p>}
        </div>
        {item.href && <a className="toast-action" href={item.href} onClick={() => { item.onAction?.(); onDismiss(item.id) }}>Open <ArrowRight size={14} aria-hidden="true" /></a>}
      </div>
      <button type="button" className="icon-button" onClick={() => onDismiss(item.id)} aria-label="Dismiss notification" title="Dismiss notification">
        <X size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const active = useRef(new Map())
  const sequence = useRef(0)

  const dismiss = useCallback((id) => {
    const entry = active.current.get(id)
    if (!entry) return
    window.clearTimeout(entry.timer)
    active.current.delete(id)
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])

  useEffect(() => {
    const entries = active.current
    return () => {
      entries.forEach(({ timer }) => window.clearTimeout(timer))
      entries.clear()
    }
  }, [])

  const notify = useCallback((notice) => {
    const type = Object.hasOwn(variants, notice?.type) ? notice.type : 'info'
    const customTitle = String(notice?.title || '').trim()
    const message = String(notice?.message || '').trim()
    if (!customTitle && !message) return
    const title = customTitle || variants[type].title
    const href = notice?.href || ''
    const actionId = notice?.actionId || ''
    const key = JSON.stringify([type, title, message, href, actionId])
    if ([...active.current.values()].some((entry) => entry.key === key)) return

    if (active.current.size >= 4) dismiss(active.current.keys().next().value)
    const id = ++sequence.current
    const duration = customTitle ? Math.max(6500, variants[type].duration) : variants[type].duration
    active.current.set(id, { key, timer: window.setTimeout(() => dismiss(id), duration) })
    setToasts((current) => [...current, { id, type, title, message, href, onAction: notice?.onAction }])
  }, [dismiss])

  const value = useMemo(() => ({
    success: (message) => notify({ type: 'success', message }),
    error: (message) => notify({ type: 'error', message }),
    warning: (message) => notify({ type: 'warning', message }),
    info: (message) => notify({ type: 'info', message }),
    notify,
  }), [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack">
        {toasts.map((item) => <Toast key={item.id} item={item} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used within ToastProvider')
  return value
}
