import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import api, { csrf, fetchSession } from '../api/client'

const AuthContext = createContext(null)

function normalizeUser(u) {
  if (!u) return null
  return { ...u, name: u.name || u.full_name || '' }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const { data } = await fetchSession()
      setUser(normalizeUser(data.user || data))
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const handleUnauthorized = () => setUser(null)
    window.addEventListener('wacrm:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('wacrm:unauthorized', handleUnauthorized)
  }, [])

  const login = async (payload) => {
    await csrf()
    await api.post('/api/login', payload)
    const { data } = await api.get('/api/user')
    const authenticatedUser = normalizeUser(data.user || data)
    if (!authenticatedUser) throw new Error('Sign-in succeeded, but the session could not be verified. Please try again.')
    setUser(authenticatedUser)
    return data
  }


  const logout = async () => {
    try { await api.post('/api/logout') } catch {}
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
