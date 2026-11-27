import { router } from '@inertiajs/react'
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import api, { csrf, startPrivateSession, stopPrivateSession } from '../api/client'

const AuthContext = createContext(null)

function normalizeUser(u) {
  if (!u) return null
  return { ...u, name: u.name || u.full_name || '' }
}

export function AuthProvider({ children, initialUser }) {
  const [user, setUser] = useState(() => normalizeUser(initialUser))
  const setAuthenticatedUser = useCallback((value) => {
    if (value) startPrivateSession()
    else stopPrivateSession()
    setUser(normalizeUser(value))
  }, [])

  useEffect(() => {
    const handleUnauthorized = () => {
      router.clearHistory()
      setUser(null)
    }
    window.addEventListener('wacrm:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('wacrm:unauthorized', handleUnauthorized)
  }, [])

  const memberId = user?.id
  const refresh = useCallback(async (signal) => {
    if (!memberId) return
    const { data } = await api.get('/session/user', { signal, timeout: 5000 })
    if (!signal?.aborted && data.user?.id === memberId) {
      setUser((current) => current?.id === memberId && JSON.stringify(current) !== JSON.stringify(data.user)
        ? normalizeUser(data.user) : current)
    }
  }, [memberId])

  useEffect(() => {
    if (!memberId) return
    const controller = new AbortController()
    const sync = () => refresh(controller.signal).catch(() => {})
    window.addEventListener('focus', sync)
    const timer = window.setInterval(sync, 5000)
    return () => {
      controller.abort()
      window.removeEventListener('focus', sync)
      window.clearInterval(timer)
    }
  }, [memberId, refresh])

  const login = async (payload) => {
    await csrf()
    const { data } = await api.post('/api/login', payload)
    if (!data?.user?.id) throw new Error('Sign-in succeeded, but the session could not be verified. Please try again.')
    setAuthenticatedUser(data.user)
    return data
  }

  const logout = async () => {
    stopPrivateSession()
    try {
      try {
        await api.post('/api/logout')
      } catch (error) {
        if (error.response?.status !== 419) throw error
        await csrf()
        await api.post('/api/logout')
      }
    } catch (error) {
      if (error.response?.status !== 401) {
        if (user) startPrivateSession()
        throw error
      }
    }
    router.clearHistory()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, setUser: setAuthenticatedUser, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
