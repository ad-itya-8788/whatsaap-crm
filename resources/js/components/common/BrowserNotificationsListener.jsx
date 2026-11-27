import { useEffect, useRef, useState } from 'react'
import { usePageLocation } from '../../lib/navigation.js'
import api from '../../api/client.js'
import { subscribeToRealtime } from '../../lib/realtime.js'
import { useAuth } from '../../context/AuthContext.jsx'
import {
  BROWSER_NOTIFY_EVENT,
  isEnabled,
  LAST_MESSAGE_STORAGE_KEY,
  notificationsSupported,
  permission,
  showNotification,
} from '../../lib/browserNotifications.js'

const BODY_MAX_CHARS = 120

const CONTENT_LABELS = {
  image: 'Photo',
  video: 'Video',
  audio: 'Voice message',
  document: 'Document',
  location: 'Location',
  template: 'Template',
  reaction: 'Reaction',
}

function eventBody(event) {
  const label = CONTENT_LABELS[event.content_type]
  const text = String(event.body || '').replace(/\s+/g, ' ').trim()
  const body = label && text ? `${label} · ${text}` : label || text
  if (body.length <= BODY_MAX_CHARS) return body
  const clipped = body.slice(0, BODY_MAX_CHARS)
  const breakAt = clipped.lastIndexOf(' ')
  return `${(breakAt > BODY_MAX_CHARS * 0.6 ? clipped.slice(0, breakAt) : clipped).trimEnd()}…`
}

export default function BrowserNotificationsListener() {
  const location = usePageLocation()
  const { user } = useAuth()
  const [enabled, setEnabled] = useState(isEnabled)
  const [canNotify, setCanNotify] = useState(false)
  const locationRef = useRef(location)
  const userId = user?.id
  const role = user?.role

  useEffect(() => { locationRef.current = location }, [location])

  useEffect(() => {
    const sync = () => {
      setEnabled(isEnabled())
      setCanNotify(notificationsSupported() && permission() === 'granted')
    }
    sync()
    window.addEventListener(BROWSER_NOTIFY_EVENT, sync)
    window.addEventListener('storage', sync)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener(BROWSER_NOTIFY_EVENT, sync)
      window.removeEventListener('storage', sync)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  useEffect(() => {
    if (!enabled || !canNotify || !userId) return undefined

    const storageKey = `${LAST_MESSAGE_STORAGE_KEY}:${userId}`
    const controller = new AbortController()
    let inFlight = false
    let latestId = 0
    let cursorReady = false
    let connected = false
    const shown = new Set()

    const notify = (event) => {
      const { pathname, search } = locationRef.current
      const params = new URLSearchParams(search)
      const visibleThread = pathname === '/inbox' && document.visibilityState === 'visible'
        ? params.get('c') || params.get('conversation')
        : null
      if (String(event.conversation_id) === visibleThread) return
      void showNotification(event.contact_name || 'New message', eventBody(event), `/inbox?c=${event.conversation_id}`)
    }

    const check = async () => {
      if (inFlight || controller.signal.aborted) return
      inFlight = true
      try {
        const savedCursor = localStorage.getItem(storageKey)
        if (savedCursor !== null) {
          cursorReady = true
          latestId = Math.max(latestId, Number(savedCursor) || 0)
        }

        const { data } = await api.get('/api/app/notifications/browser-events', {
          signal: controller.signal,
          timeout: 10000,
          params: cursorReady ? { after: latestId } : {},
        })

        if (controller.signal.aborted) return

        const storedAfterRequest = localStorage.getItem(storageKey)
        latestId = Math.max(latestId, Number(storedAfterRequest) || 0)
        if (!cursorReady) {
          if (storedAfterRequest === null) {
            latestId = Math.max(latestId, Number(data?.latest_id) || 0)
            localStorage.setItem(storageKey, String(latestId))
          }
          cursorReady = true
          return
        }

        for (const event of data?.events || []) {
          const id = Number(event.id)
          if (id <= latestId) continue
          latestId = id
          localStorage.setItem(storageKey, String(latestId))
          if (!shown.delete(id)) notify(event)
        }
        for (const id of shown) {
          if (id <= latestId) shown.delete(id)
        }
        if (data?.events?.length === 20) queueMicrotask(check)
      } catch {
        return undefined
      } finally {
        inFlight = false
      }
    }

    check()
    const unsubscribe = subscribeToRealtime({
      onConnectionChange: (ready) => { connected = ready },
      onReconnected: check,
      onMessageCreated: ({ message, conversation }) => {
        if (!message) return void check()
        if (message?.sender_type !== 'customer' || !conversation) return
        if (role !== 'owner'
          && ![conversation.user_id, conversation.assigned_agent_id].some((id) => String(id) === String(userId))) return
        const id = Number(message.id)
        if (id <= latestId || shown.has(id) || id <= (Number(localStorage.getItem(storageKey)) || 0)) return
        shown.add(id)
        if (shown.size >= 100) void check()
        const contact = conversation.contact
        notify({
          conversation_id: conversation.id,
          contact_name: contact?.name || (contact?.wa_username && `@${contact.wa_username}`) || contact?.phone,
          content_type: message.content_type,
          body: message.content_text,
        })
      },
    })
    const timer = window.setInterval(() => { if (!connected) void check() }, 15000)
    window.addEventListener('focus', check)

    return () => {
      controller.abort()
      unsubscribe()
      window.removeEventListener('focus', check)
      window.clearInterval(timer)
    }
  }, [enabled, canNotify, userId, role])

  return null
}
