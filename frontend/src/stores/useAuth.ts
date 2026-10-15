import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from './authContext.ts'

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth 必须在 AuthProvider 内使用')
  }
  return value
}
