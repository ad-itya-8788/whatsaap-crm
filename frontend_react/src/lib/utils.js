export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const data = error?.response?.data
  if (data?.errors) {
    const messages = Object.values(data.errors).flat().filter(Boolean)
    if (messages.length) return messages.join(' ')
  }
  if (typeof data?.message === 'string' && data.message.trim()) return data.message
  if (error?.message === 'Network Error') return 'Cannot reach the server. Check your connection and try again.'
  return error?.message || fallback
}

export function extractList(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.data?.data)) return payload.data.data
  return []
}

export function extractPaginator(payload) {
  const candidates = [payload?.meta, payload?.data?.meta, payload, payload?.data]
  const source = candidates.find((item) => item && typeof item === 'object' && !Array.isArray(item)) || {}
  const current = Number(source.current_page ?? 1)
  const last = Number(source.last_page ?? 1)
  const total = Number(source.total ?? 0)
  return {
    currentPage: Number.isFinite(current) && current > 0 ? current : 1,
    lastPage: Number.isFinite(last) && last > 0 ? last : 1,
    total: Number.isFinite(total) && total >= 0 ? total : 0,
  }
}

export function relativeTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString()
}

export function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function placeholders(text) {
  const found = []
  const pattern = /{{\s*([^{}]+?)\s*}}/g
  let match = pattern.exec(String(text || ''))
  while (match) {
    if (!found.includes(match[1])) found.push(match[1])
    match = pattern.exec(String(text || ''))
  }
  return found
}

export function renderTemplate(text, values) {
  return String(text || '').replace(/{{\s*([^{}]+?)\s*}}/g, (full, key) => {
    const value = values?.[key] ?? values?.[String(Number(key))]
    return value ? String(value) : full
  })
}
