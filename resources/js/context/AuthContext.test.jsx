// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext.jsx'

const { api, router, socket, start, stop } = vi.hoisted(() => ({
  api: { get: vi.fn() },
  router: { clearHistory: vi.fn() },
  socket: { refresh: null },
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('@inertiajs/react', () => ({ router }))
vi.mock('../api/client', () => ({ default: api, csrf: vi.fn(), startPrivateSession: start, stopPrivateSession: stop }))
vi.mock('../lib/authorizationRealtime.js', () => ({
  subscribeToAuthorization: (refresh) => {
    socket.refresh = refresh
    return () => { socket.refresh = null }
  },
}))

function WorkspaceActions() {
  const { can, canAll, canAny } = useAuth()
  return <>
    {can('inbox.view') && <a href="/inbox">Inbox</a>}
    {canAll(['contacts.view', 'contacts.export']) && <button type="button">Export</button>}
    {canAny(['account.profile', 'account.sessions']) && <a href="/settings">Settings</a>}
  </>
}

afterEach(cleanup)

it('updates active-session permissions after a socket signal without signing out', async () => {
  const member = { id: 1, name: 'Member', role: 'agent', permissions: ['inbox.view', 'contacts.view', 'contacts.export', 'account.profile'] }
  render(<AuthProvider initialUser={member}><WorkspaceActions /></AuthProvider>)

  expect(screen.getByRole('link', { name: 'Inbox' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()

  api.get.mockResolvedValue({ data: { user: { ...member, permissions: ['contacts.view', 'account.profile'] } } })
  await act(async () => socket.refresh())

  expect(screen.queryByRole('link', { name: 'Inbox' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy()
  expect(api.get).toHaveBeenCalledWith('/api/user', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(stop).toHaveBeenCalled()
  expect(start).toHaveBeenCalled()
  expect(router.clearHistory).toHaveBeenCalled()
})
