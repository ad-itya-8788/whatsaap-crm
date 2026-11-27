import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp, MessageCircle, UserRoundPlus } from 'lucide-react'
import '../styles/inbox.css'
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
import ChatActivity from '../components/chat/ChatActivity.jsx'
import useConversationActivity from '../components/chat/useConversationActivity.js'
import { fileType, hasWhatsApp, isIncoming, mediaItem, messageText } from '../components/chat/chatUtils.js'
import { subscribeToRealtime } from '../lib/realtime.js'
import { conversationMatchesFilters, mergeConversations, mergeMessageList, messagePreview, removeConversations, removeMessages } from '../lib/realtimeChat.js'

function messageDate(message) {
  const value = message?.provider_timestamp || message?.created_at
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toDateString() : ''
}

function chronological(messages) {
  return [...messages].sort((left, right) => Number(left.id) - Number(right.id))
}

function formatInboxDate(value) {
  return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''
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
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [noteEditorOpen, setNoteEditorOpen] = useState(false)
  const [header, setHeader] = useState(null)
  const inboxRef = useRef(null)
  const [notesLoading, setNotesLoading] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [deleteNoteId, setDeleteNoteId] = useState(null)
  const [deletingNote, setDeletingNote] = useState(false)
  const [messageToDelete, setMessageToDelete] = useState(null)
  const [deletingMessage, setDeletingMessage] = useState(false)
  const [conversationToDelete, setConversationToDelete] = useState(null)
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
  const { receive: receiveActivity, notifyTyping, thinking, typists } = useConversationActivity(selectedId, realtimeConnected)

  const realtimeConnectedRef = useRef(false)
  const hasConnectedRef = useRef(false)
  const threadRef = useRef(null)
  const threadMoreRef = useRef(null)
  const listAbortRef = useRef(null)
  const threadAbortRef = useRef(null)
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
  const readOnly = false
  const canDelete = true
  const windowOpen = Date.now() - Date.parse(selected?.last_inbound_at) < 24 * 60 * 60 * 1000
  const contactTags = selected?.contact?.tags || []

  const mediaItems = useMemo(() => messages.map(mediaItem).filter(Boolean), [messages])

  const loadConversations = useCallback(async (page = 1, append = false, background = false) => {
    if (listAbortRef.current && background) return
    listAbortRef.current?.abort()
    const controller = new AbortController()
    listAbortRef.current = controller
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

      const batch = chronological(extractList(data))
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
          window.dispatchEvent(new Event('wacrm:inbox-changed'))
          if (!realtimeConnectedRef.current) {
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
        setLoadingMessages(false)
        setLoadingOlder(false)
      }
    }
  }, [debouncedMessageSearch, toast])

  const applyMessages = useCallback((incoming, existingOnly = false) => {
    const rows = Array.isArray(incoming) ? incoming : [incoming]
    const conversationId = rows[0]?.conversation_id
    if (!rows.length || (conversationId && String(conversationId) !== String(selectedIdRef.current))) return

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

  const failOptimisticMessage = (id) => {
    setMessages((current) => current.map((message) => message.id === id ? { ...message, status: 'failed' } : message))
  }

  const removeMessageItems = useCallback((ids) => {
    setMessages((current) => removeMessages(current, ids))
  }, [])

  const removeConversationItems = useCallback((ids) => {
    const removed = Array.isArray(ids) ? ids : [ids]
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
      || document.visibilityState !== 'visible' || readOnly || readRequestRef.current) return
    readRequestRef.current = window.setTimeout(() => {
      readRequestRef.current = null
      if (String(conversation.id) !== selectedIdRef.current || document.visibilityState !== 'visible') return
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

  useLayoutEffect(() => {
    setHeader(inboxRef.current?.closest('.app-main')?.querySelector('.topbar-start') ?? null)
  }, [])

  useEffect(() => {
    messagesConversationRef.current = selectedId
    scrollRestoreRef.current = null
    scrollToBottomRef.current = true
    setMessages([])
    setSelectedFile(null)
    setReplyTo(null)
    setMessageCursor({ next: null, hasMore: false })
    setSidePanel('')
    setTagPickerOpen(false)
    setNoteEditorOpen(false)
    setNotes([])
    setNotesLoading(false)
    setNoteDraft('')
    setMediaViewer(null)
    setThreadSearchOpen(false)
  }, [selectedId])

  useEffect(() => {
    if (!selectedId) return
    const timer = window.setTimeout(() => {
      loadMessages(selectedId, { markRead: !readOnly && !debouncedMessageSearch })
    }, 0)
    return () => {
      window.clearTimeout(timer)
      threadAbortRef.current?.abort()
      threadAbortRef.current = null
    }
  }, [debouncedMessageSearch, loadMessages, readOnly, selectedId])

  useEffect(() => {
    if (!selectedId || (sidePanel !== 'notes' && sidePanel !== 'info' && !selected?.notes_count)) return
    const controller = new AbortController()
    loadNotes(selectedId, controller.signal)
    return () => controller.abort()
  }, [sidePanel, selectedId, selected?.notes_count, loadNotes])

  useEffect(() => subscribeToRealtime({
    activityUserId: user?.id,
    onConversationActivity: receiveActivity,
    onConnectionChange: (ready) => {
      if (ready) hasConnectedRef.current = true
      realtimeConnectedRef.current = ready
      setRealtimeConnected(ready)
    },
    onMessageCreated: (payload) => {
      if (!payload?.message) return void recoverRealtime()
      if (payload?.message) applyMessages(payload.message)
      if (payload?.conversation) {
        applyConversations(payload.conversation)
        if (payload.message?.sender_type === 'customer') markIncomingRead(payload.conversation)
      }
      if (payload.message?.sender_type !== 'customer') return
      window.dispatchEvent(new Event('wacrm:inbox-changed'))
    },
    onMessageUpdated: (payload) => {
      if (!payload?.message) return void recoverRealtime()
      if (payload?.message) applyMessages(payload.message, true)
    },
    onMessageStatusChanged: (payload) => {
      if (!payload?.message) return void recoverRealtime()
      if (payload?.message) applyMessages(payload.message, true)
    },
    onMessageDeleted: (payload) => {
      if (!payload?.message_id && !payload?.messageId) {
        if (selectedIdRef.current) void loadMessages(selectedIdRef.current)
        return
      }
      if (payload?.message_id || payload?.messageId) removeMessageItems(payload.message_id || payload.messageId)
      if (payload?.conversation) applyConversations(payload.conversation)
    },
    onConversationUpdated: (payload) => {
      if (!payload?.conversation) {
        void loadConversations(1, false, true)
        if (selectedIdRef.current) {
          const id = selectedIdRef.current
          api.get(`/api/app/conversations/${id}`).catch((error) => {
            if (error.response?.status === 404) removeConversationItems(id)
          })
        }
        return
      }
      if (payload?.conversation) applyConversations(payload.conversation)
      window.dispatchEvent(new Event('wacrm:inbox-changed'))
    },
    onConversationDeleted: (payload) => {
      if (!payload?.conversation_id && !payload?.conversationId) {
        void loadConversations(1, false, true)
        if (selectedIdRef.current) {
          const id = selectedIdRef.current
          api.get(`/api/app/conversations/${id}`).catch((error) => {
            if (error.response?.status === 404) removeConversationItems(id)
          })
        }
        return
      }
      if (payload?.conversation_id || payload?.conversationId) removeConversationItems(payload.conversation_id || payload.conversationId)
      window.dispatchEvent(new Event('wacrm:inbox-changed'))
    },
    onReconnected: () => {
      void recoverRealtime()
      window.dispatchEvent(new Event('wacrm:inbox-changed'))
    },
  }), [user?.id, receiveActivity, applyConversations, applyMessages, recoverRealtime, removeConversationItems, removeMessageItems, markIncomingRead, loadConversations, loadMessages])

  useEffect(() => {
    if (realtimeConnected || !hasConnectedRef.current) return undefined
    const timer = window.setTimeout(() => toast.warning('Connection lost. Reconnecting…'), 2500)
    return () => window.clearTimeout(timer)
  }, [realtimeConnected, toast])

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

  const transferConversation = async (conversation, assigneeId) => {
    if (!conversation?.id || readOnly) return
    const conversationId = conversation.id
    const agent = agents.find((item) => String(item.id) === String(assigneeId))
    setBusyAction('transfer')
    try {
      const { data } = await api.patch(`/api/app/conversations/${conversationId}/assign`, { assignee_id: assigneeId })
      const receiverId = data.assigned_agent_id ?? assigneeId
      const canStillSee = user?.role === 'owner' || String(receiverId) === String(user?.id)
      if (!canStillSee) {
        setConversations((items) => items.filter((item) => String(item.id) !== String(conversationId)))
        if (String(conversationId) === String(selectedIdRef.current)) {
          setLinkedConversation(null)
          setSelectedId('')
          setMessages([])
          setMessageCursor({ next: null, hasMore: false })
          setReplyTo(null)
          setSidePanel('')
          setMobileView('list')
          setParams((current) => {
            const next = new URLSearchParams(current)
            next.delete('conversation')
            next.delete('c')
            return next
          }, { replace: true })
        }
      } else {
        setConversations((items) => items.map((item) => String(item.id) === String(conversationId)
          ? { ...item, ...data, contact: item.contact, notes_count: item.notes_count, assignedAgent: data.assignedAgent || agent || null }
          : item))
        if (String(conversationId) === String(linkedConversation?.id)) {
          setLinkedConversation((current) => current ? { ...current, ...data, assignedAgent: data.assignedAgent || agent || null } : current)
        }
      }
      toast.success(`Conversation assigned to ${data.assignedAgent?.name || agent?.name || 'a teammate'}.`)
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to transfer the conversation.'))
    } finally {
      setBusyAction('')
    }
  }

  const changeAssignee = (value) => {
    const assigneeId = value === 'unassigned' ? null : value === 'me' ? user?.id ?? null : value
    transferConversation(selected, assigneeId)
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

  const openDeleteConversation = (conversation = selected) => {
    if (!conversation?.id || readOnly) return
    setMoreOpen(false)
    setConversationToDelete(conversation)
  }

  const confirmDeleteConversation = async () => {
    const conversationId = conversationToDelete?.id
    if (!conversationId) return
    const wasSelected = String(conversationId) === String(selectedIdRef.current)
    setDeletingConversation(true)
    try {
      await api.delete(`/api/app/conversations/${conversationId}`)
      setConversations((items) => items.filter((item) => String(item.id) !== String(conversationId)))
      setConversationToDelete(null)
      if (wasSelected) {
        setLinkedConversation(null)
        setSelectedId('')
        setMessages([])
        setMessageCursor({ next: null, hasMore: false })
        setReplyTo(null)
        setSidePanel('')
        setMobileView('list')
        setParams((current) => {
          const next = new URLSearchParams(current)
          next.delete('conversation')
          next.delete('c')
          return next
        }, { replace: true })
      }
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
      const { data } = await api.put(`/api/app/conversations/${selected.id}/tags`, { tags: nextIds })
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
      setDraft('')
      setSelectedFile(null)
      setReplyTo(null)
      setUploadProgress(100)
      if (saved?.status !== 'failed') toast.success('Message sent successfully.')
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
      else failOptimisticMessage(optimistic.id)
      sendAttemptRef.current = null
      const message = errorMessage(requestError, 'Unable to send message. Please try again.')
      setThreadError(message)
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
    if (message?.media_url) {
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
      else failOptimisticMessage(optimistic.id)
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
      if (data?.status !== 'failed') toast.success('Message sent successfully.')
      return true
    } catch (requestError) {
      const failed = requestError.response?.data?.data
      if (failed?.id) applyMessages([failed])
      else failOptimisticMessage(optimistic.id)
      if (failed?.status === 'failed') richSendAttemptRef.current = null
      toast.error(errorMessage(requestError, 'Unable to send message. Please try again.'))
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

  const activePanel = sidePanel || 'info'
  const assigneeSelect = selected && (
    <select
      aria-label="Assigned to"
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
  )
  const activity = [
    { label: 'Conversation started', at: selected?.created_at },
    { label: 'Customer message received', at: selected?.last_inbound_at },
    { label: 'Last reply sent', at: selected?.last_reply_at },
  ].filter(({ at }) => at).sort((a, b) => new Date(b.at) - new Date(a.at))
  const noteCards = notesLoading ? <p role="status" className="muted">Loading notes…</p> : notes.slice(0, activePanel === 'info' ? 2 : notes.length).map((note) => (
    <article className="note-item" key={note.id}>
      <Icon name="note" size={16} />
      <div>
        <div className="note-body">{note.body ?? note.note ?? note.content ?? ''}</div>
        <div className="note-meta">{formatInboxDate(note.created_at)} · {note.user?.name || note.author?.name || 'Team'}</div>
      </div>
      {!readOnly && (user?.id === note.user_id || user?.role === 'owner') && <button type="button" className="icon-button is-danger" onClick={() => setDeleteNoteId(note.id)} aria-label="Delete note" title="Delete note"><Icon name="trash" size={14} /></button>}
    </article>
  ))

  return (
    <div ref={inboxRef} className={`chats-shell inbox-workspace${selected ? ' has-contact' : ''}${mobileView === 'thread' ? ' is-thread' : ''}`}>
      {header && createPortal(
        <div className="inbox-heading">
          <MessageCircle size={30} strokeWidth={1.8} aria-hidden="true" />
          <div><h1>Inbox</h1><p>Manage your customer conversations in real time.</p></div>
          <details className="inbox-help">
            <summary className="icon-button" aria-label="Inbox help" title="Inbox help"><CircleHelp size={19} aria-hidden="true" /></summary>
            <div>Use the filters to find conversations. Press Enter to send a message or Shift + Enter to start a new line.</div>
          </details>
        </div>, header,
      )}
      <ConversationList
        total={pagination.total}
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
        canDeleteConversations={canDelete}
        onDeleteConversation={openDeleteConversation}
        onTransferConversation={transferConversation}
      />

      <section className="chat-thread" aria-label="Conversation">
        {selected ? (
          <>
            <header className={`thread-head${threadSearchOpen ? ' is-search-open' : ''}`}>
              <button type="button" className="icon-button thread-back" onClick={backToList} aria-label="Back to conversations" title="Back to conversations"><Icon name="back" size={20} /></button>
              <ChatAvatar contact={selected.contact} name={selectedName} channel={hasWhatsApp(selected)} />
              <div className="thread-head-info">
                <div className="thread-title">{selectedName}</div>
                <div className="thread-subtitle">
                  {selected.contact?.phone || 'No phone number'}
                  {selected.assignedAgent && presence[selected.assignedAgent.id] && <span className="inbox-presence" title={selected.assignedAgent.name}><PresenceDot member={presence[selected.assignedAgent.id]} />Agent {presenceStatus(presence[selected.assignedAgent.id])}</span>}
                </div>
              </div>
              <div className="inbox-thread-actions">
                <button type="button" className="icon-button" aria-label="Manage tags" title="Manage tags" onClick={() => { setSidePanel('info'); setTagPickerOpen(true) }}><Icon name="tag" size={17} /></button>
                <button type="button" className="icon-button" aria-label="Assign conversation" title="Assign conversation" onClick={() => { setMoreOpen(true); requestAnimationFrame(() => threadMoreRef.current?.querySelector('[aria-label="Assigned to"]')?.focus()) }}><UserRoundPlus size={17} strokeWidth={1.8} aria-hidden="true" /></button>
                <button type="button" className="icon-button" aria-label="Change conversation status" title="Change conversation status" onClick={() => { setMoreOpen(true); requestAnimationFrame(() => threadMoreRef.current?.querySelector('[aria-label="Conversation status"]')?.focus()) }}><Icon name="checkCircle" size={17} /></button>
              </div>
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
                <button type="button" className="icon-button" onClick={() => setMoreOpen((value) => !value)} aria-label="More actions" title="More actions" aria-expanded={moreOpen}><Icon name="moreVertical" size={20} /></button>
                {moreOpen && (
                  <div className="thread-more-menu">
                    <button type="button" onClick={() => { setThreadSearchOpen((value) => !value); setMoreOpen(false) }}><Icon name="search" size={14} /> Search in chat</button>
                    <button type="button" onClick={() => { setSidePanel('info'); setMoreOpen(false) }}><Icon name="contacts" size={14} /> Contact info</button>
                    <button type="button" onClick={() => { setSidePanel('notes'); setMoreOpen(false) }}><Icon name="note" size={14} /> Notes{Number(selected.notes_count || 0) > 0 ? ` (${selected.notes_count})` : ''}</button>
                    <label className="thread-menu-field">
                      <span>Status</span>
                      <select
                        className="select select-sm"
                        aria-label="Conversation status"
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
                      <span>Transfer to</span>
                      {assigneeSelect}
                    </label>
                    <button type="button" onClick={copyPhone}><Icon name="copy" size={14} /> Copy phone number</button>
                    <button type="button" onClick={refreshConversation}><Icon name="sync" size={14} /> Refresh conversation</button>
                    {canDelete && <button type="button" onClick={() => openDeleteConversation(selected)}><Icon name="trash" size={14} /> Delete chat from CRM</button>}
                  </div>
                )}
              </div>
            </header>

            <AiThreadBanner conversation={selected} readOnly={readOnly} onChange={(data) => {
              setConversations((items) => items.map((item) => item.id === data.id ? { ...item, ...data } : item))
            }} />

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
                  <Fragment key={message.idempotency_key || message.id || index}>
                    {currentDate && currentDate !== previousDate && <div className="message-date">{currentDate === new Date().toDateString() ? 'Today' : formatDate(message.provider_timestamp || message.created_at)}</div>}
                    {unreadSeparatorIndex === index && <div className="unread-separator"><span>New messages</span></div>}
                    {replyTo?.id === message.id && <div className="reply-banner"><span>Replying to {incoming ? 'contact' : 'you'}</span><button type="button" className="icon-button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" title="Cancel reply"><Icon name="close" size={14} /></button></div>}
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

            {typists.length > 0 && <ChatActivity>{typists.length === 1 ? `${typists[0]} is typing` : `${typists.length} teammates are typing`}</ChatActivity>}
            {thinking && <ChatActivity ai>AI assistant is thinking</ChatActivity>}
            {replyTo && <div className="reply-context"><Icon name="reply" size={14} /><span>{messageText(replyTo) || 'Attachment'}</span><button type="button" className="icon-button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" title="Cancel reply"><Icon name="close" size={14} /></button></div>}
            <ChatComposer
              draft={draft}
              onDraftChange={setDraft}
              onTyping={notifyTyping}
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

      {selected && (
        <aside className={`thread-side-panel${sidePanel ? ' is-open' : ''}`} aria-label="Conversation details">
          <div className="side-panel-tabs" role="group" aria-label="Conversation details sections">
            {[['info', 'user', 'Contact Details'], ['notes', 'note', 'Notes'], ['activity', 'clock', 'Activity']].map(([tab, icon, label]) => (
              <button key={tab} type="button" className={activePanel === tab ? 'is-active' : ''} aria-pressed={activePanel === tab} onClick={() => setSidePanel(tab)}><Icon name={icon} size={16} /> {label}</button>
            ))}
            <button type="button" className="icon-button inbox-panel-close" onClick={() => setSidePanel('')} aria-label="Close details" title="Close details"><Icon name="close" size={16} /></button>
          </div>
          <div className="side-panel-body">
            {activePanel === 'info' && (
              <>
                <div className="contact-detail-card">
                  <ChatAvatar contact={selected.contact} name={selectedName} className="avatar-lg" channel={hasWhatsApp(selected)} />
                  <div>
                    <strong>{selectedName}</strong>
                    <div className="inbox-contact-phone">{selected.contact?.phone || 'No phone number'}{selected.contact?.phone && <button type="button" className="icon-button" aria-label="Copy phone number" title="Copy phone number" onClick={copyPhone}><Icon name="copy" size={14} /></button>}</div>
                  </div>
                  <details className="inbox-list-filters inbox-contact-menu">
                    <summary className="icon-button" aria-label="Contact actions" title="Contact actions"><Icon name="moreVertical" size={17} /></summary>
                    <div className="inbox-filter-menu" onClick={(event) => { if (event.target.closest('button')) event.currentTarget.parentElement.open = false }}>
                      <button type="button" className="button button-sm button-secondary" onClick={refreshConversation}><Icon name="refresh" size={15} /> Refresh conversation</button>
                      <button type="button" className="button button-sm button-secondary" onClick={() => setSidePanel('notes')}><Icon name="note" size={15} /> View all notes</button>
                    </div>
                  </details>
                </div>
                <dl className="contact-detail-list">
                  <div><dt><Icon name="user" size={15} /> Status</dt><dd><span className={`conversation-status status-${selected.status || 'open'}`}>{selected.status || 'open'}</span></dd></div>
                  <div><dt><Icon name="users" size={15} /> Assigned to</dt><dd>{assigneeSelect}</dd></div>
                  {hasWhatsApp(selected) && <div><dt><Icon name="whatsapp" size={15} /> Source</dt><dd>WhatsApp</dd></div>}
                  {selected.contact?.created_at && <div><dt><Icon name="clock" size={15} /> Created</dt><dd>{formatInboxDate(selected.contact.created_at)}</dd></div>}
                </dl>
                <section className="inbox-detail-section">
                  <h3><Icon name="tag" size={17} /> Tags</h3>
                  <div className="tag-picker">
                    {selectedTagIds.map((id) => {
                      const tag = tags.find((item) => Number(item.id) === id) || selected.contact?.tags?.find((item) => Number(item.id) === id)
                      if (!tag) return null
                      return <button type="button" key={id} className="tag-chip is-selected" style={{ '--tag-color': tag.color || '#3177ba' }} onClick={() => toggleTag(id)} disabled={readOnly} aria-label={`Remove tag ${tag.name}`}>{tag.name} <Icon name="close" size={12} /></button>
                    })}
                    {!readOnly && <button type="button" className="button button-sm button-secondary" aria-expanded={tagPickerOpen} onClick={() => setTagPickerOpen((open) => !open)}><Icon name="plus" size={14} /> Add Tag</button>}
                  </div>
                  {tagPickerOpen && <div className="tag-picker inbox-tag-options">
                    {tags.filter((tag) => !selectedTagIds.includes(Number(tag.id))).map((tag) => <button type="button" key={tag.id} className="button button-sm button-secondary" onClick={() => { toggleTag(tag.id); setTagPickerOpen(false) }}>{tag.name}</button>)}
                    {tags.every((tag) => selectedTagIds.includes(Number(tag.id))) && <span className="muted">No available tags.</span>}
                  </div>}
                </section>
              </>
            )}
            {activePanel !== 'activity' && (
              <section className="inbox-detail-section">
                <div className="inbox-section-head">
                  <h3><Icon name="note" size={17} /> Notes</h3>
                  {!readOnly && <button type="button" className="button button-sm button-secondary" aria-expanded={noteEditorOpen} onClick={() => setNoteEditorOpen((open) => !open)}><Icon name="plus" size={14} /> Add Note</button>}
                </div>
                {noteCards}
                {!notesLoading && !notes.length && <p className="muted">No notes yet.</p>}
                {noteEditorOpen && !readOnly && <form className="notes-compose" onSubmit={addNote}>
                  <textarea className="textarea" rows="2" aria-label="New note" placeholder="Write a note…" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} />
                  <button type="submit" className="button button-sm button-primary" disabled={savingNote || !noteDraft.trim()}>{savingNote ? 'Adding…' : 'Save note'}</button>
                </form>}
              </section>
            )}
            {activePanel !== 'notes' && (
              <section className="inbox-detail-section">
                <h3><Icon name="clock" size={17} /> Recent Activity</h3>
                {activity.length ? <ol className="inbox-timeline">{activity.map(({ label, at }) => <li key={label}><strong>{label}</strong><time dateTime={at}>{formatInboxDate(at)}</time></li>)}</ol> : <p className="muted">No activity available.</p>}
              </section>
            )}
          </div>
        </aside>
      )}

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
        title="Delete this message from Ping?"
        message="This permanently removes the message from this CRM only. It will remain in WhatsApp."
        confirmLabel="Delete message"
        busy={deletingMessage}
        onConfirm={confirmDeleteMessage}
        onCancel={() => setMessageToDelete(null)}
      />
      <ConfirmDialog
        open={Boolean(conversationToDelete)}
        title="Delete this chat from Ping?"
        message="This permanently removes the conversation, its CRM messages, notes, and mirrored media. The contact remains, and nothing is deleted from WhatsApp."
        confirmLabel="Delete chat"
        busy={deletingConversation}
        onConfirm={confirmDeleteConversation}
        onCancel={() => setConversationToDelete(null)}
      />
    </div>
  )
}
