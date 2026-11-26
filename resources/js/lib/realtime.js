import Echo from 'laravel-echo'
import Pusher from 'pusher-js'

let echoClient = null
let subscribers = 0

function cookieValue(name) {
  const prefix = `${name}=`
  const cookie = document.cookie.split('; ').find((item) => item.startsWith(prefix))
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : ''
}

function csrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
  return meta || cookieValue('XSRF-TOKEN')
}

function config() {
  const shared = typeof window !== 'undefined' ? window.__WACRM_REALTIME__ : null
  const source = shared || {
    key: import.meta.env.VITE_REVERB_APP_KEY,
    host: import.meta.env.VITE_REVERB_HOST,
    port: import.meta.env.VITE_REVERB_PORT,
    scheme: import.meta.env.VITE_REVERB_SCHEME,
  }
  if (shared && shared.enabled === false) return null
  if (!source.key) return null

  const host = String(source.host || window.location.hostname)
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')

  return {
    key: source.key,
    host,
    port: Number(source.port || 8080),
    scheme: source.scheme || 'http',
  }
}

function getEcho(settings) {
  if (!echoClient) {
    echoClient = new Echo({
      broadcaster: 'reverb',
      Pusher,
      key: settings.key,
      host: settings.host,
      wsHost: settings.host,
      wsPort: settings.port,
      wssPort: settings.port,
      forceTLS: settings.scheme === 'https',
      enabledTransports: ['ws', 'wss'],
      disableStats: true,
      authEndpoint: '/broadcasting/auth',
      auth: {
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-TOKEN': csrfToken(),
        },
      },
    })
  }

  return echoClient
}

export function subscribeToRealtime(handlers = {}) {
  const settings = config()
  if (!settings) {
    handlers.onConnectionChange?.(false)
    return () => {}
  }

  let echo
  try {
    echo = getEcho(settings)
  } catch {
    handlers.onConnectionChange?.(false)
    return () => {}
  }

  const channel = echo.private('account.default')
  const subscription = channel.subscription
  subscribers += 1
  const listeners = {
    'message.created': (payload) => handlers.onMessageCreated?.(payload),
    'message.updated': (payload) => handlers.onMessageUpdated?.(payload),
    'message.status': (payload) => handlers.onMessageStatusChanged?.(payload),
    'message.deleted': (payload) => handlers.onMessageDeleted?.(payload),
    'conversation.updated': (payload) => handlers.onConversationUpdated?.(payload),
    'conversation.deleted': (payload) => handlers.onConversationDeleted?.(payload),
  }

  Object.entries(listeners).forEach(([event, listener]) => channel.listen(`.${event}`, listener))

  const connection = echo.connector.pusher.connection
  const onSubscribed = () => {
    handlers.onConnectionChange?.(true)
    handlers.onReconnected?.()
  }
  const onStateChange = ({ current }) => {
    if (current !== 'connected') handlers.onConnectionChange?.(false)
  }
  const onSubscriptionError = () => handlers.onConnectionChange?.(false)

  subscription.bind('pusher:subscription_succeeded', onSubscribed)
  subscription.bind('pusher:subscription_error', onSubscriptionError)
  connection.bind('state_change', onStateChange)
  if (subscription.subscribed) onSubscribed()
  else handlers.onConnectionChange?.(false)

  return () => {
    Object.entries(listeners).forEach(([event, listener]) => channel.stopListening(`.${event}`, listener))
    subscription.unbind('pusher:subscription_succeeded', onSubscribed)
    subscription.unbind('pusher:subscription_error', onSubscriptionError)
    connection.unbind('state_change', onStateChange)
    subscribers -= 1
    if (!subscribers) {
      echo.leave('account.default')
      echo.disconnect()
      echoClient = null
    }
  }
}
