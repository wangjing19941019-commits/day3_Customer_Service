import {
  buildLoginUnauthorized,
  clearMockSession,
  resolveMockCurrent,
  resolveMockLogin,
} from '../mocks/auth.ts'
import type { ApiEnvelope } from '../types/api.ts'
import type { CurrentSessionData, SessionCreate, SessionPublic } from '../types/auth.ts'
import { getAccessToken } from '../utils/authStorage.ts'
import { isMockEnabled } from '../utils/mockFlag.ts'
import api from './api.ts'

function unwrap<T>(envelope: ApiEnvelope<T>, fallback: string): T {
  if (!envelope.success || envelope.data == null) {
    throw new Error(envelope.error ?? fallback)
  }
  return envelope.data
}

export async function createSession(payload: SessionCreate): Promise<SessionPublic> {
  if (isMockEnabled()) {
    const session = resolveMockLogin(payload.username, payload.password)
    if (!session) {
      throw new Error(buildLoginUnauthorized().error ?? '用户名或密码错误')
    }
    return session
  }
  const response = await api.post<ApiEnvelope<SessionPublic>>('sessions', payload)
  return unwrap(response.data, '用户名或密码错误')
}

export async function fetchCurrentSession(): Promise<CurrentSessionData> {
  if (isMockEnabled()) {
    const current = resolveMockCurrent(getAccessToken())
    if (!current) {
      throw new Error('请先登录')
    }
    return current
  }
  const response = await api.get<ApiEnvelope<CurrentSessionData>>('sessions/current')
  return unwrap(response.data, '请先登录')
}

export function resetLocalSession(): void {
  if (isMockEnabled()) {
    clearMockSession()
  }
}
