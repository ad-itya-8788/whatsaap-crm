import { describe, expect, it } from 'vitest'
import { resolveOverviewConnectionStatus } from './SettingsPage.jsx'

describe('resolveOverviewConnectionStatus', () => {
  it('recognises a connected WhatsApp configuration', () => {
    expect(resolveOverviewConnectionStatus({ connection_status: 'connected' }, null)).toBe('connected')
  })

  it('uses a successful health check when saved status is stale', () => {
    expect(resolveOverviewConnectionStatus(
      { connection_status: 'disconnected' },
      { status: 'connected' },
    )).toBe('connected')
  })

  it('does not report unavailable status as disconnected', () => {
    expect(resolveOverviewConnectionStatus(null, null)).toBe('unknown')
    expect(resolveOverviewConnectionStatus({ status: 'disconnected' }, null)).toBe('disconnected')
  })
})
