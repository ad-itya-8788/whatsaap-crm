export const BROWSER_NOTIFY_STORAGE_KEY = 'wacrm:browser-notifications'
export const LAST_MESSAGE_STORAGE_KEY = 'wacrm:browser-notifications-last-id'
export const BROWSER_NOTIFY_EVENT = 'wacrm:browser-notifications-change'

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function isEnabled() {
  return localStorage.getItem(BROWSER_NOTIFY_STORAGE_KEY) === '1'
}

export function setEnabled(enabled) {
  if (enabled) {
    localStorage.setItem(BROWSER_NOTIFY_STORAGE_KEY, '1')
  } else {
    localStorage.removeItem(BROWSER_NOTIFY_STORAGE_KEY)
    localStorage.removeItem(LAST_MESSAGE_STORAGE_KEY)
  }
  window.dispatchEvent(new Event(BROWSER_NOTIFY_EVENT))
}

export function permission() {
  return notificationsSupported() ? Notification.permission : 'unsupported'
}

export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported'
  return Notification.requestPermission()
}

export function showNotification(title, body, url) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return null

  const notification = new Notification(title, {
    body: body || 'New customer message',
    tag: url || 'wacrm-message',
    icon: '/favicon.ico',
  })

  notification.onclick = () => {
    window.focus()
    if (url) window.location.assign(url)
    notification.close()
  }

  return notification
}
