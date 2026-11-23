import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { createIdempotencyKey, errorMessage, extractList, extractPaginator, formatDate } from '../lib/utils.js'
import ConversationList from '../components/chat/ConversationList.jsx'
import MessageBubble from '../components/chat/MessageBubble.jsx'
import MediaViewer from '../components/chat/MediaViewer.jsx'
import ChatComposer from '../components/chat/ChatComposer.jsx'
import { fileType, hasWhatsApp, isIncoming, mediaItem, messageText } from '../components/chat/chatUtils.js'

function messageDate(message) {
  const value = message?.provider_timestamp || message?.created_at
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toDateString() : ''
}

function chronological(messages) {
  return [...messages].sort((left, right) => Number(left.id) - Number(right.id))
}

function initials(value) {
  return String(value || '?').trim().slice(0, 1).toUpperCase()
}

export default function ChatsPage() {
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  const toast = useToast()
  const urlConversation = params.get('conversation')

  const [conversations, setConversations] = useState([])
  const [pagination, setPagination] = useState({ currentPage: 1, lastPage: 1, total: 0 })
  const [messages, setMessages] = useState([])
  const [messageCursor, setMessageCursor] = useState({ next: null, hasMore: false })
  const [selectedId, setSelectedId] = useState(urlConversation || '')
  const [mobileView, setMobileView] = useState(urlConversation ? 'thread' : 'list')

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [messageSearch, setMessageSearch] = useState('')
  const [debouncedMessageSearch, setDebouncedMessageSearch] = useState('')

  const [agents, setAgents] = useState([])
  const [quickReplies, setQuickReplies] = useState([])
  const [tags, setTags] = useState([])
  const [notes, setNotes] = useState([])

  const [sidePanel, setSidePanel] = useState('')
  const [notesLoading, setNotesLoading] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [deleteNoteId, setDeleteNoteId] = useState(null)
  const [deletingNote, setDeletingNote] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  const [draft, setDraft] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [replyTo, setReplyTo] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(0)

  const [loadingList, setLoadingList] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [retryingId, setRetryingId] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [listError, setListError] = useState('')
  const [threadError, setThreadError] = useState('')
  const [mediaViewer, setMediaViewer] = useState(null)

  const threadRef = useRef(null)
  const threadAbortRef = useRef(null)
  const sendAttemptRef = useRef(null)
  const selectedIdRef = useRef(selectedId)
  const messagesConversationRef = useRef(selectedId)
  const scrollRestoreRef = useRef(null)
  const scrollToBottomRef = useRef(true)
  selectedIdRef.current = selectedId

  const selected = conversations.find((item) => String(item.id) === String(selectedId)) || null
  const optedOut = selected?.contact?.consent_status === 'opted_out'
  const contactTags = selected?.contact?.tags || []

  const mediaItems = useMemo(() => messages.map(mediaItem).filter(Boolean), [messages])

  const loadConversations = useCallback(async (page = 1, append = false, background = false) => {
    if (!background && page === 1) setLoadingList(true)
    if (append) setLoadingMore(true)
    try {
      const { data } = await api.get('/api/app/conversations', {
        params: {
          search: debouncedQuery || undefined,
          status: statusFilter,
          assigned: assigneeFilter,
          per_page: 30,
          page,
        },
      })
      const rows = extractList(data)
      setConversations((current) => {
        if (!append) return rows
        const seen = new Set(current.map((item) => String(item.id)))
        return [...current, ...rows.filter((item) => !seen.has(String(item.id)))]
      })
      setPagination(extractPaginator(data))
      setListError('')
    } catch (requestError) {
      if (!background) setListError(errorMessage(requestError, 'Unable to load conversations.'))
    } finally {
      if (!background && page === 1) setLoadingList(false)
      if (append) setLoadingMore(false)
    }
  }, [debouncedQuery, statusFilter, assigneeFilter])

  const loadOptions = useCallback(async () => {
    try {
      const [agentResult, replyResult, tagResult] = await Promise.all([
        api.get('/api/app/agents'),
        api.get('/api/app/quick-replies'),
        api.get('/api/app/tags'),
      ])
      setAgents(extractList(agentResult.data))
      setQuickReplies(extractList(replyResult.data))
      setTags(extractList(tagResult.data))
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to load chat options.'))
    }
  }, [toast])

  const loadNotes = useCallback(async (id) => {
    if (!id) return
    setNotesLoading(true)
    try {
      const { data } = await api.get(`/api/app/conversations/${id}/notes`)
      setNotes(extractList(data))
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to load notes.'))
    } finally {
      setNotesLoading(false)
    }
  }, [toast])

  const loadMessages = useCallback(async (id, options = {}) => {
    const { background = false, cursor = null, search = debouncedMessageSearch, markRead = false } = options
    if (!id) return false

    let controller = null
    if (!background) {
      threadAbortRef.current?.abort()
      controller = new AbortController()
      threadAbortRef.current = controller
    }

    if (!cursor && !background) {
      setLoadingMessages(true)
      setThreadError('')
      scrollToBottomRef.current = true
    } else if (cursor) {
      setLoadingOlder(true)
    } else if (background) {
      const node = threadRef.current
      scrollToBottomRef.current = Boolean(node && node.scrollHeight - node.scrollTop - node.clientHeight < 120)
    }

    try {
      const { data } = await api.get(`/api/app/conversations/${id}/messages`, {
        params: { cursor: cursor || undefined, per_page: 50, search: search || undefined },
        signal: controller?.signal,
      })
      if (selectedIdRef.current !== id) return false

      const batch = chronological(extractList(data))
      if (cursor) {
        setMessages((current) => {
          const seen = new Set(current.map((message) => String(message.id)))
          return [...batch.filter((message) => !seen.has(String(message.id))), ...current]
        })
      } else if (background && messagesConversationRef.current === id) {
        setMessages((current) => {
          const map = new Map(current.map((message) => [String(message.id), message]))
          batch.forEach((message) => map.set(String(message.id), message))
          return [...map.values()].sort((left, right) => Number(left.id) - Number(right.id))
        })
      } else {
        setMessages(batch)
      }

      messagesConversationRef.current = id
      if (!background && !cursor) {
        setMessageCursor({ next: data.next_cursor || null, hasMore: Boolean(data.next_cursor) })
      }

      if (markRead) {
        try {
          await api.post(`/api/app/conversations/${id}/read`)
          setConversations((items) => items.map((item) => String(item.id) === String(id) ? { ...item, unread_count: 0 } : item))
        } catch (requestError) {
          toast.error(errorMessage(requestError, 'Unable to mark the conversation as read.'))
        }
      }
      return true
    } catch (requestError) {
      if (requestError?.name === 'CanceledError' || requestError?.code === 'ERR_CANCELED') return false
      if (!background) setThreadError(errorMessage(requestError, 'Unable to load messages.'))
      return false
    } finally {
      if (!cursor && !background) setLoadingMessages(false)
      if (cursor) setLoadingOlder(false)
    }
  }, [debouncedMessageSearch, toast])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedMessageSearch(messageSearch), 350)
    return () => clearTimeout(timer)
  }, [messageSearch])

  useEffect(() => { loadOptions() }, [loadOptions])
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
    setReplyTo(null)
    setMessageCursor({ next: null, hasMore: false })
    setSidePanel('')
    setMediaViewer(null)
    if (selectedId) loadMessages(selectedId, { markRead: true })
  }, [selectedId, loadMessages])

  useEffect(() => {
    if (debouncedMessageSearch && selectedId) loadMessages(selectedId, { search: debouncedMessageSearch })
  }, [debouncedMessageSearch, selectedId, loadMessages])

  useEffect(() => {
    if (sidePanel === 'notes' && selectedId) loadNotes(selectedId)
  }, [sidePanel, selectedId, loadNotes])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      loadConversations(1, false, true)
      if (selectedId) loadMessages(selectedId, { background: true })
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

  useEffect(() => () => threadAbortRef.current?.abort(), [])

  const changeFilter = (key, value) => {
    if (key === 'query') setQuery(value)
    if (key === 'status') { setStatusFilter(value); setMobileView('list') }
    if (key === 'assignee') setAssigneeFilter(value)
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

  const loadOlderMessages = async () => {
    if (loadingOlder || !messageCursor.next) return
    const node = threadRef.current
    scrollRestoreRef.current = node ? { height: node.scrollHeight, top: node.scrollTop } : null
    const loaded = await loadMessages(selectedId, { cursor: messageCursor.next })
    if (!loaded) scrollRestoreRef.current = null
  }

  const patchConversation = async (path, payload, optimistic, key, successMessage) => {
    if (!selectedId) return
    setBusyAction(key)
    setConversations((items) => items.map((item) => String(item.id) === String(selectedId) ? { ...item, ...optimistic } : item))
    try {
      const { data } = await api.patch(`/api/app/conversations/${selectedId}/${path}`, payload)
      setConversations((items) => items.map((item) => String(item.id) === String(selectedId) ? { ...item, ...data, contact: item.contact, assignedAgent: item.assignedAgent } : item))
      toast.success(successMessage)
    } catch (requestError) {
      setConversations((items) => items.map((item) => String(item.id) === String(selectedId) ? { ...item, ...optimistic, ...(key === 'status' ? { status: selected?.status } : { assignedAgent: selected?.assignedAgent }) } : item))
      toast.error(errorMessage(requestError, 'Unable to update the conversation.'))
      loadConversations(1, false, true)
    } finally {
      setBusyAction('')
    }
  }

  const changeStatus = (status) => patchConversation('status', { status }, { status }, 'status', `Conversation marked ${status}.`)

  const changeAssignee = (value) => {
    const assigneeId = value === 'unassigned' ? null : value === 'me' ? user?.id ?? null : value
    const agent = agents.find((item) => String(item.id) === String(assigneeId))
    patchConversation('assign', { assignee_id: assigneeId }, { assignedAgent: agent || null }, 'assignee', 'Assignee updated.')
  }

  const addNote = async (event) => {
    event.preventDefault()
    const body = noteDraft.trim()
    if (!body || !selectedId) return
    setSavingNote(true)
    try {
      await api.post(`/api/app/conversations/${selectedId}/notes`, { body })
      setNoteDraft('')
      await loadNotes(selectedId)
      toast.success('Note added.')
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to add the note.'))
    } finally {
      setSavingNote(false)
    }
  }

  const confirmDeleteNote = async () => {
    if (!deleteNoteId) return
    setDeletingNote(true)
    try {
      await api.delete(`/api/app/conversations/${selectedId}/notes/${deleteNoteId}`)
      await loadNotes(selectedId)
      toast.success('Note deleted.')
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to delete the note.'))
    } finally {
      setDeletingNote(false)
      setDeleteNoteId(null)
    }
  }

  const toggleTag = async (tagId) => {
    if (!selected?.contact?.id) return
    const currentIds = contactTags.map((tag) => Number(tag.id))
    const nextIds = currentIds.includes(Number(tagId))
      ? currentIds.filter((id) => id !== Number(tagId))
      : [...currentIds, Number(tagId)]
    try {
      const { data } = await api.put(`/api/app/contacts/${selected.contact.id}/tags`, { tags: nextIds })
      setConversations((items) => items.map((item) => String(item.id) === String(selectedId)
        ? { ...item, contact: { ...item.contact, tags: data.tags || [] } }
        : item))
      toast.success('Contact labels updated.')
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to update contact labels.'))
    }
  }

  const copyPhone = async () => {
    if (!selected?.contact?.phone) return
    try {
      await navigator.clipboard.writeText(selected.contact.phone)
      toast.success('Phone number copied.')
    } catch {
      toast.error('Copy failed. Your browser blocked clipboard access.')
    }
    setMoreOpen(false)
  }

  const refreshConversation = () => {
    setMoreOpen(false)
    loadMessages(selectedId)
    loadConversations(1, false, true)
    toast.info('Conversation refreshed.')
  }

  const send = async (event) => {
    if (event?.preventDefault) event.preventDefault()
    const text = draft.trim()
    if ((!text && !selectedFile) || !selectedId || sending) return
    if (optedOut) {
      toast.error('This contact opted out of WhatsApp messages. You cannot send to them.')
      return
    }

    setSending(true)
    setThreadError('')
    setUploadProgress(0)
    const signature = `${selectedId}|${text}|${selectedFile?.name || ''}|${selectedFile?.size || ''}|${replyTo?.id || ''}`
    if (sendAttemptRef.current?.signature !== signature) {
      sendAttemptRef.current = { signature, key: createIdempotencyKey() }
    }
    const idempotencyKey = sendAttemptRef.current.key

    try {
      if (selectedFile) {
        const payload = new FormData()
        payload.append('content_type', fileType(selectedFile))
        payload.append('file', selectedFile)
        if (text) payload.append('content_text', text)
        if (replyTo?.id) payload.append('reply_to_message_id', replyTo.id)
        payload.append('idempotency_key', idempotencyKey)
        await api.post(`/api/app/conversations/${selectedId}/messages`, payload, {
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) setUploadProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total))
          },
        })
      } else {
        await api.post(`/api/app/conversations/${selectedId}/messages`, {
          content_type: 'text',
          content_text: text,
          ...(replyTo?.id ? { reply_to_message_id: replyTo.id } : {}),
          idempotency_key: idempotencyKey,
        })
      }
      sendAttemptRef.current = null
      setDraft('')
      setSelectedFile(null)
      setReplyTo(null)
      setUploadProgress(100)
      await Promise.all([loadMessages(selectedId), loadConversations(1, false, true)])
      toast.success('Message sent.')
    } catch (requestError) {
      setThreadError(errorMessage(requestError, 'Unable to send message.'))
      toast.error(errorMessage(requestError, 'Unable to send message.'))
    } finally {
      setSending(false)
      window.setTimeout(() => setUploadProgress(0), 600)
    }
  }

  const retryMessage = async (message) => {
    const text = messageText(message)
    if (message?.media_url) {
      toast.info('Select the attachment again to retry this media message.')
      setDraft(text)
      return
    }
    if (!text) return
    setRetryingId(String(message.id))
    try {
      await api.post(`/api/app/conversations/${selectedId}/messages`, {
        content_type: 'text',
        content_text: text,
        idempotency_key: createIdempotencyKey(),
      })
      await Promise.all([loadMessages(selectedId), loadConversations(1, false, true)])
      toast.success('Message sent.')
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Retry failed.'))
    } finally {
      setRetryingId('')
    }
  }

  const openMediaViewer = (index) => setMediaViewer({ items: mediaItems, index })

  const unreadSeparatorIndex = useMemo(() => {
    const unread = Number(selected?.unread_count || 0)
    if (!unread || messageCursor.hasMore || !messages.length) return -1
    let seen = 0
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (isIncoming(messages[index])) {
        seen += 1
        if (seen === unread) return index
      }
    }
    return -1
  }, [selected?.unread_count, messageCursor.hasMore, messages])

  const selectedName = selected?.contact?.name || selected?.contact?.phone || 'Conversation'
  const selectedTagIds = contactTags.map((tag) => Number(tag.id))

  return (
    <div className={`chats-shell${mobileView === 'thread' ? ' is-thread' : ''}`}>
      <ConversationList
        conversations={conversations}
        agents={agents}
        selectedId={selectedId}
        loading={loadingList}
        loadingMore={loadingMore}
        hasMore={pagination.currentPage < pagination.lastPage}
        error={listError}
        filters={{ query, status: statusFilter, assignee: assigneeFilter }}
        onFilterChange={changeFilter}
        onSelect={openConversation}
        onLoadMore={() => loadConversations(pagination.currentPage + 1, true)}
        onRetry={() => loadConversations()}
      />

      <section className="chat-thread" aria-label="Conversation">
        {selected ? (
          <>
            <header className="thread-head">
              <button type="button" className="icon-button thread-back" onClick={backToList} aria-label="Back to conversations"><Icon name="back" size={20} /></button>
              <span className="chat-avatar">{initials(selectedName)}</span>
              <div className="thread-head-info">
                <div className="thread-title">{selectedName}</div>
                <div className="thread-subtitle">{selected.contact?.phone || 'No phone number'}</div>
              </div>
              {hasWhatsApp(selected) && <span className="thread-channel" title="Linked to a WhatsApp number"><Icon name="whatsapp" size={15} /> WhatsApp</span>}
              <div className="thread-tools">
                <div className="thread-search search-wrap">
                  <Icon name="search" size={14} />
                  <input
                    className="input search-input"
                    type="search"
                    aria-label="Search in conversation"
                    placeholder="Search messages"
                    value={messageSearch}
                    onChange={(event) => setMessageSearch(event.target.value)}
                  />
                </div>
                <select
                  className="select select-sm"
                  aria-label="Conversation status"
                  value={selected.status || 'open'}
                  disabled={busyAction === 'status'}
                  onChange={(event) => changeStatus(event.target.value)}
                >
                  <option value="open">Open</option>
                  <option value="pending">Pending</option>
                  <option value="closed">Closed</option>
                </select>
                <select
                  className="select select-sm assign-select"
                  aria-label="Conversation assignee"
                  value={selected.assignedAgent?.id ? String(selected.assignedAgent.id) : 'unassigned'}
                  disabled={busyAction === 'assignee'}
                  onChange={(event) => changeAssignee(event.target.value)}
                >
                  <option value="unassigned">Unassigned</option>
                  <option value="me">Me</option>
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  {selected.assignedAgent && !agents.some((agent) => String(agent.id) === String(selected.assignedAgent.id)) && (
                    <option value={selected.assignedAgent.id}>{selected.assignedAgent.name}</option>
                  )}
                </select>
                <button type="button" className={`icon-button${sidePanel === 'info' ? ' is-open' : ''}`} onClick={() => setSidePanel((value) => value === 'info' ? '' : 'info')} aria-label="Contact information" title="Contact information"><Icon name="contacts" size={18} /></button>
                <button type="button" className={`button button-sm${sidePanel === 'notes' ? ' button-primary' : ' button-secondary'}`} onClick={() => setSidePanel((value) => value === 'notes' ? '' : 'notes')} aria-expanded={sidePanel === 'notes'}>
                  <Icon name="note" size={15} /> Notes{Number(selected.notes_count || 0) > 0 ? ` (${selected.notes_count})` : ''}
                </button>
                <div className="thread-more">
                  <button type="button" className="icon-button" onClick={() => setMoreOpen((value) => !value)} aria-label="More actions" aria-expanded={moreOpen}><Icon name="more" size={18} /></button>
                  {moreOpen && (
                    <div className="thread-more-menu">
                      <button type="button" onClick={copyPhone}><Icon name="copy" size={14} /> Copy phone number</button>
                      <button type="button" onClick={refreshConversation}><Icon name="sync" size={14} /> Refresh conversation</button>
                    </div>
                  )}
                </div>
              </div>
            </header>

            {optedOut && <div className="consent-banner"><Icon name="alert" size={16} /> This contact opted out of WhatsApp messages. Sending is disabled.</div>}

            {sidePanel && (
              <aside className="thread-side-panel" aria-label={sidePanel === 'notes' ? 'Conversation notes' : 'Contact information'}>
                <div className="side-panel-tabs">
                  <button type="button" className={sidePanel === 'info' ? 'is-active' : ''} onClick={() => setSidePanel('info')}>Contact</button>
                  <button type="button" className={sidePanel === 'notes' ? 'is-active' : ''} onClick={() => setSidePanel('notes')}>Notes</button>
                  <button type="button" className="icon-button" onClick={() => setSidePanel('')} aria-label="Close panel"><Icon name="close" size={16} /></button>
                </div>
                {sidePanel === 'info' && (
                  <div className="side-panel-body">
                    <div className="contact-detail-card">
                      <span className="chat-avatar avatar-lg">{initials(selectedName)}</span>
                      <strong>{selectedName}</strong>
                      <span>{selected.contact?.phone || 'No phone number'}</span>
                    </div>
                    <dl className="contact-detail-list">
                      <div><dt>WhatsApp ID</dt><dd>{selected.contact?.wa_user_id || 'Not linked'}</dd></div>
                      <div><dt>Consent</dt><dd><span className={`consent-badge consent-${String(selected.contact?.consent_status || 'unknown')}`}>{selected.contact?.consent_status || 'unknown'}</span></dd></div>
                      <div><dt>Status</dt><dd>{String(selected.status || 'open')}</dd></div>
                      <div><dt>Assignee</dt><dd>{selected.assignedAgent?.name || 'Unassigned'}</dd></div>
                    </dl>
                    <h3>Labels</h3>
                    <div className="tag-picker">
                      {tags.map((tag) => (
                        <button
                          type="button"
                          key={tag.id}
                          className={`tag-chip${selectedTagIds.includes(Number(tag.id)) ? ' is-selected' : ''}`}
                          style={{ backgroundColor: tag.color || '#2563eb' }}
                          onClick={() => toggleTag(tag.id)}
                          aria-pressed={selectedTagIds.includes(Number(tag.id))}
                        >
                          {tag.name}
                        </button>
                      ))}
                      {!tags.length && <span className="muted">No labels have been created.</span>}
                    </div>
                  </div>
                )}
                {sidePanel === 'notes' && (
                  <div className="side-panel-body notes-body">
                    {notesLoading && <div className="list-placeholder"><span className="spinner" /> Loading notes...</div>}
                    {!notesLoading && !notes.length && <div className="list-placeholder">No notes yet.</div>}
                    {notes.map((note) => (
                      <article className="note-item" key={note.id}>
                        <div className="note-body">{note.body ?? note.note ?? note.content ?? ''}</div>
                        <div className="note-meta">
                          <span>{note.user?.name || note.author?.name || 'Team'} · {formatDate(note.created_at)}</span>
                          <button type="button" className="icon-button is-danger" onClick={() => setDeleteNoteId(note.id)} aria-label="Delete note"><Icon name="trash" size={14} /></button>
                        </div>
                      </article>
                    ))}
                    <form className="notes-compose" onSubmit={addNote}>
                      <textarea className="textarea" rows="2" aria-label="New note" placeholder="Write a note..." value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} />
                      <button type="submit" className="button button-sm button-primary" disabled={savingNote || !noteDraft.trim()}>{savingNote ? 'Adding...' : 'Add note'}</button>
                    </form>
                  </div>
                )}
              </aside>
            )}

            <div className="thread-scroll" ref={threadRef}>
              {messageCursor.hasMore && (
                <button type="button" className="button button-sm button-secondary message-load-older" onClick={loadOlderMessages} disabled={loadingOlder}>
                  {loadingOlder ? 'Loading older messages...' : 'Load older messages'}
                </button>
              )}
              {loadingMessages && (
                <div className="thread-loading">
                  {[0, 1, 2, 3].map((item) => <span className={`bubble-skeleton ${item % 2 ? 'out' : 'in'}`} key={item} />)}
                </div>
              )}
              {threadError && <div className="alert alert-error alert-inline thread-error"><span>{threadError}</span><button type="button" className="button button-sm button-secondary" onClick={() => loadMessages(selectedId)}>Retry</button></div>}
              {!loadingMessages && !threadError && !messages.length && <div className="thread-empty"><Icon name="chat" size={28} /><span>{debouncedMessageSearch ? 'No messages match this search.' : 'No messages yet. Send the first message below.'}</span></div>}
              {messages.map((message, index) => {
                const incoming = isIncoming(message)
                const currentDate = messageDate(message)
                const previousDate = messageDate(messages[index - 1])
                const previous = messages[index - 1]
                const grouped = previous && currentDate === messageDate(previous) && isIncoming(previous) === incoming
                  && Math.abs(new Date(message.provider_timestamp || message.created_at).getTime() - new Date(previous.provider_timestamp || previous.created_at).getTime()) < 5 * 60 * 1000
                return (
                  <Fragment key={message.id || index}>
                    {currentDate && currentDate !== previousDate && <div className="message-date">{formatDate(message.provider_timestamp || message.created_at)}</div>}
                    {unreadSeparatorIndex === index && <div className="unread-separator"><span>New messages</span></div>}
                    {replyTo?.id === message.id && <div className="reply-banner"><span>Replying to {incoming ? 'contact' : 'you'}</span><button type="button" className="icon-button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><Icon name="close" size={14} /></button></div>}
                    <MessageBubble
                      message={message}
                      incoming={incoming}
                      mediaItems={mediaItems}
                      onOpenMedia={openMediaViewer}
                      onReply={setReplyTo}
                      onRetry={retryMessage}
                      retrying={retryingId === String(message.id)}
                      grouped={grouped}
                    />
                  </Fragment>
                )
              })}
            </div>

            <ChatComposer
              draft={draft}
              onDraftChange={setDraft}
              onSend={send}
              sending={sending}
              optedOut={optedOut}
              file={selectedFile}
              onFileSelect={setSelectedFile}
              onFileRemove={() => setSelectedFile(null)}
              uploadProgress={uploadProgress}
              quickReplies={quickReplies}
            />
            {replyTo && <div className="reply-context"><Icon name="reply" size={14} /><span>{messageText(replyTo) || 'Attachment'}</span><button type="button" className="icon-button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><Icon name="close" size={14} /></button></div>}
          </>
        ) : (
          <div className="thread-placeholder"><Icon name="chat" size={36} /><p>Select a conversation to start chatting.</p></div>
        )}
      </section>

      {mediaViewer && (
        <MediaViewer
          items={mediaViewer.items}
          index={mediaViewer.index}
          onIndexChange={(index) => setMediaViewer((current) => ({ ...current, index }))}
          onClose={() => setMediaViewer(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteNoteId)}
        title="Delete this note?"
        message="This note will be removed from the conversation. This action cannot be undone."
        confirmLabel="Delete note"
        busy={deletingNote}
        onConfirm={confirmDeleteNote}
        onCancel={() => setDeleteNoteId(null)}
      />
    </div>
  )
}
