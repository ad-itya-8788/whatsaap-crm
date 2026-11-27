// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import api from '../../api/client.js'
import { BROWSER_NOTIFY_STORAGE_KEY, LAST_MESSAGE_STORAGE_KEY } from '../../lib/browserNotifications.js'
import BrowserNotificationsListener from './BrowserNotificationsListener.jsx'

vi.mock('../../lib/navigation.js', () => ({
  usePageLocation: () => ({ pathname: '/inbox', search: '?c=15' }),
}))

vi.mock('../../api/client.js', () => ({ default: { get: vi.fn() } }))
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 42 } }) }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  localStorage.clear()
})

it('starts at the current cursor and only suppresses alerts for a visible thread', async () => {
  vi.useFakeTimers()
  localStorage.setItem(BROWSER_NOTIFY_STORAGE_KEY, '1')
  localStorage.setItem(`${LAST_MESSAGE_STORAGE_KEY}:7`, '500')
  const show = vi.fn()
  class BrowserNotification {
    static permission = 'granted'

    constructor(title, options) {
      show(title, options)
    }
  }
  vi.stubGlobal('Notification', BrowserNotification)
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const message = { conversation_id: 15, contact_name: 'Maya', content_type: 'image', body: 'A photo' }
  api.get
    .mockResolvedValueOnce({ data: { latest_id: 0, events: [] } })
    .mockResolvedValueOnce({ data: { latest_id: 1, events: [{ ...message, id: 1 }] } })
    .mockResolvedValueOnce({ data: { latest_id: 2, events: [{ ...message, id: 1 }, { ...message, id: 2 }] } })

  await act(async () => {
    render(
      <BrowserNotificationsListener />,
    )
  })

  expect(api.get).toHaveBeenNthCalledWith(1, '/api/app/notifications/browser-events', expect.objectContaining({ params: {} }))
  await act(() => vi.advanceTimersByTimeAsync(15000))
  expect(api.get).toHaveBeenNthCalledWith(2, '/api/app/notifications/browser-events', expect.objectContaining({ params: { after: 0 } }))
  expect(show).not.toHaveBeenCalled()

  visibility.mockReturnValue('hidden')
  await act(() => vi.advanceTimersByTimeAsync(15000))
  expect(show).toHaveBeenCalledExactlyOnceWith('Maya', expect.objectContaining({
    body: 'Photo · A photo',
    tag: '/inbox?c=15',
  }))
  expect(localStorage.getItem(`${LAST_MESSAGE_STORAGE_KEY}:42`)).toBe('2')
  expect(localStorage.getItem(`${LAST_MESSAGE_STORAGE_KEY}:7`)).toBe('500')
  const { signal } = api.get.mock.calls[0][1]
  cleanup()
  expect(signal.aborted).toBe(true)
})
