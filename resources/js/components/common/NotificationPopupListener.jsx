import { useEffect } from 'react'
import api from '../../api/client.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { hasModuleAccess } from '../../lib/moduleAccess.js'
import { notificationAppearance } from '../../lib/notificationAppearance.js'
import { useToast } from './ToastProvider.jsx'

function popupFromEvent(event, canOpenInbox) {
  const data = event.data || {}
  const conversationId = data.conversation_id
  return {
    title: event.title || 'New notification',
    message: event.body || '',
    type: notificationAppearance(event.type).tone,
    href: conversationId && canOpenInbox ? `/inbox?c=${encodeURIComponent(conversationId)}` : '/notifications',
  }
}

export default function NotificationPopupListener() {
  const { user } = useAuth()
  const toast = useToast()
  const userId = user?.id
  const canOpenInbox = hasModuleAccess(user, 'inbox')

  useEffect(() => {
    if (!userId) return undefined

    const storageKey = `wacrm:notification-popup:${userId}`
    const controller = new AbortController()
    let inFlight = false
    let latestId = 0
    let cursorReady = false

    const check = async () => {
      if (inFlight || controller.signal.aborted) return
      inFlight = true
      try {
        const savedCursor = localStorage.getItem(storageKey)
        if (savedCursor !== null) {
          cursorReady = true
          latestId = Math.max(latestId, Number(savedCursor) || 0)
        }

        const { data } = await api.get('/api/app/notifications/popup-events', {
          signal: controller.signal,
          timeout: 10000,
          params: cursorReady ? { after: latestId } : {},
        })

        if (controller.signal.aborted) return

        const storedAfterRequest = localStorage.getItem(storageKey)
        latestId = Math.max(latestId, Number(storedAfterRequest) || 0)
        if (!cursorReady) {
          latestId = Math.max(latestId, Number(data?.latest_id) || 0)
          localStorage.setItem(storageKey, String(latestId))
          cursorReady = true
          return
        }

        const previousId = latestId
        for (const event of data?.events || []) {
          const id = Number(event.id)
          if (id <= latestId) continue
          latestId = id
          localStorage.setItem(storageKey, String(latestId))
          toast.notify(popupFromEvent(event, canOpenInbox))
        }
        if (latestId > previousId) window.dispatchEvent(new Event('wacrm:notifications-changed'))
        if (data?.events?.length === 20) queueMicrotask(check)
      } catch {
        return undefined
      } finally {
        inFlight = false
      }
    }

    check()
    const timer = window.setInterval(check, 8000)
    window.addEventListener('focus', check)
    window.addEventListener('wacrm:notification-changed', check)

    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      window.removeEventListener('wacrm:notification-changed', check)
    }
  }, [userId, toast, canOpenInbox])

  return null
}
