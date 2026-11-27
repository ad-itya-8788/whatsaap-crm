const appearances = {
  conversation_assigned: { icon: 'users', tone: 'info' },
  message_sent: { icon: 'send', tone: 'success' },
  broadcast_sent: { icon: 'radio', tone: 'success' },
  payment_failed: { icon: 'errorCircle', tone: 'error' },
  success: { icon: 'checkCircle', tone: 'success' },
  error: { icon: 'errorCircle', tone: 'error' },
  warning: { icon: 'alert', tone: 'warning' },
}

const information = { icon: 'bell', tone: 'info' }

export function notificationAppearance(type) {
  return Object.hasOwn(appearances, type) ? appearances[type] : information
}
