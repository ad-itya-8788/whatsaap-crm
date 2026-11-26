const SAFE_CLIENT_ERRORS = new Set([
  'Network Error',
  'Request aborted',
])

const GENERIC_PROVIDER_MESSAGE = 'Message could not be delivered.'
const PROVIDER_ERROR_MESSAGES = new Map([
  ['132001', 'Template unavailable for the selected WhatsApp account.'],
  ['131037', 'WhatsApp display name approval required.'],
])
const PROVIDER_CODE_PATTERN = /(?:^|\D)#?(\d{4,8})(?:\D|$)/g
const RAW_PROVIDER_ERROR_PATTERN = /\(?#\d{4,8}\)?|\b(?:whatsapp|meta|facebook|graph\s+api|provider)\b|\btemplate\b|\bdisplay\s+name\b|\b(?:send|delivery)\s+failed\b|\bdoes\s+(?:not|n't)\s+exist\b|\bunavailable\b|\bapproval\b|\brejected\b|\binvalid\s+(?:parameter|template|recipient)\b|\bapi\b/i

function providerCodes(...values) {
  const codes = []
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value)
    const direct = text.trim()
    if (/^\d+$/.test(direct) && !codes.includes(direct)) codes.push(direct)
    for (const match of text.matchAll(PROVIDER_CODE_PATTERN)) {
      if (!codes.includes(match[1])) codes.push(match[1])
    }
  }
  return codes
}

function looksLikeRawProviderError(value) {
  return RAW_PROVIDER_ERROR_PATTERN.test(String(value ?? ''))
}

export function friendlyProviderMessage(code, title) {
  const codes = providerCodes(code, title)
  const known = codes.find((item) => PROVIDER_ERROR_MESSAGES.has(item))
  if (known) return PROVIDER_ERROR_MESSAGES.get(known)
  if (codes.length && looksLikeRawProviderError(title ?? code)) return GENERIC_PROVIDER_MESSAGE
  return null
}

function providerMessageFromData(data) {
  const rawMessage = typeof data?.message === 'string' ? data.message : ''
  return friendlyProviderMessage(
    data?.error_code ?? data?.code ?? data?.provider_code ?? rawMessage,
    rawMessage || data?.title || data?.error_title,
  )
}

function isSafeMessage(message) {
  if (typeof message !== 'string' || !message.trim()) return false
  if (message.length > 300) return false
  return !/\b(select\s+|insert\s+into|update\s+\w+\s+set|delete\s+from|sqlstate|pdoexception|stack\s*trace|vendor[\\/]|\.php:\d+)\b/i.test(message)
}

export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const data = error?.response?.data
  const providerMessage = providerMessageFromData(data)
  if (providerMessage) return providerMessage
  if (data?.errors) {
    const entries = Object.values(data.errors).flat()
    for (const entry of entries) {
      const raw = typeof entry === 'string' ? entry : String(entry?.message ?? entry?.title ?? '')
      const friendly = friendlyProviderMessage(entry?.code ?? entry?.error_code ?? entry?.provider_code ?? raw, raw)
      if (friendly) return friendly
    }
    const messages = entries.filter(isSafeMessage)
    if (messages.length) return messages.join(' ')
  }
  if (isSafeMessage(data?.message)) return data.message.trim()
  if (SAFE_CLIENT_ERRORS.has(error?.message) || /^timeout of \d+ms exceeded$/.test(error?.message || '')) {
    return 'Cannot reach the server. Check your connection and try again.'
  }
  return fallback
}

export function isAdmin(user) {
  return ['admin', 'owner'].includes(String(user?.role || '').toLowerCase())
}

export function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()

  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
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

export function formatDuration(seconds) {
  const total = Number.isFinite(Number(seconds)) ? Math.max(0, Math.floor(Number(seconds))) : 0
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

export function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
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
