import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from '../lib/navigation.js'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { PresenceDot, presenceStatus, useMemberPresence } from '../components/common/MemberPresence.jsx'
import { createIdempotencyKey, errorMessage, extractList, extractPaginator, formatDate } from '../lib/utils.js'
import { interactiveText, templateMessagePayload } from '../lib/whatsappPayloads.js'
import ConversationList from '../components/chat/ConversationList.jsx'
import ChatAvatar from '../components/chat/ChatAvatar.jsx'
import MessageBubble from '../components/chat/MessageBubble.jsx'
import MediaViewer from '../components/chat/MediaViewer.jsx'
import ChatComposer from '../components/chat/ChatComposer.jsx'
import AiThreadBanner from '../components/chat/AiThreadBanner.jsx'
import { fileType, hasWhatsApp, isIncoming, mediaItem, messageText, messageTimestamp } from '../components/chat/chatUtils.js'
import { subscribeToRealtime } from '../lib/realtime.js'
import { conversationMatchesFilters, mergeConversations, mergeMessageList, messagePreview, removeConversations, removeMessages } from '../lib/realtimeChat.js'

function messageDate(message) {
  const value = messageTimestamp(message)
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toDateString() : ''
}

function chronological(messages) {
  return [...messages].sort((left, right) => Number(left.id) - Number(right.id))
}

const INBOX_FILTERS = ['all', 'waiting', 'unassigned', 'expiring', 'unread', 'open', 'pending', 'closed']

