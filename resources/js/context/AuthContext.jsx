import { router } from '@inertiajs/react'
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { clearWhatsappConfig } from '../lib/whatsappConfig.js'
import { subscribeToAuthorization } from '../lib/authorizationRealtime.js'
import api, { csrf, startPrivateSession, stopPrivateSession } from '../api/client'

const AuthContext = createContext(null)

function normalizeUser(u) {
  if (!u) return null
  return { ...u, name: u.name || u.full_name || '' }
}

function accessSignature(value) {
  return JSON.stringify([value?.id, value?.role, value?.permissions])
}

export function AuthProvider({ children, initialUser }) {
  const [user, setUser] = useState(() => normalizeUser(initialUser))
  const accessRef = useRef(accessSignature(initialUser))
  const setAuthenticatedUser = useCallback((value) => {
    accessRef.current = accessSignature(value)
    if (value) startPrivateSession()
    else stopPrivateSession()
    setUser(normalizeUser(value))
  }, [])

  useEffect(() => {
    const handleUnauthorized = () => {
      router.clearHistory()
      clearWhatsappConfig()
      setUser(null)
    }
    window.addEventListener('wacrm:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('wacrm:unauthorized', handleUnauthorized)
  }, [])

  const userId = user?.id
  useEffect(() => {
    if (!userId) return undefined
    const controller = new AbortController()
    let checking = false
    const refresh = async () => {
      if (checking || controller.signal.aborted) return
      checking = true
      try {
        const { data } = await api.get('/api/user', { signal: controller.signal, timeout: 8000 })
        const next = normalizeUser(data.user ?? data)
        if (controller.signal.aborted || next?.id !== userId) return
        const signature = accessSignature(next)
        if (accessRef.current !== signature) {
          accessRef.current = signature
          stopPrivateSession()
          startPrivateSession()
          router.clearHistory()
          clearWhatsappConfig()
        }
        setUser((current) => current?.id === userId && JSON.stringify(current) !== JSON.stringify(next) ? next : current)
      } catch {
        // The HTTP client handles session expiry. Network failures retry on the next refresh.
      } finally {
        checking = false
      }
    }
    const unsubscribe = subscribeToAuthorization(refresh)
    const poll = window.setInterval(refresh, 8000)
    window.addEventListener('focus', refresh)
    window.addEventListener('wacrm:authorization-changed', refresh)
    return () => {
      controller.abort()
      unsubscribe()
      window.clearInterval(poll)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('wacrm:authorization-changed', refresh)
    }
  }, [userId])

  const can = useCallback((permission) => user?.permissions?.includes(permission) ?? false, [user?.permissions])
  const canAny = (permissions) => permissions.some(can)
  const canAll = (permissions) => permissions.every(can)

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
    clearWhatsappConfig()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, can, canAny, canAll, setUser: setAuthenticatedUser, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
