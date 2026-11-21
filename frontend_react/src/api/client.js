import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
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
export async function csrf() {
  if (!csrfPromise) {
    csrfPromise = api.get('/sanctum/csrf-cookie').finally(() => { csrfPromise = null })
  }
  return csrfPromise
}

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401 && err?.config?.url?.startsWith('/api/app/')) {
      window.dispatchEvent(new Event('wacrm:unauthorized'))
    }
    return Promise.reject(err)
  }
)

export default api
