import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { createIdempotencyKey, errorMessage, extractList, formatDate, formatTime, relativeTime } from '../lib/utils.js'

const incomingTypes = ['customer', 'contact']

function messageText(message) {
  return message?.content_text || message?.message_text || message?.content || ''
}

function messageMediaType(message) {
  if (message?.content_type !== 'template') return message?.content_type
  const mime = String(message?.media_type || '')
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

function messageMediaUrl(message) {
  const base = (api.defaults.baseURL || '').replace(/\/$/, '')
  return `${base}/api/app/messages/${message.id}/media`
}

function fileType(file) {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'document'
}

function fileSize(size) {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function statusLabel(status) {
  const value = String(status || '')
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : ''
}

function MessageStatus({ status }) {
  const value = String(status || '').toLowerCase()
  if (!value) return null

  if (value === 'failed') {
    return <span className="status-label status-failed" title="Failed"><Icon name="alert" size={13} /></span>
  }

  return (
    <span className={`status-label status-${value}`} title={statusLabel(value)} aria-label={`Message ${value}`}>
      <Icon name={['delivered', 'read'].includes(value) ? 'checks' : 'check'} size={15} />
    </span>
  )
}

function messageDate(message) {
  const value = message?.provider_timestamp || message?.created_at
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toDateString()
}

function chronological(messages) {
  return [...messages].sort((left, right) => Number(left.id) - Number(right.id))
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
  const [messageCursor, setMessageCursor] = useState({ next: null, hasMore: false })
  const [selectedId, setSelectedId] = useState(urlConversation || '')
  const [mobileView, setMobileView] = useState(urlConversation ? 'thread' : 'list')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [attachmentPreview, setAttachmentPreview] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const threadRef = useRef(null)
  const fileInputRef = useRef(null)
  const sendAttemptRef = useRef(null)
  const selectedIdRef = useRef(selectedId)
  const messagesConversationRef = useRef(selectedId)
  const scrollRestoreRef = useRef(null)
  const scrollToBottomRef = useRef(true)
  selectedIdRef.current = selectedId

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

  const loadMessages = useCallback(async (id, background = false, cursor = null) => {
    if (!id) {
      return false
    }

    if (!cursor && !background) {
      setLoadingMessages(true)
      setError('')
      scrollToBottomRef.current = true
    } else if (cursor) {
      setLoadingOlder(true)
    }

    if (background && !cursor) {
      const node = threadRef.current
      scrollToBottomRef.current = Boolean(
        node && node.scrollHeight - node.scrollTop - node.clientHeight < 120,
      )
    }

    try {
      const { data } = await api.get(`/api/app/conversations/${id}/messages`, {
        params: { cursor: cursor || undefined, per_page: 50 },
      })
      if (selectedIdRef.current !== id) return false

      const batch = chronological(extractList(data))
      if (cursor) {
        setMessages((current) => {
          const currentIds = new Set(current.map((message) => String(message.id)))
          return [...batch.filter((message) => !currentIds.has(String(message.id))), ...current]
        })
      } else if (background && messagesConversationRef.current === id && batch.length) {
        const firstId = Number(batch[0].id)
        setMessages((current) => [
          ...current.filter((message) => Number(message.id) < firstId),
          ...batch,
        ])
      } else {
        setMessages(batch)
      }

      messagesConversationRef.current = id
      if (!background) {
        setMessageCursor({ next: data.next_cursor || null, hasMore: Boolean(data.next_cursor) })
      }

      if (!cursor) {
        try {
          await api.post(`/api/app/conversations/${id}/read`)
          setConversations((items) => items.map((item) => String(item.id) === String(id) ? { ...item, unread_count: 0 } : item))
        } catch (requestError) {
          setError(errorMessage(requestError, 'Unable to mark the conversation as read.'))
        }
      }
      return true
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load messages.'))
      return false
    } finally {
      if (!cursor && !background) setLoadingMessages(false)
      if (cursor) setLoadingOlder(false)
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
    messagesConversationRef.current = selectedId
    scrollRestoreRef.current = null
    scrollToBottomRef.current = true
    setMessages([])
    setSelectedFile(null)
    setMessageCursor({ next: null, hasMore: false })
    if (selectedId) loadMessages(selectedId)
  }, [selectedId, loadMessages])

  useEffect(() => {
    if (!selectedFile || !selectedFile.type.startsWith('image/')) {
      setAttachmentPreview('')
      return undefined
    }

    const url = URL.createObjectURL(selectedFile)
    setAttachmentPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [selectedFile])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      loadConversations(true)
      if (selectedId) loadMessages(selectedId, true)
    }, 5000)

    return () => window.clearInterval(timer)
  }, [loadConversations, loadMessages, selectedId])

  useLayoutEffect(() => {
    const node = threadRef.current
    if (!node) return

    if (scrollRestoreRef.current) {
      const { height, top } = scrollRestoreRef.current
      node.scrollTop = top + node.scrollHeight - height
      scrollRestoreRef.current = null
    } else if (scrollToBottomRef.current) {
      node.scrollTop = node.scrollHeight
      scrollToBottomRef.current = false
    }
  }, [messages, loadingMessages])

  const loadOlderMessages = async () => {
    if (loadingOlder || !messageCursor.next) return

    const node = threadRef.current
    scrollRestoreRef.current = node
      ? { height: node.scrollHeight, top: node.scrollTop }
      : null
    const loaded = await loadMessages(selectedId, false, messageCursor.next)
    if (!loaded) scrollRestoreRef.current = null
  }

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
    if ((!text && !selectedFile) || !selectedId) return
    setSending(true)
    setError('')
    const fileSignature = selectedFile
      ? `${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}`
      : ''
    if (
      !sendAttemptRef.current
      || sendAttemptRef.current.conversationId !== selectedId
      || sendAttemptRef.current.text !== text
      || sendAttemptRef.current.fileSignature !== fileSignature
    ) {
      sendAttemptRef.current = {
        conversationId: selectedId,
        text,
        fileSignature,
        key: createIdempotencyKey(),
      }
    }

    const idempotencyKey = sendAttemptRef.current.key
    try {
      if (selectedFile) {
        const payload = new FormData()
        payload.append('content_type', fileType(selectedFile))
        payload.append('file', selectedFile)
        if (text) payload.append('content_text', text)
        payload.append('idempotency_key', idempotencyKey)
        await api.post(`/api/app/conversations/${selectedId}/messages`, payload)
      } else {
        await api.post(`/api/app/conversations/${selectedId}/messages`, {
          content_type: 'text',
          content_text: text,
          idempotency_key: idempotencyKey,
        })
      }
      sendAttemptRef.current = null
      setDraft('')
      setSelectedFile(null)
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
              <span className="thread-channel"><Icon name="whatsapp" size={15} /> WhatsApp</span>
            </header>
            <div className="thread-scroll" ref={threadRef}>
              {messageCursor.hasMore && (
                <button
                  type="button"
                  className="button button-sm button-secondary message-load-older"
                  onClick={loadOlderMessages}
                  disabled={loadingOlder}
                >
                  {loadingOlder ? 'Loading older messages...' : 'Load older messages'}
                </button>
              )}
              {loadingMessages && <div className="list-placeholder"><span className="spinner" /> Loading messages...</div>}
              {!loadingMessages && !messages.length && <div className="thread-empty">No messages yet. Send the first message below.</div>}
              {messages.map((message, index) => {
                const incoming = incomingTypes.includes(String(message.sender_type || '').toLowerCase())
                const status = !incoming && message.status ? statusLabel(message.status) : ''
                const currentDate = messageDate(message)
                const previousDate = messageDate(messages[index - 1])
                return (
                  <Fragment key={message.id || index}>
                    {currentDate && currentDate !== previousDate && (
                      <div className="message-date">{formatDate(message.provider_timestamp || message.created_at)}</div>
                    )}
                    <div className={`message ${incoming ? 'in' : 'out'}`}>
                      {message.media_url && (() => {
                        const mediaType = messageMediaType(message)
                        const src = messageMediaUrl(message)
                        if (mediaType === 'image') {
                          return <img className="message-media message-image" src={src} crossOrigin="use-credentials" alt={message.filename || 'WhatsApp image'} loading="lazy" />
                        }
                        if (mediaType === 'video') {
                          return <video className="message-media" src={src} controls preload="metadata" />
                        }
                        if (mediaType === 'audio') {
                          return <audio className="message-audio" src={src} controls preload="metadata" />
                        }
                        return (
                          <a className="message-file" href={src} download={message.filename || 'whatsapp-attachment'}>
                            <Icon name="file" size={20} />
                            <span>{message.filename || 'Download attachment'}</span>
                            <Icon name="download" size={16} />
                          </a>
                        )
                      })()}
                      {messageText(message) && <div className="message-text">{messageText(message)}</div>}
                      <div className="message-meta">
                        <span>{formatTime(message.provider_timestamp || message.created_at)}</span>
                        {status && <MessageStatus status={message.status} />}
                      </div>
                    </div>
                  </Fragment>
                )
              })}
            </div>
            {error && <div className="alert alert-error alert-inline composer-error">{error}</div>}
            <form className="composer" onSubmit={send}>
              {selectedFile && (
                <div className="composer-attachment">
                  {attachmentPreview
                    ? <img src={attachmentPreview} alt="" className="composer-attachment-thumb" />
                    : <Icon name={fileType(selectedFile) === 'document' ? 'file' : fileType(selectedFile)} size={20} />}
                  <span className="composer-attachment-name">{selectedFile.name}</span>
                  <span className="composer-attachment-size">{fileSize(selectedFile.size)}</span>
                  <button type="button" className="icon-button" onClick={() => setSelectedFile(null)} aria-label="Remove attachment">
                    <Icon name="close" size={16} />
                  </button>
                </div>
              )}
              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                accept="image/jpeg,image/png,video/mp4,video/3gpp,audio/aac,audio/amr,audio/mpeg,audio/mp4,audio/ogg,audio/opus,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) setSelectedFile(file)
                }}
              />
              <div className="composer-row">
                <button
                  type="button"
                  className="icon-button composer-attach"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach a file"
                  title="Attach image, video, audio, or document"
                >
                  <Icon name="paperclip" size={20} />
                </button>
                <textarea
                  className="composer-input"
                  rows="1"
                  aria-label="Message"
                  placeholder="Type a message..."
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onComposerKeyDown}
                />
                <button className="button button-primary composer-send" type="submit" disabled={sending || (!draft.trim() && !selectedFile)}>
                  <Icon name="send" size={16} /> {sending ? 'Sending...' : 'Send'}
                </button>
              </div>
              <div className="composer-actions">
                <span className="composer-hint">Enter to send · Shift + Enter for a new line</span>
                <span className="composer-hint">Photos 5 MB · video/audio 16 MB · documents 100 MB</span>
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
