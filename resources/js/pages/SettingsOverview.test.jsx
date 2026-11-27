// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import api from '../api/client.js'
import SettingsPage from './SettingsPage.jsx'

const session = vi.hoisted(() => ({ user: null }))
vi.mock('@inertiajs/react', () => ({ Link: (props) => <a {...props} />, router: { visit: vi.fn() } }))
vi.mock('../lib/navigation.js', () => ({ useSearchParams: () => [new URLSearchParams()] }))
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => session }))
vi.mock('../components/common/ToastProvider.jsx', () => ({ useToast: () => ({}) }))
vi.mock('../lib/whatsappConfig.js', () => ({ useWhatsappConfig: () => ({ data: { status: 'connected' } }) }))
vi.mock('../api/client.js', () => ({ default: { get: vi.fn() } }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('shows real identity, API totals, and working links for an owner', async () => {
  session.user = { id: 1, name: 'Workspace Owner', email: 'owner@example.test', role: 'owner' }
  api.get.mockImplementation(async (url) => {
    if (url.includes('/users')) return { data: { total: 42, data: [{ id: 1 }] } }
    if (url.includes('/tags')) throw new Error('Offline')
    return { data: [] }
  })
  render(<SettingsPage />)

  expect(screen.getByText('Workspace Owner')).toBeTruthy()
  expect(screen.getByText('owner@example.test')).toBeTruthy()
  expect(await screen.findByText('42')).toBeTruthy()
  expect(screen.getByTitle('Count unavailable').textContent).toBe('—')
  expect(screen.getByRole('link', { name: 'Open connection settings' }).getAttribute('href')).toBe('/settings?tab=whatsapp')
  const actions = screen.getByRole('region', { name: 'Quick actions' })
  expect(within(actions).getByRole('link', { name: /Message Templates/ }).getAttribute('href')).toBe('/templates')
  expect(screen.getByRole('heading', { name: 'WhatsApp connected' })).toBeTruthy()
})

it('omits owner-only and unauthorized links and avoids their API requests', () => {
  session.user = { id: 2, name: 'Settings Member', role: 'agent', module_access: ['settings'] }
  render(<SettingsPage />)

  expect(screen.queryByRole('link', { name: 'API keys' })).toBeNull()
  expect(screen.queryByRole('link', { name: /Team members/i })).toBeNull()
  expect(screen.queryByRole('link', { name: /Templates/i })).toBeNull()
  expect(screen.getByRole('link', { name: /Manage WhatsApp/ })).toBeTruthy()
  expect(api.get).not.toHaveBeenCalled()
})
