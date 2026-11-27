// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ChatsPage from './ChatsPage.jsx'

const { api, toast, realtime } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  realtime: { handlers: null, setParams: vi.fn(), can: vi.fn(() => true) },
}))
vi.mock('../api/client.js', () => ({ default: api }))
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 3, role: 'owner' }, can: realtime.can }) }))
vi.mock('../components/common/ToastProvider.jsx', () => ({ useToast: () => toast }))
vi.mock('../components/common/MemberPresence.jsx', () => ({
  useMemberPresence: () => ({}),
  PresenceDot: () => null,
  presenceStatus: () => '',
}))
vi.mock('../lib/navigation.js', () => ({
  useSearchParams: () => [new URLSearchParams('c=1'), realtime.setParams],
}))
vi.mock('../lib/realtime.js', () => ({
  subscribeToRealtime: (handlers) => {
    realtime.handlers = handlers
    handlers.onConnectionChange(true)
    return () => { realtime.handlers = null }
  },
}))

afterEach(cleanup)

it('loads authorized messages after a payload-free realtime signal and renders optimistic sends', async () => {
  const now = new Date().toISOString()
  const conversation = { id: 1, contact: { name: 'Customer' }, last_inbound_at: now, unread_count: 0 }
  let messages = []
  api.get.mockImplementation(async (url) => ({
    data: url === '/api/app/conversations/1' ? conversation : {
      data: url === '/api/app/conversations' ? [conversation] : url.endsWith('/messages') ? messages : [],
    },
  }))
  let completeSend
  api.post.mockImplementation(() => new Promise((resolve) => { completeSend = resolve }))

  render(<ChatsPage />)
  const thread = await screen.findByRole('region', { name: 'Conversation' })
  const composer = await within(thread).findByRole('textbox', { name: 'Message' })
  await within(thread).findByText('No messages yet. Send the first message below.')
  messages = [{ id: 1, conversation_id: 1, sender_type: 'customer', content_text: 'Incoming', created_at: now }]
  realtime.handlers.onMessageCreated({})
  expect(await within(thread).findByText('Incoming')).toBeTruthy()

  fireEvent.change(composer, { target: { value: 'Optimistic reply' } })
  fireEvent.submit(composer.closest('form'))
  expect(within(thread).getByText('Optimistic reply')).toBeTruthy()
  expect(within(thread).getByTitle('Sending')).toBeTruthy()
  expect(composer.value).toBe('')

  const outgoing = {
    id: 2, conversation_id: 1, sender_type: 'agent', content_text: 'Optimistic reply',
    created_at: now, message_id: 'wamid.reply', idempotency_key: api.post.mock.lastCall[1].idempotency_key,
  }
  await act(async () => completeSend({ data: { ...outgoing, status: 'sent' } }))
  messages = [...messages, { ...outgoing, status: 'read' }]
  realtime.handlers.onMessageStatusChanged({})
  expect(await within(thread).findByTitle('Read')).toBeTruthy()
  expect(within(thread).getAllByText('Optimistic reply')).toHaveLength(1)
})

it('keeps message history and hides the composer for a read-only agent', async () => {
  const conversation = { id: 1, contact: { name: 'Customer' } }
  realtime.can.mockImplementation((permission) => permission === 'messages.read')
  api.get.mockImplementation(async (url) => ({
    data: url === '/api/app/conversations/1' ? conversation : {
      data: url === '/api/app/conversations' ? [conversation] : [],
    },
  }))

  render(<ChatsPage />)
  const thread = await screen.findByRole('region', { name: 'Conversation' })
  await within(thread).findByText('Customer')
  expect(within(thread).queryByRole('textbox', { name: 'Message' })).toBeNull()
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['All'])
  realtime.can.mockImplementation(() => true)
})
