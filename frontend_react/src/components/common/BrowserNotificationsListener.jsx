import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import api from '../../api/client.js'
import {
  BROWSER_NOTIFY_EVENT,
  isEnabled,
  LAST_MESSAGE_STORAGE_KEY,
  notificationsSupported,
  permission,
  showNotification,
} from '../../lib/browserNotifications.js'

export default function BrowserNotificationsListener() {
  const location = useLocation()
  const [enabled, setEnabled] = useState(isEnabled)
  const locationRef = useRef(location)
  const lastIdRef = useRef(Number(localStorage.getItem(LAST_MESSAGE_STORAGE_KEY) || 0))
  const notifiedRef = useRef(new Set())

  useEffect(() => { locationRef.current = location }, [location])

  useEffect(() => {
    const sync = () => setEnabled(isEnabled())
    window.addEventListener(BROWSER_NOTIFY_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(BROWSER_NOTIFY_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    if (!enabled || !notificationsSupported() || permission() !== 'granted') return undefined

    let cancelled = false

    const check = async () => {
      try {
        const { data } = await api.get('/api/app/notifications/browser-events', {
          params: { after: lastIdRef.current },
        })

        if (cancelled) return

        const events = data?.events || []
        if (!lastIdRef.current) {
          lastIdRef.current = Number(data?.latest_id || 0)
          if (lastIdRef.current) localStorage.setItem(LAST_MESSAGE_STORAGE_KEY, String(lastIdRef.current))
          return
        }

        const params = new URLSearchParams(locationRef.current.search)
        const activeId = Number(params.get('conversation') || params.get('c') || 0)

        events.forEach((event) => {
          if (Number(event.id) <= lastIdRef.current) return

          lastIdRef.current = Number(event.id)
          localStorage.setItem(LAST_MESSAGE_STORAGE_KEY, String(lastIdRef.current))

          if (Number(event.conversation_id) === activeId) return
          if (notifiedRef.current.has(event.id)) return

          notifiedRef.current.add(event.id)
          showNotification(
            `New message from ${event.contact_name}`,
            event.body || 'New customer message',
            `/inbox?conversation=${event.conversation_id}`,
          )
        })

        if (Number(data?.latest_id || 0) > lastIdRef.current) {
          lastIdRef.current = Number(data.latest_id)
          localStorage.setItem(LAST_MESSAGE_STORAGE_KEY, String(lastIdRef.current))
        }
      } catch {
        return undefined
      }
    }

    check()
    const timer = window.setInterval(check, 15000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [enabled])

  return null
}
