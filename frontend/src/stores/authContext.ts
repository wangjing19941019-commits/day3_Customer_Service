import { createContext } from 'react'
import type { UserRole } from '../types/auth.ts'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export type AuthUser = {
  username: string
  role: UserRole
}

export type AuthContextValue = {
  status: AuthStatus
  user: AuthUser | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
