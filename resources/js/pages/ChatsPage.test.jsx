// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ChatsPage from './ChatsPage.jsx'

const { api, toast, realtime } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  realtime: { handlers: null, setParams: vi.fn() },
}))
vi.mock('../api/client.js', () => ({ default: api }))
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 3, role: 'owner' } }) }))
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

it('renders socket messages and optimistic sends, then applies receipts without refetching history or showing success toasts', async () => {
  const now = new Date().toISOString()
  const conversation = { id: 1, contact: { name: 'Customer' }, last_inbound_at: now, unread_count: 0 }
  api.get.mockImplementation(async (url) => ({
    data: { data: url === '/api/app/conversations' ? [conversation] : [] },
  }))
  let completeSend
  api.post.mockImplementation(() => new Promise((resolve) => { completeSend = resolve }))

  render(<ChatsPage />)
  const thread = await screen.findByRole('region', { name: 'Conversation' })
  const composer = await within(thread).findByRole('textbox', { name: 'Message' })
  await within(thread).findByText('No messages yet. Send the first message below.')
  const requests = api.get.mock.calls.length

  await act(async () => realtime.handlers.onMessageCreated({
    message: { id: 1, conversation_id: 1, sender_type: 'customer', content_text: 'Incoming', created_at: now },
    conversation: { ...conversation, last_message_text: 'Incoming', last_message_at: now },
  }))
  expect(within(thread).getByText('Incoming')).toBeTruthy()

  fireEvent.change(composer, { target: { value: 'Optimistic reply' } })
  fireEvent.submit(composer.closest('form'))
  expect(within(thread).getByText('Optimistic reply')).toBeTruthy()
  expect(within(thread).getByTitle('Sending')).toBeTruthy()
  expect(composer.value).toBe('')

  const outgoing = {
    id: 2, conversation_id: 1, sender_type: 'agent', content_text: 'Optimistic reply',
    created_at: now, message_id: 'wamid.reply', idempotency_key: api.post.mock.lastCall[1].idempotency_key,
  }
  await act(async () => realtime.handlers.onMessageStatusChanged({ message: { ...outgoing, status: 'delivered' } }))
  expect(within(thread).getByTitle('Delivered')).toBeTruthy()
  await act(async () => realtime.handlers.onMessageStatusChanged({ message: { ...outgoing, status: 'read' } }))
  await act(async () => completeSend({ data: { ...outgoing, status: 'sent' } }))
  expect(within(thread).getByTitle('Read')).toBeTruthy()
  expect(within(thread).getAllByText('Optimistic reply')).toHaveLength(1)
  expect(api.get).toHaveBeenCalledTimes(requests)
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()

  api.post.mockRejectedValueOnce({ response: { status: 422, data: { message: 'This message cannot be sent.' } } })
  fireEvent.change(composer, { target: { value: 'Rejected reply' } })
  await act(async () => fireEvent.submit(composer.closest('form')))
  expect(within(thread).getByTitle('Failed')).toBeTruthy()
  expect(toast.error).toHaveBeenCalledExactlyOnceWith('This message cannot be sent.')
  expect(toast.success).not.toHaveBeenCalled()
  expect(api.get).toHaveBeenCalledTimes(requests)
})
