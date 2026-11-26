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
    for (const key of Object.keys(localStorage)) {
      if (key === LAST_MESSAGE_STORAGE_KEY || key.startsWith(`${LAST_MESSAGE_STORAGE_KEY}:`)) localStorage.removeItem(key)
    }
  }
  window.dispatchEvent(new Event(BROWSER_NOTIFY_EVENT))
}

export function permission() {
  return notificationsSupported() ? Notification.permission : 'unsupported'
}

let workerRegistration

function notificationWorker() {
  if (!window.isSecureContext || !navigator.serviceWorker) return null
  workerRegistration ??= navigator.serviceWorker.register('/notification-worker.js')
    .then(() => navigator.serviceWorker.ready)
    .catch(() => { workerRegistration = null; return null })
  return workerRegistration
}

export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported'
  const result = await Notification.requestPermission()
  if (result === 'granted') void notificationWorker()
  return result
}

export async function showNotification(title, body, url) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return null

  const options = { body, tag: url || 'wacrm-message', icon: '/img/logo.png', data: { url } }
  const worker = await notificationWorker()
  if (worker) {
    try {
      await worker.showNotification(title, options)
      return true
    } catch {
      // Desktop browsers can still use the window notification API.
    }
  }

  try {
    const notification = new Notification(title, options)

    notification.onclick = () => {
      window.focus()
      if (url) window.location.assign(url)
      notification.close()
    }

    return notification
  } catch {
    return null
  }
}
