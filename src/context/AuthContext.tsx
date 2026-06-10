import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { pb } from '../lib/pocketbase'
import type { AppUser } from '../types'

interface AuthContextValue {
  user: AppUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (pb.authStore.isValid && pb.authStore.model) {
      const m = pb.authStore.model
      setUser({ id: m.id, email: m.email, name: m.name || '', role: m.role || 'editor' })
    }
    setLoading(false)

    const unsub = pb.authStore.onChange((_, model) => {
      if (model) {
        setUser({ id: model.id, email: model.email, name: model.name || '', role: model.role || 'editor' })
      } else {
        setUser(null)
      }
    })
    return () => unsub()
  }, [])

  async function login(email: string, password: string) {
    const auth = await pb.collection('users').authWithPassword(email, password)
    const m = auth.record
    setUser({ id: m.id, email: m.email, name: m.name || '', role: m.role || 'editor' })
  }

  function logout() {
    pb.authStore.clear()
    setUser(null)
  }

  const isAdmin = user?.role === 'admin'

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
