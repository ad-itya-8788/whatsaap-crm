import { useEffect, useState } from 'react'
import api from '../../api/client.js'
import { relativeTime } from '../../lib/utils.js'

const refreshInterval = 30_000
const idleAfter = 5 * 60_000
const offlineAfter = 75_000

export function PresenceHeartbeat({ userId }) {
  useEffect(() => {
    if (!userId) return

    let lastActivity = Date.now()
    let lastBeat = 0
    const markActive = () => { lastActivity = Date.now() }
    const beat = () => {
      const now = Date.now()
      if (now - lastBeat < 1_000) return
      lastBeat = now
      const status = document.hidden || now - lastActivity > idleAfter ? 'away' : 'online'
      api.put('/api/app/presence', { status }).catch(() => {})
    }
    const refresh = () => {
      if (!document.hidden) markActive()
      beat()
    }
    const events = ['pointermove', 'pointerdown', 'keydown', 'scroll']
    events.forEach((event) => document.addEventListener(event, markActive, { passive: true }))
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(beat, refreshInterval)
    beat()

    return () => {
      events.forEach((event) => document.removeEventListener(event, markActive))
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
      window.clearInterval(timer)
    }
  }, [userId])

  return null
}

export function useMemberPresence() {
  const [members, setMembers] = useState({})
  useEffect(() => {
    const controller = new AbortController()
    const load = () => {
      if (document.hidden) return
      api.get('/api/app/presence', { signal: controller.signal })
        .then(({ data }) => setMembers(data))
        .catch(() => {})
    }
    document.addEventListener('visibilitychange', load)
    const timer = window.setInterval(load, refreshInterval)
    load()
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', load)
    }
  }, [])
  return members
}

export function presenceStatus(member) {
  const lastSeen = Date.parse(member?.last_seen_at)
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > offlineAfter) return 'offline'
  return member.presence_status === 'away' ? 'away' : 'online'
}

export function PresenceDot({ member }) {
  const status = presenceStatus(member)
  const label = {
    online: 'Online',
    away: 'Away',
    offline: member?.last_seen_at ? 'Offline · last seen ' + relativeTime(member.last_seen_at) : 'Offline',
  }[status]
  return <span className={'member-presence is-' + status} role="img" aria-label={label} title={label} />
}
