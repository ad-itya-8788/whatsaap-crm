import { describe, expect, it } from 'vitest'
import { extractList, extractPaginator, isAdmin, placeholders, renderTemplate } from './utils.js'

describe('utils', () => {
  it('extracts lists from Laravel paginator payloads', () => {
    expect(extractList({ data: [{ id: 1 }] })).toEqual([{ id: 1 }])
    expect(extractList([])).toEqual([])
  })

  it('reads pagination metadata', () => {
    expect(extractPaginator({ total: 12, current_page: 2, last_page: 3 })).toEqual({
      currentPage: 2,
      lastPage: 3,
      total: 12,
    })
  })

  it('recognises management roles', () => {
    expect(isAdmin({ role: 'owner' })).toBe(true)
    expect(isAdmin({ role: 'agent' })).toBe(false)
  })

  it('finds and renders template placeholders', () => {
    expect(placeholders('Hi {{1}}, welcome to {{ company }}')).toEqual(['1', 'company'])
    expect(renderTemplate('Hi {{1}}', { 1: 'Asha' })).toBe('Hi Asha')
  })
})
