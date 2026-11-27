// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import api from '../../api/client.js'
import useConversationActivity from './useConversationActivity.js'

vi.mock('../../api/client.js', () => ({ default: { post: vi.fn().mockResolvedValue({}) } }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

it('shows only activity for the open chat and expires typing after inactivity', () => {
  vi.useFakeTimers()
  const { result, rerender } = renderHook(({ id }) => useConversationActivity(id, true), { initialProps: { id: '7' } })
  const typing = { conversation_id: 7, kind: 'typing', key: 'user:2', name: 'Aditya', active: true }
  act(() => result.current.receive({ ...typing, conversation_id: 8 }))
  expect(result.current.typists).toEqual([])
  act(() => result.current.receive(typing))
  expect(result.current.typists).toEqual(['Aditya'])
  act(() => vi.advanceTimersByTime(5500))
  expect(result.current.typists).toEqual([])
  act(() => result.current.receive(typing))
  rerender({ id: '8' })
  expect(result.current.typists).toEqual([])
})

it('clears AI activity when the corresponding request finishes', () => {
  const { result } = renderHook(() => useConversationActivity('7', true))
  const thinking = { conversation_id: 7, kind: 'thinking', key: 'ai:job', active: true }
  act(() => result.current.receive(thinking))
  expect(result.current.thinking).toBe(true)
  act(() => result.current.receive({ ...thinking, active: false }))
  expect(result.current.thinking).toBe(false)
})

it('limits typing pings and never posts the draft content', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useConversationActivity('7', true))
  result.current.notifyTyping('  ')
  result.current.notifyTyping('Private draft')
  result.current.notifyTyping('Private draft edited')
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(api.post).toHaveBeenCalledWith('/api/app/conversations/7/typing', {}, { timeout: 4500 })
  vi.advanceTimersByTime(3000)
  result.current.notifyTyping('Still typing')
  expect(api.post).toHaveBeenCalledTimes(2)
})
