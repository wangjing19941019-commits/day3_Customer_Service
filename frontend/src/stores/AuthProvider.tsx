import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createSession, fetchCurrentSession, resetLocalSession } from '../services/authService.ts'
import { AUTH_UNAUTHORIZED_EVENT } from '../utils/authEvents.ts'
import { clearAccessToken, getAccessToken, setAccessToken } from '../utils/authStorage.ts'
import { AuthContext, type AuthStatus, type AuthUser } from './authContext.ts'

type AuthState = {
  status: AuthStatus
  user: AuthUser | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null })

  useEffect(() => {
    let cancelled = false

    async function restore() {
      const token = getAccessToken()
      if (!token) {
        if (!cancelled) setState({ status: 'anonymous', user: null })
        return
      }
      try {
        const current = await fetchCurrentSession()
        if (!cancelled) {
          setState({
            status: 'authenticated',
            user: { username: current.username, role: current.role },
          })
        }
      } catch {
        clearAccessToken()
        if (!cancelled) setState({ status: 'anonymous', user: null })
      }
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function onUnauthorized() {
      resetLocalSession()
      setState({ status: 'anonymous', user: null })
    }
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const session = await createSession({ username, password })
    setAccessToken(session.access_token)
    setState({
      status: 'authenticated',
      user: { username: session.username, role: session.role },
    })
  }, [])

  const logout = useCallback(() => {
    clearAccessToken()
    resetLocalSession()
    setState({ status: 'anonymous', user: null })
  }, [])

  const value = useMemo(
    () => ({
      status: state.status,
      user: state.user,
      login,
      logout,
    }),
    [login, logout, state.status, state.user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
