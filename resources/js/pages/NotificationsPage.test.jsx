// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import api from '../api/client.js'
import { ToastProvider, useToast } from '../components/common/ToastProvider.jsx'
import NotificationsPage from './NotificationsPage.jsx'

vi.mock('../api/client.js', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { role: 'owner' } }) }))
vi.mock('@inertiajs/react', () => ({ Link: (props) => <a {...props} /> }))

const items = [
  { id: 1, type: 'conversation_assigned', title: 'Conversation assigned', body: 'A new conversation is ready.', created_at: new Date().toISOString(), data: { conversation_id: 12 } },
  { id: 2, type: 'broadcast_sent', title: 'Broadcast sent', body: 'Your campaign has finished.' },
]
const renderPage = () => render(<ToastProvider><NotificationsPage /></ToastProvider>)

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('marks one notification and then all remaining notifications as read', async () => {
  api.get.mockResolvedValue({ data: { data: items, current_page: 1, last_page: 1, total: 2 } })
  api.post.mockResolvedValueOnce({ data: { read_at: '2026-01-01T12:00:00Z' } }).mockResolvedValueOnce({ data: { updated: 1 } })
  const changed = vi.fn()
  window.addEventListener('wacrm:notifications-changed', changed)

  try {
    renderPage()
    const assignment = await screen.findByRole('link', { name: 'Conversation assigned' })
    expect(assignment.getAttribute('href')).toBe('/inbox?c=12')
    expect(assignment.closest('li').classList.contains('is-unread')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read: Conversation assigned' }))
    await waitFor(() => expect(assignment.closest('li').classList.contains('is-unread')).toBe(false))
    expect(api.post).toHaveBeenNthCalledWith(1, '/api/app/notifications/1/read')
    expect(screen.queryByRole('button', { name: 'Mark as read: Conversation assigned' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(await screen.findByText('All notifications marked as read.')).toBeTruthy()
    expect(api.post).toHaveBeenNthCalledWith(2, '/api/app/notifications/read-all')
    expect(screen.queryByRole('button', { name: /^Mark as read:/ })).toBeNull()
    expect(changed).toHaveBeenCalledTimes(2)
  } finally {
    window.removeEventListener('wacrm:notifications-changed', changed)
  }
})

it('offers a retry after loading fails and renders the empty state after recovery', async () => {
  api.get.mockRejectedValueOnce(new Error()).mockResolvedValueOnce({ data: { data: [] } })
  renderPage()

  expect(screen.getByRole('status').textContent).toContain('Loading notifications')
  expect((await screen.findByRole('alert')).textContent).toBe('Unable to load notifications.')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('You’re all caught up')).toBeTruthy()
})

function ToastTrigger() {
  const toast = useToast()
  return <button type="button" onClick={() => {
    toast.success('Contact created successfully.')
    toast.success('Contact created successfully.')
    toast.error('Unable to send message. Please try again.')
    toast.warning('Connection lost. Reconnecting…')
    toast.info('Conversation refreshed.')
  }}>Notify</button>
}

it('renders four typed toasts, deduplicates messages, and dismisses individual toasts', () => {
  render(<ToastProvider><ToastTrigger /></ToastProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Notify' }))
  expect(screen.getAllByText('Contact created successfully.')).toHaveLength(1)
  expect(screen.getAllByRole('status')).toHaveLength(3)
  expect(screen.getByRole('alert').textContent).toContain('Unable to send message.')
  expect(screen.getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(4)

  fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0])
  expect(screen.queryByText('Contact created successfully.')).toBeNull()
  expect(screen.getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(3)
})
