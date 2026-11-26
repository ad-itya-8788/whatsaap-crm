import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import api from '../../api/client.js'
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
  image: '📷 Photo',
  video: '🎬 Video',
  audio: '🎤 Voice message',
  document: '📄 Document',
  location: '📍 Location',
  template: '📋 Template',
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
  const location = useLocation()
  const { user } = useAuth()
  const [enabled, setEnabled] = useState(isEnabled)
  const [canNotify, setCanNotify] = useState(false)
  const locationRef = useRef(location)
  const userId = user?.id

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
    let cancelled = false
    let inFlight = false
    let latestId = 0
    let cursorReady = false

    const check = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const savedCursor = localStorage.getItem(storageKey)
        if (savedCursor !== null) {
          cursorReady = true
          latestId = Math.max(latestId, Number(savedCursor) || 0)
        }

        const { data } = await api.get('/api/app/notifications/browser-events', {
          params: cursorReady ? { after: latestId } : {},
        })

        if (cancelled) return

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

        const { pathname, search } = locationRef.current
        const params = new URLSearchParams(search)
        const visibleThread = pathname === '/inbox' && document.visibilityState === 'visible'
          ? params.get('c') || params.get('conversation')
          : null

        for (const event of data?.events || []) {
          if (Number(event.id) <= latestId) continue
          latestId = Number(event.id)
          localStorage.setItem(storageKey, String(latestId))
          if (String(event.conversation_id) === visibleThread) continue
          showNotification(event.contact_name || 'New message', eventBody(event), `/inbox?c=${event.conversation_id}`)
        }
      } catch {
        return undefined
      } finally {
        inFlight = false
      }
    }

    check()
    const timer = window.setInterval(check, 15000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [enabled, canNotify, userId])

  return null
}
