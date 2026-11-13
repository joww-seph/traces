import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, type ReactNode } from 'react'
import { ApiError, api, type User } from '@/api'

type AuthState = {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  logout: () => Promise<void>
}
const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    retry: false,
    staleTime: Infinity,
    queryFn: () =>
      api.get<User>('/api/me').catch((e) => {
        if (e instanceof ApiError && e.status === 401) return null // not logged in is a normal answer
        throw e
      }),
  })

  const value: AuthState = {
    user: data ?? null,
    loading: isLoading,
    async login(email, password) {
      const { user } = await api.post<{ user: User }>('/api/auth/login', { email, password })
      qc.setQueryData(['me'], user)
      return user
    },
    async logout() {
      await api.post('/api/auth/logout')
      qc.clear()
      qc.setQueryData(['me'], null)
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
