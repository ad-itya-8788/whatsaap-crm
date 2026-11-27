// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import api, { startPrivateSession, stopPrivateSession } from './client.js'

afterEach(stopPrivateSession)

it('blocks private requests as a guest and cancels pending work during sign-out', async () => {
  const adapter = vi.fn((config) => new Promise((resolve, reject) => {
    config.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))

  await expect(api.get('/api/app/presence', { adapter })).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  expect(adapter).not.toHaveBeenCalled()

  startPrivateSession()
  const request = api.get('/api/app/presence', { adapter })
  const canceled = expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1))
  stopPrivateSession()
  await canceled

  await expect(api.get('/api/app/conversations', { adapter })).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  expect(adapter).toHaveBeenCalledTimes(1)
})

it('closes the session after a private 401 and leaves public requests available', async () => {
  startPrivateSession()
  const expired = vi.fn((config) => Promise.reject({ config, response: { status: 401 } }))
  const unauthorized = vi.fn()
  window.addEventListener('wacrm:unauthorized', unauthorized, { once: true })
  await expect(api.get('/session/user', { adapter: expired })).rejects.toMatchObject({ response: { status: 401 } })
  expect(unauthorized).toHaveBeenCalledTimes(1)
  await expect(api.get('/api/app/notifications/unread-count', { adapter: expired })).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  expect(expired).toHaveBeenCalledTimes(1)

  const publicRequest = vi.fn(() => Promise.resolve({ data: {} }))
  await expect(api.post('/api/login', {}, { adapter: publicRequest })).resolves.toMatchObject({ data: {} })
})

it('keeps the browser signed in when a module returns 401 but the web session is valid', async () => {
  startPrivateSession()
  const original = api.defaults.adapter
  const adapter = vi.fn((config) => config.url === '/session/user'
    ? Promise.resolve({ data: { user: { id: 1 } } })
    : Promise.reject({ config, response: { status: 401 } }))
  api.defaults.adapter = adapter
  try {
    await expect(api.get('/api/app/inbox/unread-count')).rejects.toMatchObject({ response: { status: 401 } })
    expect(adapter.mock.calls.map(([config]) => config.url)).toEqual(['/api/app/inbox/unread-count', '/session/user'])
    await expect(api.get('/session/user')).resolves.toMatchObject({ data: { user: { id: 1 } } })
  } finally {
    api.defaults.adapter = original
  }
})
