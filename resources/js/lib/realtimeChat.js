const waitingFilters = ['waiting', 'expiring']

function normalizeList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function messageKey(message) {
  if (message?.idempotency_key) return `key:${message.idempotency_key}`
  return `id:${String(message?.id)}`
}

function messageTime(message) {
  const value = Date.parse(message?.provider_timestamp || message?.created_at || '')
  return Number.isNaN(value) ? 0 : value
}

function numericId(value) {
  const id = Number(value)
  return Number.isFinite(id) ? id : Number.MAX_SAFE_INTEGER
}

export function sortMessages(messages) {
  return [...messages].sort((left, right) => (
    numericId(left.id) - numericId(right.id) || messageTime(left) - messageTime(right)
  ))
}

export function sortConversations(conversations, filter = 'all') {
  const waiting = waitingFilters.includes(filter)

  return [...conversations].sort((left, right) => {
    if (waiting) {
      const leftInbound = Date.parse(left.last_inbound_at || '') || 0
      const rightInbound = Date.parse(right.last_inbound_at || '') || 0
      if (leftInbound !== rightInbound) return leftInbound - rightInbound
    } else {
      const leftActivity = Date.parse(left.last_message_at || '') || 0
      const rightActivity = Date.parse(right.last_message_at || '') || 0
      if (leftActivity !== rightActivity) return rightActivity - leftActivity
    }

    const leftUpdated = Date.parse(left.updated_at || '') || 0
    const rightUpdated = Date.parse(right.updated_at || '') || 0
    if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated

    return numericId(right.id) - numericId(left.id)
  })
}

export function mergeMessageList(current, incoming) {
  const rows = normalizeList(incoming)
  if (!rows.length) return current

  const byKey = new Map(current.map((message) => [messageKey(message), message]))
  let changed = false

  rows.forEach((row) => {
    const key = messageKey(row)
    const previous = byKey.get(key)
    const merged = previous ? { ...previous, ...row } : row
    if (!previous || !sameValue(previous, merged)) changed = true
    byKey.set(key, merged)
  })

  return changed ? sortMessages([...byKey.values()]) : current
}

export function mergeConversations(current, incoming, filter = 'all') {
  const rows = normalizeList(incoming)
  if (!rows.length) return current

  const byId = new Map(current.map((conversation) => [String(conversation.id), conversation]))
  let changed = false

  rows.forEach((row) => {
    if (!row?.id) return
    const id = String(row.id)
    const previous = byId.get(id)
    const contact = row.contact && previous?.contact
      ? { ...previous.contact, ...row.contact }
      : row.contact || previous?.contact
    const merged = previous ? { ...previous, ...row, contact } : row
    if (!previous || !sameValue(previous, merged)) changed = true
    byId.set(id, merged)
  })

  return changed ? sortConversations([...byId.values()], filter) : current
}

export function removeMessages(current, ids) {
  const removed = new Set(normalizeList(ids).map((id) => String(id)))
  if (!removed.size) return current
  const next = current.filter((message) => !removed.has(String(message.id)))
  return next.length === current.length ? current : next
}

export function removeConversations(current, ids) {
  const removed = new Set(normalizeList(ids).map((id) => String(id)))
  if (!removed.size) return current
  const next = current.filter((conversation) => !removed.has(String(conversation.id)))
  return next.length === current.length ? current : next
}

export function conversationMatchesFilters(conversation, status = 'all', assignee = 'all', search = '', currentUserId = null) {
  if (!conversation?.id) return false

  const query = String(search || '').trim().toLowerCase()
  if (query) {
    const contact = conversation.contact || {}
    const haystack = [contact.name, contact.phone, contact.phone_normalized]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (!haystack.includes(query)) return false
  }

  if (status === 'unread' && !(Number(conversation.unread_count) > 0)) return false
  if (status === 'unassigned' && (conversation.status !== 'open' || conversation.assigned_agent_id)) return false
  if (['open', 'pending', 'closed'].includes(status) && conversation.status !== status) return false

  if (status === 'waiting' || status === 'expiring') {
    const lastInbound = Date.parse(conversation.last_inbound_at || '')
    const lastReply = Date.parse(conversation.last_reply_at || '')
    const waiting = ['open', 'pending'].includes(conversation.status)
      && Number.isFinite(lastInbound)
      && (!Number.isFinite(lastReply) || lastReply < lastInbound)
    if (!waiting) return false

    if (status === 'expiring') {
      const now = Date.now()
      const oldest = now - 24 * 60 * 60 * 1000
      const newest = now - 22 * 60 * 60 * 1000
      if (lastInbound < oldest || lastInbound > newest) return false
    }
  }

  if (assignee === 'me') {
    if (!currentUserId || String(conversation.assigned_agent_id) !== String(currentUserId)) return false
  } else if (assignee === 'unassigned') {
    if (conversation.assigned_agent_id) return false
  } else if (assignee !== 'all' && String(conversation.assigned_agent_id) !== String(assignee)) {
    return false
  }

  return true
}

export function messagePreview(message) {
  const value = message?.content_text
    || message?.template?.body_text
    || message?.template_name
    || message?.filename
    || message?.content_type
    || 'Message'
  return String(value).slice(0, 500)
}