export default function ChatsPage() {
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  const presence = useMemberPresence()
  const toast = useToast()
  const urlConversation = params.get('c') || params.get('conversation')
  const urlFilter = params.get('filter')

  const [conversations, setConversations] = useState([])
  const [pagination, setPagination] = useState({ currentPage: 1, lastPage: 1, total: 0 })
  const [linkedConversation, setLinkedConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [messageCursor, setMessageCursor] = useState({ next: null, hasMore: false })
  const [selectedId, setSelectedId] = useState(urlConversation || '')
  const [mobileView, setMobileView] = useState(urlConversation ? 'thread' : 'list')

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState(INBOX_FILTERS.includes(urlFilter) ? urlFilter : 'all')
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
  const [messageToDelete, setMessageToDelete] = useState(null)
  const [deletingMessage, setDeletingMessage] = useState(false)
  const [deleteConversationOpen, setDeleteConversationOpen] = useState(false)
  const [deletingConversation, setDeletingConversation] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [threadSearchOpen, setThreadSearchOpen] = useState(false)

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
  const [reactingId, setReactingId] = useState(null)
  const [busyAction, setBusyAction] = useState('')
  const [listError, setListError] = useState('')
  const [threadError, setThreadError] = useState('')
  const [mediaViewer, setMediaViewer] = useState(null)
  const [realtimeConnected, setRealtimeConnected] = useState(false)

  const realtimeConnectedRef = useRef(false)
  const threadRef = useRef(null)
  const threadMoreRef = useRef(null)
  const listAbortRef = useRef(null)
  const threadAbortRef = useRef(null)
  const loadingMessageUpdatesRef = useRef(null)
  const listChangesRef = useRef(null)
  const sendAttemptRef = useRef(null)
  const richSendAttemptRef = useRef(null)
  const selectedIdRef = useRef(selectedId)
  const messagesConversationRef = useRef(selectedId)
  const scrollRestoreRef = useRef(null)
  const scrollToBottomRef = useRef(true)
  const statusFilterRef = useRef(statusFilter)
  const assigneeFilterRef = useRef(assigneeFilter)
  const debouncedQueryRef = useRef(debouncedQuery)
  const currentUserIdRef = useRef(user?.id)
  const messagesRef = useRef(messages)
  const realtimeSinceRef = useRef(new Date(Date.now() - 60_000).toISOString())
  const recoveryInFlightRef = useRef(false)
  const readRequestRef = useRef(null)
  const messageSearchRef = useRef(debouncedMessageSearch)
  const loadedMessageSearchRef = useRef(debouncedMessageSearch)
  messageSearchRef.current = debouncedMessageSearch
  selectedIdRef.current = selectedId
  statusFilterRef.current = statusFilter
  assigneeFilterRef.current = assigneeFilter
  debouncedQueryRef.current = debouncedQuery
  currentUserIdRef.current = user?.id
  messagesRef.current = messages

  const selected = conversations.find((item) => String(item.id) === String(selectedId))
    || (String(linkedConversation?.id) === selectedId ? linkedConversation : null)
  const readOnly = user?.role === 'viewer'
  const canDelete = ['admin', 'owner'].includes(user?.role)
  const windowOpen = Date.now() - Date.parse(selected?.last_inbound_at) < 24 * 60 * 60 * 1000
  const contactTags = selected?.contact?.tags || []

  const mediaItems = useMemo(() => messages.map(mediaItem).filter(Boolean), [messages])

  const loadConversations = useCallback(async (page = 1, append = false, background = false) => {
    if (listAbortRef.current && background) return
    listAbortRef.current?.abort()
    const controller = new AbortController()
    listAbortRef.current = controller
    const liveChanges = new Set()
    listChangesRef.current = liveChanges
    if (!background && page === 1) setLoadingList(true)
    if (append) setLoadingMore(true)
    try {
      const { data } = await api.get('/api/app/conversations', {
        signal: controller.signal,
        params: {
          search: debouncedQuery || undefined,
          status: statusFilter,
          assigned: assigneeFilter,
          per_page: 30,
          page,
        },
      })
      if (controller.signal.aborted) return
      const rows = extractList(data)
      setConversations((current) => {
        if (append) {
          const seen = new Set(current.map((item) => String(item.id)))
          return [...current, ...rows.filter((item) => !seen.has(String(item.id)))]
        }
        const visibleIds = new Set(rows.map((item) => String(item.id)))
        return mergeConversations(current, rows, statusFilterRef.current)
          .filter((item) => visibleIds.has(String(item.id)))
      })
      setPagination(extractPaginator(data))
      setListError('')
    } catch (requestError) {
      if (!background && !controller.signal.aborted && requestError.code !== 'ERR_CANCELED') setListError(errorMessage(requestError, 'Unable to load conversations.'))
    } finally {
      if (listAbortRef.current === controller) {
        listAbortRef.current = null
        listChangesRef.current = null
        setLoadingList(false)
        setLoadingMore(false)
      }
    }
  }, [debouncedQuery, statusFilter, assigneeFilter])

  const loadOptions = useCallback(async (signal) => {
    try {
      const [agentResult, replyResult, tagResult] = await Promise.all([
        api.get('/api/app/agents', { signal }),
        api.get('/api/app/quick-replies', { signal }),
        api.get('/api/app/tags', { signal }),
      ])
      setAgents(extractList(agentResult.data))
      setQuickReplies(extractList(replyResult.data))
      setTags(extractList(tagResult.data))
    } catch (requestError) {
      if (requestError.code !== 'ERR_CANCELED') toast.error(errorMessage(requestError, 'Unable to load chat options.'))
    }
  }, [toast])

  const loadNotes = useCallback(async (id, signal) => {
    if (!id) return
    setNotesLoading(true)
    try {
      const { data } = await api.get(`/api/app/conversations/${id}/notes`, { signal })
      if (!signal?.aborted && selectedIdRef.current === id) setNotes(extractList(data))
    } catch (requestError) {
      if (requestError.code !== 'ERR_CANCELED') toast.error(errorMessage(requestError, 'Unable to load notes.'))
    } finally {
      if (!signal?.aborted && selectedIdRef.current === id) setNotesLoading(false)
    }
  }, [toast])

  const loadMessages = useCallback(async (id, options = {}) => {
    const { background = false, cursor = null, search = debouncedMessageSearch, markRead = false } = options
    if (!id) return false

    if (threadAbortRef.current && background) return false
    threadAbortRef.current?.abort()
    const controller = new AbortController()
    threadAbortRef.current = controller
    const liveUpdates = { id, messages: [] }
    loadingMessageUpdatesRef.current = liveUpdates

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
        signal: controller.signal,
      })
      if (controller.signal.aborted || selectedIdRef.current !== id) return false

      const history = extractList(data)
      const historyIds = new Set(history.map((message) => String(message.id)))
      const batch = mergeMessageList(chronological(history), liveUpdates.messages.filter((row) => historyIds.has(String(row.id))))
      if (cursor) {
        setMessages((current) => {
          const seen = new Set(current.map((message) => String(message.id)))
          return [...batch.filter((message) => !seen.has(String(message.id))), ...current]
        })
      } else if (messagesConversationRef.current === id && loadedMessageSearchRef.current === search) {
        setMessages((current) => mergeMessageList(current, batch))
      } else {
        setMessages(batch)
      }

      messagesConversationRef.current = id
      loadedMessageSearchRef.current = search
      if (!background && !cursor) {
        setMessageCursor({ next: data.next_cursor || null, hasMore: Boolean(data.next_cursor) })
      }

      if (markRead) {
        try {
          await api.post(`/api/app/conversations/${id}/read`, null, { signal: controller.signal })
          if (!realtimeConnectedRef.current) {
            window.dispatchEvent(new Event('wacrm:inbox-changed'))
            setConversations((items) => items.map((item) => String(item.id) === String(id) ? { ...item, unread_count: 0 } : item))
          }
        } catch (requestError) {
          if (requestError.code !== 'ERR_CANCELED') toast.error(errorMessage(requestError, 'Unable to mark the conversation as read.'))
        }
      }
      return true
    } catch (requestError) {
      if (requestError?.name === 'CanceledError' || requestError?.code === 'ERR_CANCELED') return false
      if (!background) setThreadError(errorMessage(requestError, 'Unable to load messages.'))
      return false
    } finally {
      if (threadAbortRef.current === controller) {
        threadAbortRef.current = null
        loadingMessageUpdatesRef.current = null
        setLoadingMessages(false)
        setLoadingOlder(false)
      }
    }
  }, [debouncedMessageSearch, toast])

  const applyMessages = useCallback((incoming, existingOnly = false) => {
    const rows = Array.isArray(incoming) ? incoming : [incoming]
    const conversationId = rows[0]?.conversation_id
    if (!rows.length || (conversationId && String(conversationId) !== String(selectedIdRef.current))) return

    const liveUpdates = loadingMessageUpdatesRef.current
    if (existingOnly && liveUpdates?.id === String(conversationId)) {
      liveUpdates.messages = mergeMessageList(liveUpdates.messages, rows)
    }
    setMessages((current) => {
      if (conversationId && String(conversationId) !== String(selectedIdRef.current)) return current
      const matching = existingOnly || messageSearchRef.current
        ? rows.filter((row) => current.some((message) => String(message.id) === String(row.id)
          || (row.idempotency_key && row.idempotency_key === message.idempotency_key))
          || (!existingOnly && [row.content_text, row.filename, row.template_name].some((value) => String(value || '').toLowerCase().includes(messageSearchRef.current.toLowerCase()))))
        : rows
      const next = mergeMessageList(current, matching)
      if (next === current) return current
      const node = threadRef.current
      scrollToBottomRef.current = Boolean(node && node.scrollHeight - node.scrollTop - node.clientHeight < 140)
      return next
    })
  }, [])

  const applyConversations = useCallback((incoming) => {
    const rows = Array.isArray(incoming) ? incoming : [incoming]
    if (!rows.length) return
    rows.forEach((row) => { if (row?.id) listChangesRef.current?.add(String(row.id)) })

    setConversations((current) => {
      let next = current
      rows.forEach((row) => {
        if (!row?.id) return
        const id = String(row.id)
        const previous = next.find((item) => String(item.id) === id)
        const merged = previous ? mergeConversations([previous], [row])[0] : row
        const visible = conversationMatchesFilters(
          merged,
          statusFilterRef.current,
          assigneeFilterRef.current,
          debouncedQueryRef.current,
          currentUserIdRef.current,
        )
        next = visible ? mergeConversations(next, [merged], statusFilterRef.current) : removeConversations(next, [id])
      })
      return next
    })
    setLinkedConversation((current) => {
      if (!current) return current
      const match = rows.find((row) => String(row.id) === String(current.id))
      if (!match) return current
      return { ...current, ...match, contact: match.contact || current.contact }
    })
  }, [])

  const updateOptimisticError = (id, error) => {
    const status = error.response && error.response.status < 500 ? 'failed' : 'pending'
    setMessages((current) => current.map((message) => message.id === id ? { ...message, status } : message))
  }

  const removeMessageItems = useCallback((ids) => {
    setMessages((current) => removeMessages(current, ids))
  }, [])

  const removeConversationItems = useCallback((ids) => {
    const removed = Array.isArray(ids) ? ids : [ids]
    removed.forEach((id) => listChangesRef.current?.add(String(id)))
    setConversations((current) => removeConversations(current, removed))
    if (removed.some((id) => String(id) === String(selectedIdRef.current))) {
      setSelectedId('')
      setMessages([])
      setLinkedConversation(null)
      setParams((current) => {
        const next = new URLSearchParams(current)
        next.delete('conversation')
        next.delete('c')
        return next
      }, { replace: true })
    }
  }, [setParams])

  const markIncomingRead = useCallback((conversation) => {
    if (!conversation?.unread_count || String(conversation.id) !== selectedIdRef.current
      || document.visibilityState !== 'visible' || !threadRef.current?.getClientRects().length || readOnly || readRequestRef.current) return
    readRequestRef.current = window.setTimeout(() => {
      readRequestRef.current = null
      if (String(conversation.id) !== selectedIdRef.current || document.visibilityState !== 'visible' || !threadRef.current?.getClientRects().length) return
      api.post(`/api/app/conversations/${conversation.id}/read`).catch(() => {})
    }, 150)
  }, [readOnly])

  const recoverRealtime = useCallback(async () => {
    if (recoveryInFlightRef.current) return
    recoveryInFlightRef.current = true

    try {
      const conversationId = selectedIdRef.current || undefined
      const ids = conversationId && messagesConversationRef.current === conversationId
        ? messagesRef.current.map((message) => Number(message.id)).filter(Number.isFinite)
        : []
      const { data } = await api.get('/api/app/realtime/sync', {
        params: {
          conversation_id: conversationId,
          after_id: ids.length ? Math.max(...ids) : undefined,
          since: realtimeSinceRef.current,
        },
      })
      if (data.messages?.length) applyMessages(data.messages)
      if (data.conversations?.length) {
        applyConversations(data.conversations)
        markIncomingRead(data.conversations.find((row) => String(row.id) === selectedIdRef.current))
      }
      if (data.server_time) realtimeSinceRef.current = data.server_time
    } catch {
      void 0
    } finally {
      recoveryInFlightRef.current = false
    }
  }, [applyConversations, applyMessages, markIncomingRead])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedMessageSearch(messageSearch), 350)
    return () => clearTimeout(timer)
  }, [messageSearch])

  useEffect(() => {
    if (!moreOpen) return undefined
    const close = (event) => {
      if (!threadMoreRef.current?.contains(event.target)) setMoreOpen(false)
    }
    const onKey = (event) => { if (event.key === 'Escape') setMoreOpen(false) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => loadOptions(controller.signal), 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [loadOptions])

  useEffect(() => {
    const timer = window.setTimeout(() => loadConversations(), 0)
    return () => {
      window.clearTimeout(timer)
      listAbortRef.current?.abort()
      listAbortRef.current = null
    }
  }, [loadConversations])

  useEffect(() => {
    setStatusFilter(INBOX_FILTERS.includes(urlFilter) ? urlFilter : 'all')
  }, [urlFilter])

  useEffect(() => {
    setSelectedId((current) => {
      if (urlConversation || (current && conversations.some((item) => String(item.id) === current))) return current
      return conversations[0] ? String(conversations[0].id) : ''
    })
  }, [conversations, urlConversation])

  const needsLinkedConversation = Boolean(urlConversation && selectedId === urlConversation
    && !conversations.some((item) => String(item.id) === urlConversation))
  useEffect(() => {
    if (loadingList || !needsLinkedConversation) return
    const controller = new AbortController()
    api.get(`/api/app/conversations/${urlConversation}`, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setLinkedConversation(data) })
      .catch((error) => {
        if (error.code !== 'ERR_CANCELED') setThreadError(errorMessage(error, 'Unable to open the conversation.'))
      })
    return () => controller.abort()
  }, [loadingList, needsLinkedConversation, urlConversation])

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
    setThreadSearchOpen(false)
  }, [selectedId])

  useEffect(() => {
    if (!selectedId) return
    const timer = window.setTimeout(() => {
      loadMessages(selectedId, { markRead: !readOnly && !debouncedMessageSearch && Boolean(threadRef.current?.getClientRects().length) })
    }, 0)
    return () => {
      window.clearTimeout(timer)
      threadAbortRef.current?.abort()
      threadAbortRef.current = null
      loadingMessageUpdatesRef.current = null
    }
  }, [debouncedMessageSearch, loadMessages, readOnly, selectedId])

  useEffect(() => {
    if (sidePanel !== 'notes' || !selectedId) return
    const controller = new AbortController()
    loadNotes(selectedId, controller.signal)
    return () => controller.abort()
  }, [sidePanel, selectedId, loadNotes])

  useEffect(() => subscribeToRealtime({
    onConnectionChange: (ready) => {
      realtimeConnectedRef.current = ready
      setRealtimeConnected(ready)
    },
    onMessageCreated: (payload) => {
      if (payload?.message) applyMessages(payload.message)
      if (payload?.conversation) {
        applyConversations(payload.conversation)
        if (payload.message?.sender_type === 'customer') markIncomingRead(payload.conversation)
      }
    },
    onMessageUpdated: (payload) => {
      if (payload?.message) applyMessages(payload.message, true)
    },
    onMessageStatusChanged: (payload) => {
      if (payload?.message) applyMessages(payload.message, true)
    },
    onMessageDeleted: (payload) => {
      if (payload?.message_id || payload?.messageId) removeMessageItems(payload.message_id || payload.messageId)
      if (payload?.conversation) applyConversations(payload.conversation)
    },
    onConversationUpdated: (payload) => {
      if (payload?.conversation) applyConversations(payload.conversation)
    },
    onConversationDeleted: (payload) => {
      if (payload?.conversation_id || payload?.conversationId) removeConversationItems(payload.conversation_id || payload.conversationId)
    },
    onReconnected: recoverRealtime,
  }), [applyConversations, applyMessages, recoverRealtime, removeConversationItems, removeMessageItems, markIncomingRead])

  useEffect(() => {
    const recoverVisible = () => {
      if (document.visibilityState === 'visible') void recoverRealtime()
    }
    const timer = realtimeConnected ? null : window.setInterval(recoverVisible, 5_000)
    document.addEventListener('visibilitychange', recoverVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', recoverVisible)
    }
  }, [realtimeConnected, recoverRealtime])

  useEffect(() => {
    if (mobileView === 'thread') markIncomingRead(selected)
  }, [mobileView, selected, markIncomingRead])

  useEffect(() => () => window.clearTimeout(readRequestRef.current), [])

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

  const changeFilter = (key, value) => {
    if (key === 'query') setQuery(value)
    if (key === 'status') {
      setStatusFilter(value)
      setMobileView('list')
      setParams((current) => {
        const next = new URLSearchParams(current)
        if (value === 'all') next.delete('filter')
        else next.set('filter', value)
        return next
      }, { replace: true })
    }
    if (key === 'assignee') setAssigneeFilter(value)
  }

  const openConversation = (id) => {
    const value = String(id)
    setSelectedId(value)
    setMobileView('thread')
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('conversation')
      next.set('c', value)
      return next
    }, { replace: true })
  }

  const backToList = () => {
    setMobileView('list')
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('conversation')
      next.delete('c')
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

  const patchConversation = async (path, payload, optimistic, key) => {
    if (!selectedId) return
    setBusyAction(key)
    setConversations((items) => items.map((item) => String(item.id) === String(selectedId) ? { ...item, ...optimistic } : item))
    try {
      const { data } = await api.patch(`/api/app/conversations/${selectedId}/${path}`, payload)
      setConversations((items) => items.map((item) => String(item.id) === String(selectedId) ? { ...item, ...data, contact: item.contact, assignedAgent: item.assignedAgent } : item))
    } catch (requestError) {
      setConversations((items) => items.map((item) => String(item.id) === String(selectedId) ? { ...item, ...optimistic, ...(key === 'status' ? { status: selected?.status } : { assignedAgent: selected?.assignedAgent }) } : item))
      toast.error(errorMessage(requestError, 'Unable to update the conversation.'))
      loadConversations(1, false, true)
    } finally {
      setBusyAction('')
    }
  }

  const changeStatus = (status) => patchConversation('status', { status }, { status }, 'status')

  const changeAssignee = (value) => {
    const assigneeId = value === 'unassigned' ? null : value === 'me' ? user?.id ?? null : value
    const agent = agents.find((item) => String(item.id) === String(assigneeId))
    patchConversation('assign', { assignee_id: assigneeId }, { assignedAgent: agent || null }, 'assignee')
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
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to delete the note.'))
    } finally {
      setDeletingNote(false)
      setDeleteNoteId(null)
    }
  }

  const confirmDeleteMessage = async () => {
    if (!messageToDelete?.id || !selectedId) return
    setDeletingMessage(true)
    try {
      await api.delete(`/api/app/messages/${messageToDelete.id}`)
      setMessages((items) => items.filter((item) => String(item.id) !== String(messageToDelete.id)))
      setReplyTo((item) => item?.id === messageToDelete.id ? null : item)
      setMessageToDelete(null)
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to delete the message.'))
    } finally {
      setDeletingMessage(false)
    }
  }

  const confirmDeleteConversation = async () => {
    if (!selectedId) return
    const conversationId = selectedId
    setDeletingConversation(true)
    try {
      await api.delete(`/api/app/conversations/${conversationId}`)
      setConversations((items) => items.filter((item) => String(item.id) !== String(conversationId)))
      setLinkedConversation(null)
      setSelectedId('')
      setMessages([])
      setMessageCursor({ next: null, hasMore: false })
      setReplyTo(null)
      setSidePanel('')
      setMoreOpen(false)
      setMobileView('list')
      setParams((current) => {
        const next = new URLSearchParams(current)
        next.delete('conversation')
        next.delete('c')
        return next
      }, { replace: true })
      setDeleteConversationOpen(false)
      window.dispatchEvent(new Event('wacrm:inbox-changed'))
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to delete the conversation.'))
    } finally {
      setDeletingConversation(false)
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
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to update contact labels.'))
    }
  }

  const copyPhone = async () => {
    if (!selected?.contact?.phone) return
    try {
      await navigator.clipboard.writeText(selected.contact.phone)
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
    const conversationId = selectedId
    setSending(true)
    setThreadError('')
    setUploadProgress(0)
    const signature = `${conversationId}|${text}|${selectedFile?.name || ''}|${selectedFile?.size || ''}|${replyTo?.id || ''}`
    if (sendAttemptRef.current?.signature !== signature) {
      sendAttemptRef.current = { signature, key: createIdempotencyKey() }
    }
    const idempotencyKey = sendAttemptRef.current.key
    const optimistic = {
      id: `tmp-${idempotencyKey}`,
      conversation_id: Number(conversationId),
      sender_type: 'agent',
      sender_id: user?.id,
      content_type: selectedFile ? fileType(selectedFile) : 'text',
      content_text: text || null,
      filename: selectedFile?.name || null,
      media_type: selectedFile?.type || null,
      media_url: null,
      status: 'sending',
      created_at: new Date().toISOString(),
      provider_timestamp: null,
      reactions: [],
      idempotency_key: idempotencyKey,
      reply_to_message_id: replyTo?.id || null,
      replyTo: replyTo ? {
        id: replyTo.id,
        content_text: messageText(replyTo),
        sender_type: replyTo.sender_type,
        content_type: replyTo.content_type,
        filename: replyTo.filename,
      } : null,
    }
    applyMessages([optimistic])
    applyConversations([{
      id: Number(conversationId),
      last_message_text: messagePreview(optimistic),
      last_message_at: optimistic.created_at,
      last_reply_at: optimistic.created_at,
    }])

    setDraft('')
    setSelectedFile(null)
    setReplyTo(null)

    const finishSend = (saved) => {
      sendAttemptRef.current = null
      applyMessages([saved])
      const activityAt = saved?.created_at
      applyConversations([{
        id: Number(conversationId),
        last_message_text: messagePreview(saved),
        last_message_at: activityAt,
        last_reply_at: activityAt,
      }])
      setUploadProgress(100)
    }

    try {
      if (selectedFile) {
        const payload = new FormData()
        payload.append('content_type', fileType(selectedFile))
        payload.append('file', selectedFile)
        if (text) payload.append('content_text', text)
        if (replyTo?.id) payload.append('reply_to_message_id', replyTo.id)
        payload.append('idempotency_key', idempotencyKey)
        const { data } = await api.post(`/api/app/conversations/${conversationId}/messages`, payload, {
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) setUploadProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total))
          },
        })
        finishSend(data)
      } else {
        const { data } = await api.post(`/api/app/conversations/${conversationId}/messages`, {
          content_type: 'text',
          content_text: text,
          ...(replyTo?.id ? { reply_to_message_id: replyTo.id } : {}),
          idempotency_key: idempotencyKey,
        })
        finishSend(data)
      }
    } catch (requestError) {
      const failed = requestError.response?.data?.data
      if (failed?.id) applyMessages([failed])
      else updateOptimisticError(optimistic.id, requestError)
      sendAttemptRef.current = null
      const message = errorMessage(requestError, 'Unable to send message.')
      toast.error(message)
    } finally {
      setSending(false)
      window.setTimeout(() => setUploadProgress(0), 600)
    }
  }

  const retryMessage = async (message) => {
    if (message.content_type === 'template') {
      toast.info('Open the template picker to send this template again.')
      return
    }
    if (message.content_type === 'interactive' && message.interactive_payload) {
      await sendInteractive(message.interactive_payload)
      return
    }
    const text = messageText(message)
    if (message?.media_url || ['image', 'video', 'audio', 'document'].includes(message.content_type)) {
      toast.info('Select the attachment again to retry this media message.')
      setDraft(text)
      return
    }
    if (!text || !selectedId) return
    const conversationId = selectedId
    const key = createIdempotencyKey()
    const optimistic = {
      id: `tmp-${key}`,
      conversation_id: Number(conversationId),
      sender_type: 'agent',
      sender_id: user?.id,
      content_type: 'text',
      content_text: text,
      status: 'sending',
      created_at: new Date().toISOString(),
      reactions: [],
      idempotency_key: key,
    }
    removeMessageItems(message.id)
    applyMessages([optimistic])
    applyConversations([{
      id: Number(conversationId),
      last_message_text: messagePreview(optimistic),
      last_message_at: optimistic.created_at,
      last_reply_at: optimistic.created_at,
    }])
    setRetryingId(String(optimistic.id))
    try {
      const { data } = await api.post(`/api/app/conversations/${conversationId}/messages`, {
        content_type: 'text',
        content_text: text,
        idempotency_key: key,
      })
      applyMessages([data])
      const activityAt = data?.created_at
      applyConversations([{ id: Number(conversationId), last_message_text: messagePreview(data), last_message_at: activityAt, last_reply_at: activityAt }])
    } catch (requestError) {
      const failed = requestError.response?.data?.data
      if (failed?.id) applyMessages([failed])
      else updateOptimisticError(optimistic.id, requestError)
      toast.error(errorMessage(requestError, 'Retry failed.'))
    } finally {
      setRetryingId('')
    }
  }

  const sendRichMessage = async (signature, buildPayload) => {
    if (!selectedId || sending || readOnly) return false
    const conversationId = selectedId
    const attemptSignature = JSON.stringify([conversationId, replyTo?.id, signature])
    if (richSendAttemptRef.current?.signature !== attemptSignature) {
      richSendAttemptRef.current = { signature: attemptSignature, key: createIdempotencyKey() }
    }
    const key = richSendAttemptRef.current.key
    const payload = buildPayload(key, replyTo?.id)
    const optimistic = {
      id: `tmp-${key}`,
      conversation_id: Number(conversationId),
      sender_type: 'agent',
      sender_id: user?.id,
      content_type: payload.content_type || 'interactive',
      content_text: payload.content_text || null,
      template_name: payload.template_name || null,
      interactive_payload: payload.interactive_payload || null,
      status: 'sending',
      created_at: new Date().toISOString(),
      reactions: [],
      idempotency_key: key,
      reply_to_message_id: replyTo?.id || null,
    }
    applyMessages([optimistic])
    applyConversations([{
      id: Number(conversationId),
      last_message_text: messagePreview(optimistic),
      last_message_at: optimistic.created_at,
      last_reply_at: optimistic.created_at,
    }])
    setSending(true)
    setThreadError('')
    try {
      const { data } = await api.post(`/api/app/conversations/${conversationId}/messages`, payload)
      richSendAttemptRef.current = null
      applyMessages([data])
      const activityAt = data?.created_at
      applyConversations([{ id: Number(conversationId), last_message_text: messagePreview(data), last_message_at: activityAt, last_reply_at: activityAt }])
      if (selectedIdRef.current === conversationId) setReplyTo(null)
      return true
    } catch (requestError) {
      const failed = requestError.response?.data?.data
      if (failed?.id) applyMessages([failed])
      else updateOptimisticError(optimistic.id, requestError)
      if (failed?.status === 'failed') richSendAttemptRef.current = null
      toast.error(errorMessage(requestError, 'Unable to send message.'))
      return false
    } finally {
      setSending(false)
    }
  }

  const sendInteractive = (payload) => sendRichMessage(payload, (key, replyToId) => ({
    content_type: 'interactive',
    content_text: interactiveText(payload),
    interactive_payload: payload,
    reply_to_message_id: replyToId,
    idempotency_key: key,
  }))

  const sendTemplate = (template, values) => sendRichMessage([
    template.id, values.body, values.headerText, values.buttonParams, values.headerFile?.name, values.headerFile?.lastModified,
  ], (key, replyToId) => templateMessagePayload(template, values, key, replyToId))

  const reactToMessage = async (message, emoji) => {
    if (reactingId != null || readOnly) return
    const businessReaction = message.reactions?.find((reaction) => reaction.actor_type === 'agent')
    setReactingId(message.id)
    try {
      const { data } = await api.post('/api/app/messages/' + message.id + '/react', {
        emoji: businessReaction?.emoji === emoji ? '' : emoji,
      })
      if (String(message.conversation_id) === selectedIdRef.current) {
        setMessages((items) => items.map((item) => item.id === message.id ? { ...item, reactions: data.reactions } : item))
      }
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to save reaction.'))
    } finally {
      setReactingId(null)
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
            <header className={`thread-head${threadSearchOpen ? ' is-search-open' : ''}`}>
              <button type="button" className="icon-button thread-back" onClick={backToList} aria-label="Back to conversations"><Icon name="back" size={20} /></button>
              <ChatAvatar contact={selected.contact} name={selectedName} />
              <div className="thread-head-info">
                <div className="thread-title">{selectedName}</div>
                <div className="thread-subtitle">
                  {selected.contact?.phone || 'No phone number'}
                  {selected.assignedAgent ? ` · ${selected.assignedAgent.name}` : ''}
                </div>
              </div>
              {hasWhatsApp(selected) && <span className="thread-channel" title="Linked to a WhatsApp number"><Icon name="whatsapp" size={15} /> WhatsApp</span>}
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
              <div className="thread-more" ref={threadMoreRef}>
                <button type="button" className="icon-button" onClick={() => setMoreOpen((value) => !value)} aria-label="More actions" aria-expanded={moreOpen}><Icon name="more" size={20} /></button>
                {moreOpen && (
                  <div className="thread-more-menu">
                    <button type="button" onClick={() => { setThreadSearchOpen((value) => !value); setMoreOpen(false) }}><Icon name="search" size={14} /> Search in chat</button>
                    <button type="button" onClick={() => { setSidePanel('info'); setMoreOpen(false) }}><Icon name="contacts" size={14} /> Contact info</button>
                    <button type="button" onClick={() => { setSidePanel('notes'); setMoreOpen(false) }}><Icon name="note" size={14} /> Notes{Number(selected.notes_count || 0) > 0 ? ` (${selected.notes_count})` : ''}</button>
                    <label className="thread-menu-field">
                      <span>Status</span>
                      <select
                        className="select select-sm"
                        value={selected.status || 'open'}
                        disabled={readOnly || busyAction === 'status'}
                        onChange={(event) => { changeStatus(event.target.value); setMoreOpen(false) }}
                      >
                        <option value="open">Open</option>
                        <option value="pending">Pending</option>
                        <option value="closed">Closed</option>
                      </select>
                    </label>
                    <label className="thread-menu-field">
                      <span>Assignee</span>
                      <select
                        className="select select-sm"
                        value={selected.assignedAgent?.id ? String(selected.assignedAgent.id) : 'unassigned'}
                        disabled={readOnly || busyAction === 'assignee'}
                        onChange={(event) => { changeAssignee(event.target.value); setMoreOpen(false) }}
                      >
                        <option value="unassigned">Unassigned</option>
                        <option value="me">Me</option>
                        {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {presenceStatus(presence[agent.id])}</option>)}
                        {selected.assignedAgent && !agents.some((agent) => String(agent.id) === String(selected.assignedAgent.id)) && (
                          <option value={selected.assignedAgent.id}>{selected.assignedAgent.name}</option>
                        )}
                      </select>
                    </label>
                    <button type="button" onClick={copyPhone}><Icon name="copy" size={14} /> Copy phone number</button>
                    <button type="button" onClick={refreshConversation}><Icon name="sync" size={14} /> Refresh conversation</button>
                    {canDelete && <button type="button" onClick={() => { setMoreOpen(false); setDeleteConversationOpen(true) }}><Icon name="trash" size={14} /> Delete chat from CRM</button>}
                  </div>
                )}
              </div>
            </header>

            <AiThreadBanner conversation={selected} readOnly={readOnly} onChange={(data) => {
              setConversations((items) => items.map((item) => item.id === data.id ? { ...item, ...data } : item))
            }} />

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
                      <ChatAvatar contact={selected.contact} name={selectedName} className="avatar-lg" />
                      <strong>{selectedName}</strong>
                      <span>{selected.contact?.phone || 'No phone number'}</span>
                    </div>
                    <dl className="contact-detail-list">
                      <div><dt>WhatsApp ID</dt><dd>{selected.contact?.wa_user_id || 'Not linked'}</dd></div>
                      <div><dt>Status</dt><dd>{String(selected.status || 'open')}</dd></div>
                      <div><dt>Assignee</dt><dd>{selected.assignedAgent ? <><PresenceDot member={presence[selected.assignedAgent.id]} />{selected.assignedAgent.name}</> : 'Unassigned'}</dd></div>
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
                          disabled={readOnly}
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
                          {!readOnly && (user?.id === note.user_id || ['admin', 'owner'].includes(user?.role)) && <button type="button" className="icon-button is-danger" onClick={() => setDeleteNoteId(note.id)} aria-label="Delete note"><Icon name="trash" size={14} /></button>}
                        </div>
                      </article>
                    ))}
                    {!readOnly && <form className="notes-compose" onSubmit={addNote}>
                      <textarea className="textarea" rows="2" aria-label="New note" placeholder="Write a note..." value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} />
                      <button type="submit" className="button button-sm button-primary" disabled={savingNote || !noteDraft.trim()}>{savingNote ? 'Adding...' : 'Add note'}</button>
                    </form>}
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
                  && Math.abs(new Date(messageTimestamp(message)).getTime() - new Date(messageTimestamp(previous)).getTime()) < 5 * 60 * 1000
                return (
                  <Fragment key={message.idempotency_key || message.id || index}>
                    {currentDate && currentDate !== previousDate && <div className="message-date">{formatDate(messageTimestamp(message))}</div>}
                    {unreadSeparatorIndex === index && <div className="unread-separator"><span>New messages</span></div>}
                    {replyTo?.id === message.id && <div className="reply-banner"><span>Replying to {incoming ? 'contact' : 'you'}</span><button type="button" className="icon-button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><Icon name="close" size={14} /></button></div>}
                    <MessageBubble
                      message={message}
                      incoming={incoming}
                      mediaItems={mediaItems}
                      onOpenMedia={openMediaViewer}
                      onReply={readOnly ? undefined : setReplyTo}
                      onRetry={readOnly ? undefined : retryMessage}
                      onReact={!readOnly && reactingId == null && message.message_id ? reactToMessage : undefined}
                      onDelete={canDelete ? setMessageToDelete : undefined}
                      reactions={message.reactions}
                      retrying={retryingId === String(message.id)}
                      grouped={grouped}
                    />
                  </Fragment>
                )
              })}
            </div>

            {replyTo && <div className="reply-context"><Icon name="reply" size={14} /><span>{messageText(replyTo) || 'Attachment'}</span><button type="button" className="icon-button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><Icon name="close" size={14} /></button></div>}
            <ChatComposer
              draft={draft}
              onDraftChange={setDraft}
              onSend={send}
              sending={sending}
              file={selectedFile}
              onFileSelect={setSelectedFile}
              onFileRemove={() => setSelectedFile(null)}
              uploadProgress={uploadProgress}
              quickReplies={quickReplies}
              conversationId={selectedId}
              readOnly={readOnly}
              windowOpen={windowOpen}
              onSendInteractive={sendInteractive}
              onSendTemplate={sendTemplate}
            />
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
      <ConfirmDialog
        open={Boolean(messageToDelete)}
        title="Delete this message from the CRM?"
        message="This permanently removes the message from this CRM only. It will remain in WhatsApp."
        confirmLabel="Delete message"
        busy={deletingMessage}
        onConfirm={confirmDeleteMessage}
        onCancel={() => setMessageToDelete(null)}
      />
      <ConfirmDialog
        open={deleteConversationOpen}
        title="Delete this chat from the CRM?"
        message="This permanently removes the conversation, its CRM messages, notes, and mirrored media. The contact remains, and nothing is deleted from WhatsApp."
        confirmLabel="Delete chat"
        busy={deletingConversation}
        onConfirm={confirmDeleteConversation}
        onCancel={() => setDeleteConversationOpen(false)}
      />
    </div>
  )
}
