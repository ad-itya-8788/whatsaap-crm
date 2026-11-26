import { describe, expect, it } from 'vitest'
import {
  conversationMatchesFilters,
  mergeConversations,
  mergeMessageList,
  messagePreview,
  removeConversations,
  removeMessages,
  sortConversations,
} from './realtimeChat.js'

describe('realtimeChat', () => {
  it('replaces an optimistic message with the saved message using the idempotency key', () => {
    const optimistic = {
      id: 'tmp-1',
      idempotency_key: 'key-1',
      content_text: 'Hello',
      status: 'sending',
      created_at: '2026-01-01T10:00:00.000Z',
    }
    const saved = {
      ...optimistic,
      id: 42,
      status: 'sent',
      created_at: '2026-01-01T10:00:01.000Z',
    }

    const merged = mergeMessageList([optimistic], [saved])

    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe(42)
    expect(merged[0].status).toBe('sent')
  })

  it('does not duplicate messages received from polling and WebSocket', () => {
    const message = { id: 5, content_text: 'Hi', created_at: '2026-01-01T10:00:00.000Z' }
    const merged = mergeMessageList([message], [message])
    expect(merged).toHaveLength(1)
  })

  it('updates and sorts conversations by recent activity', () => {
    const older = { id: 1, last_message_at: '2026-01-01T09:00:00.000Z', unread_count: 0 }
    const newer = { id: 2, last_message_at: '2026-01-01T10:00:00.000Z', unread_count: 1 }
    const merged = mergeConversations([older, newer], [{ id: 1, unread_count: 2 }])

    expect(merged.map((item) => item.id)).toEqual([2, 1])
    expect(merged[1].unread_count).toBe(2)
    expect(merged[1].last_message_at).toBe(older.last_message_at)
  })

  it('keeps waiting conversations in oldest-inbound order', () => {
    const rows = [
      { id: 1, last_inbound_at: '2026-01-01T10:00:00.000Z' },
      { id: 2, last_inbound_at: '2026-01-01T09:00:00.000Z' },
    ]
    expect(sortConversations(rows, 'waiting').map((item) => item.id)).toEqual([2, 1])
  })

  it('removes deleted messages and conversations', () => {
    const messages = [{ id: 1 }, { id: 2 }]
    const conversations = [{ id: 3 }, { id: 4 }]
    expect(removeMessages(messages, [1]).map((item) => item.id)).toEqual([2])
    expect(removeConversations(conversations, [3]).map((item) => item.id)).toEqual([4])
  })

  it('hides realtime conversations that do not match the active inbox filters', () => {
    const conversation = {
      id: 1,
      status: 'closed',
      unread_count: 0,
      assigned_agent_id: null,
      contact: { name: 'Jane Doe', phone: '+15551234567' },
    }

    expect(conversationMatchesFilters(conversation, 'open')).toBe(false)
    expect(conversationMatchesFilters(conversation, 'closed')).toBe(true)
    expect(conversationMatchesFilters(conversation, 'all', 'unassigned')).toBe(true)
    expect(conversationMatchesFilters(conversation, 'all', 'me', '', 7)).toBe(false)
    expect(conversationMatchesFilters({ ...conversation, assigned_agent_id: 7 }, 'all', 'me', '', 7)).toBe(true)
    expect(conversationMatchesFilters(conversation, 'all', 'all', 'jane')).toBe(true)
    expect(conversationMatchesFilters(conversation, 'all', 'all', 'nomatch')).toBe(false)
  })

  it('matches waiting conversations only when the latest inbound message is unanswered', () => {
    const base = {
      id: 1,
      status: 'open',
      last_inbound_at: '2026-01-01T10:00:00.000Z',
      contact: { name: 'Jane' },
    }

    expect(conversationMatchesFilters(base, 'waiting')).toBe(true)
    expect(conversationMatchesFilters({ ...base, last_reply_at: '2026-01-01T11:00:00.000Z' }, 'waiting')).toBe(false)
  })

  it('builds a conversation preview from the available message fields', () => {
    expect(messagePreview({ content_type: 'image', filename: 'photo.jpg' })).toBe('photo.jpg')
  })
})
