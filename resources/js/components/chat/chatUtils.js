import api from '../../api/client.js'

export const incomingTypes = ['customer', 'contact']

export function isIncoming(message) {
  return incomingTypes.includes(String(message?.sender_type || '').toLowerCase())
}

export function messageText(message) {
  return message?.content_text
    || message?.message_text
    || message?.content
    || message?.template?.body_text
    || message?.template_name
    || ''
}

export function messageMediaType(message) {
  const raw = String(message?.content_type || '').toLowerCase()
  if (raw !== 'template') return raw
  const mime = String(message?.media_type || '')
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

export function messageMediaUrl(message) {
  const base = (api.defaults.baseURL || '').replace(/\/$/, '')
  return `${base}/api/app/messages/${message.id}/media`
}

export function mediaItem(message) {
  const type = messageMediaType(message)
  const externalUrl = message?.meta?.external_media_url
  const externalMedia = typeof externalUrl === 'string' && /^https:\/\//i.test(externalUrl)
  if ((!message?.media_url && !externalMedia) || !['image', 'video', 'audio', 'document', 'sticker'].includes(type)) return null
  return {
    id: String(message.id),
    type: type === 'sticker' ? 'image' : type,
    src: externalMedia ? externalUrl : messageMediaUrl(message),
    name: message.filename || `${type}-${message.id}`,
    mime: message.media_type || '',
  }
}

export function fileType(file) {
  if (String(file?.type || '').startsWith('image/')) return 'image'
  if (String(file?.type || '').startsWith('video/')) return 'video'
  if (String(file?.type || '').startsWith('audio/')) return 'audio'
  return 'document'
}

export function fileSize(size) {
  const bytes = Number(size) || 0
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function hasWhatsApp(conversation) {
  const contact = conversation?.contact || {}
  return Boolean(contact.wa_user_id || contact.wa_username)
}

export function locationFromMessage(message) {
  const meta = message?.meta
  if (typeof meta === 'string') {
    try { return locationFromMessage(JSON.parse(meta)) } catch { return null }
  }
  const location = meta?.location || meta?.message?.location || meta?.value?.location
  if (location?.latitude && location?.longitude) {
    return { lat: location.latitude, lng: location.longitude, name: location.name || '', address: location.address || '' }
  }
  return null
}
