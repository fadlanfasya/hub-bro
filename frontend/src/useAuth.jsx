import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { auth } from './api'

/**
 * Current user + capability checks.
 *
 * The UI hides what a role can't do, but that's only cosmetic — every rule is
 * enforced by the backend as well. `can()` reads the capability list the server
 * sends, so the two never drift apart.
 */
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!localStorage.getItem('token')) {
      setUser(null)
      setLoading(false)
      return null
    }
    try {
      const res = await auth.me()
      setUser(res.data)
      return res.data
    } catch {
      localStorage.removeItem('token')
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const logout = useCallback(() => {
    localStorage.removeItem('token')
    setUser(null)
  }, [])

  const can = useCallback(
    (capability) => Boolean(user?.capabilities?.includes(capability)),
    [user]
  )

  return (
    <AuthContext.Provider value={{ user, loading, can, refresh: load, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider')
  return ctx
}

export const ROLE_LABELS = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}
