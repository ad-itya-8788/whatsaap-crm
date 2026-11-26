import axios from 'axios'

const api = axios.create({
  withCredentials: true,
  withXSRFToken: true,
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
  headers: {
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
})

let csrfPromise = null
let privateSession = null

export function startPrivateSession() {
  privateSession ??= new AbortController()
}

export function stopPrivateSession() {
  privateSession?.abort()
  privateSession = null
}

const isPrivate = (url) => url === '/api/user' || url?.startsWith('/api/app/')

api.interceptors.request.use((config) => {
  if (!isPrivate(config.url)) return config
  if (!privateSession) throw new axios.CanceledError('No active session', config)

  const sessionSignal = privateSession.signal
  config.sessionSignal = sessionSignal
  config.signal = config.signal ? AbortSignal.any([sessionSignal, config.signal]) : sessionSignal
  if (config.method === 'get') config.timeout ||= 30000
  return config
})

export async function csrf() {
  if (!csrfPromise) {
    csrfPromise = api.get('/sanctum/csrf-cookie', { timeout: 8000 }).finally(() => { csrfPromise = null })
  }
  return csrfPromise
}

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401
      && privateSession && err.config?.sessionSignal === privateSession.signal) {
      stopPrivateSession()
      window.dispatchEvent(new Event('wacrm:unauthorized'))
    }
    return Promise.reject(err)
  }
)

export default api
