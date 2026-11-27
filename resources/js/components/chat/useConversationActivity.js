import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../api/client.js'

const durations = { typing: 5500, thinking: 45000 }

export default function useConversationActivity(conversationId, connected) {
  const [entries, setEntries] = useState([])
  const lastSent = useRef(null)
  const currentConversation = useRef(conversationId)
  currentConversation.current = conversationId

  const receive = useCallback((event) => {
    if (String(event?.conversation_id) !== String(currentConversation.current)
      || !Object.hasOwn(durations, event.kind) || !event.key) return

    const expires = Date.now() + durations[event.kind]
    setEntries((current) => {
      const remaining = current.filter((entry) => entry.key !== event.key)
      return event.active ? [...remaining, { ...event, expires }] : remaining
    })
  }, [])

  useEffect(() => {
    setEntries([])
  }, [conversationId])

  useEffect(() => {
    if (!entries.length) return undefined
    const expires = Math.min(...entries.map((entry) => entry.expires))
    const timer = window.setTimeout(() => {
      setEntries((current) => current.filter((entry) => entry.expires > Date.now()))
    }, Math.max(0, expires - Date.now()))
    return () => window.clearTimeout(timer)
  }, [entries])

  const notifyTyping = (text) => {
    if (!connected || !conversationId || !text.trim()) return
    const now = Date.now()
    if (lastSent.current?.id === conversationId && now - lastSent.current.at < 3000) return
    lastSent.current = { id: conversationId, at: now }
    void api.post(`/api/app/conversations/${conversationId}/typing`, {}, { timeout: 4500 }).catch(() => {})
  }

  const active = entries.filter((entry) => String(entry.conversation_id) === String(conversationId))
  return {
    receive,
    notifyTyping,
    thinking: active.some((entry) => entry.kind === 'thinking'),
    typists: active.filter((entry) => entry.kind === 'typing').map((entry) => entry.name || 'A teammate'),
  }
}
