import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { errorMessage, extractList, formatTime, relativeTime } from '../lib/utils.js'

const incomingTypes = ['customer', 'contact']

function messageText(message) {
  return message?.content_text || message?.message_text || message?.content || ''
}

function statusLabel(status) {
  const value = String(status || '')
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : ''
}

function hasWhatsApp(conversation) {
  const contact = conversation?.contact || {}
  const channel = String(conversation?.channel || '').toLowerCase()
  return Boolean(contact.whatsapp_user_id || conversation?.whatsapp_user_id || conversation?.connection_status || channel === 'whatsapp' || channel === 'cloud')
}

export default function ChatsPage() {
  const [params, setParams] = useSearchParams()
  const urlConversation = params.get('conversation')
  const [conversations, setConversations] = useState([])
  const [messages, setMessages] = useState([])
  const [selectedId, setSelectedId] = useState(urlConversation || '')
  const [mobileView, setMobileView] = useState(urlConversation ? 'thread' : 'list')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const threadRef = useRef(null)

  const loadConversations = useCallback(async (background = false) => {
    if (!background) setLoadingList(true)
    try {
      const { data } = await api.get('/api/app/conversations', { params: { search: debouncedQuery || undefined } })
      setConversations(extractList(data))
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load conversations.'))
    } finally {
      if (!background) setLoadingList(false)
    }
  }, [debouncedQuery])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  const loadMessages = useCallback(async (id, background = false) => {
    if (!id) {
      setMessages([])
      return
    }
    if (!background) {
      setLoadingMessages(true)
      setError('')
    }
    try {
      const [response] = await Promise.all([
        api.get(`/api/app/conversations/${id}/messages`),
        api.post(`/api/app/conversations/${id}/read`).catch(() => null),
      ])
      setMessages(extractList(response.data))
      setConversations((items) => items.map((item) => String(item.id) === String(id) ? { ...item, unread_count: 0 } : item))
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load messages.'))
    } finally {
      if (!background) setLoadingMessages(false)
    }
  }, [])

  useEffect(() => { loadConversations() }, [loadConversations])

  useEffect(() => {
    if (!conversations.length) {
      setSelectedId('')
      return
    }
    setSelectedId((current) => {
      if (current && conversations.some((item) => String(item.id) === String(current))) return current
      if (urlConversation && conversations.some((item) => String(item.id) === String(urlConversation))) return urlConversation
      return String(conversations[0].id)
    })
  }, [conversations, urlConversation])

  useEffect(() => {
    if (urlConversation) {
      setSelectedId(urlConversation)
      setMobileView('thread')
    }
  }, [urlConversation])

  useEffect(() => {
    if (selectedId) loadMessages(selectedId)
    else setMessages([])
  }, [selectedId, loadMessages])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      loadConversations(true)
      if (selectedId) loadMessages(selectedId, true)
    }, 5000)

    return () => window.clearInterval(timer)
  }, [loadConversations, loadMessages, selectedId])

  useEffect(() => {
    const node = threadRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, loadingMessages])

  const openConversation = (id) => {
    const value = String(id)
    setSelectedId(value)
    setMobileView('thread')
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.set('conversation', value)
      return next
    }, { replace: true })
  }

  const backToList = () => {
    setMobileView('list')
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('conversation')
      return next
    }, { replace: true })
  }

  const send = async (event) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || !selectedId) return
    setSending(true)
    setError('')
    try {
      await api.post(`/api/app/conversations/${selectedId}/messages`, { content_type: 'text', content_text: text })
      setDraft('')
      await Promise.all([loadMessages(selectedId), loadConversations()])
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to send message.'))
    } finally {
      setSending(false)
    }
  }

  const onComposerKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send(event)
    }
  }

  const filtered = conversations.filter((conversation) => {
    const needle = debouncedQuery.trim().toLowerCase()
    if (!needle) return true
    return [conversation.contact?.name, conversation.contact?.phone, conversation.last_message_text]
      .some((value) => String(value || '').toLowerCase().includes(needle))
  })

  const selected = conversations.find((item) => String(item.id) === String(selectedId))
  const selectedName = selected?.contact?.name || selected?.contact?.phone || 'Conversation'

  return (
    <div className={`chats-shell${mobileView === 'thread' ? ' is-thread' : ''}`}>
      <section className="chat-list-panel" aria-label="Conversations">
        <div className="chat-list-head">
          <h1 className="panel-title">Chats</h1>
          <div className="search-wrap">
            <Icon name="search" size={16} />
            <input
              className="input search-input"
              type="search"
              aria-label="Search conversations"
              placeholder="Search name, phone or message..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        {error && !selected && <div className="alert alert-error alert-inline">{error}</div>}
        <div className="chat-list">
          {loadingList && <div className="list-placeholder"><span className="spinner" /> Loading conversations...</div>}
          {!loadingList && filtered.map((conversation) => {
            const unread = Number(conversation.unread_count || 0)
            return (
              <button
                type="button"
                key={conversation.id}
                className={`chat-item${String(conversation.id) === String(selectedId) ? ' is-active' : ''}`}
                onClick={() => openConversation(conversation.id)}
              >
                <span className="chat-avatar">{(conversation.contact?.name || conversation.contact?.phone || '?').slice(0, 1).toUpperCase()}</span>
                <span className="chat-item-main">
                  <span className="chat-item-top">
                    <span className="chat-name">{conversation.contact?.name || conversation.contact?.phone || 'Unknown contact'}</span>
                    <span className="chat-time">{relativeTime(conversation.last_message_at)}</span>
                  </span>
                  <span className="chat-phone">{conversation.contact?.phone || ''}</span>
                  <span className="chat-item-bottom">
                    <span className="chat-preview">{conversation.last_message_text || 'No messages yet'}</span>
                    {unread > 0 && <span className="unread-badge">{unread > 99 ? '99+' : unread}</span>}
                  </span>
                  {hasWhatsApp(conversation) && <span className="conn-badge"><span className="status-dot is-online" /> WhatsApp</span>}
                </span>
              </button>
            )
          })}
          {!loadingList && !filtered.length && (
            <div className="list-placeholder">{query ? 'No conversations match your search.' : 'No conversations yet.'}</div>
          )}
        </div>
      </section>

      <section className="chat-thread" aria-label="Conversation">
        {selected ? (
          <>
            <header className="thread-head">
              <button type="button" className="icon-button thread-back" onClick={backToList} aria-label="Back to conversations"><Icon name="back" size={20} /></button>
              <span className="chat-avatar">{selectedName.slice(0, 1).toUpperCase()}</span>
              <div className="thread-head-info">
                <div className="thread-title">{selectedName}</div>
                <div className="thread-subtitle">{selected.contact?.phone || 'No phone number'}</div>
              </div>
            </header>
            <div className="thread-scroll" ref={threadRef}>
              {loadingMessages && <div className="list-placeholder"><span className="spinner" /> Loading messages...</div>}
              {!loadingMessages && !messages.length && <div className="thread-empty">No messages yet. Send the first message below.</div>}
              {messages.map((message, index) => {
                const incoming = incomingTypes.includes(String(message.sender_type || '').toLowerCase())
                const status = !incoming && message.status ? statusLabel(message.status) : ''
                return (
                  <div key={message.id || index} className={`message ${incoming ? 'in' : 'out'}`}>
                    <div className="message-text">{messageText(message)}</div>
                    <div className="message-meta">
                      <span>{formatTime(message.created_at)}</span>
                      {status && <span className={`status-label status-${String(message.status).toLowerCase()}`}>{status}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
            {error && <div className="alert alert-error alert-inline composer-error">{error}</div>}
            <form className="composer" onSubmit={send}>
              <textarea
                className="composer-input"
                rows="2"
                aria-label="Message"
                placeholder="Type a message..."
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onComposerKeyDown}
              />
              <div className="composer-actions">
                <span className="composer-hint">Enter to send · Shift + Enter for a new line</span>
                <button className="button button-primary" type="submit" disabled={sending || !draft.trim()}>
                  <Icon name="send" size={15} /> {sending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="thread-placeholder"><Icon name="chat" size={36} /><p>Select a conversation to start chatting.</p></div>
        )}
      </section>
    </div>
  )
}
