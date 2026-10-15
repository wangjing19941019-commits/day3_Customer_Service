import type { ApiEnvelope } from '../types/api.ts'
import type { CurrentSessionData, SessionPublic, UserRole } from '../types/auth.ts'
import { ACCESS_TOKEN_KEY } from '../utils/authStorage.ts'

export const MOCK_DEMO_USERNAME = 'it-help'
export const MOCK_DEMO_PASSWORD = 'it-help123'
export const MOCK_ACCESS_TOKEN_BASE = 'mock-access-token'

type MockAccount = {
  username: string
  role: UserRole
}

export const MOCK_ACCOUNTS: readonly MockAccount[] = [
  { username: MOCK_DEMO_USERNAME, role: 'employee' },
  { username: 'employee', role: 'employee' },
  { username: 'agent', role: 'frontline_agent' },
  { username: 'specialist', role: 'after_sales_specialist' },
  { username: 'senior', role: 'senior_after_sales' },
  { username: 'supervisor', role: 'supervisor' },
  { username: 'after_sales_supervisor', role: 'after_sales_supervisor' },
  { username: 'cs_lead', role: 'cs_lead' },
  { username: 'logistics_agent', role: 'logistics_after_sales' },
  { username: 'cs_supervisor', role: 'cs_supervisor' },
  { username: 'admin', role: 'admin' },
]

export const MOCK_SEED_USERNAMES = MOCK_ACCOUNTS.filter(
  (account) => account.username !== MOCK_DEMO_USERNAME,
).map((account) => account.username)

export function tokenForUsername(username: string): string {
  return username === MOCK_DEMO_USERNAME ? MOCK_ACCESS_TOKEN_BASE : `${MOCK_ACCESS_TOKEN_BASE}:${username}`
}

function readStoredMockToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY)
  } catch {
    return null
  }
}

function isMockToken(token: string): boolean {
  return token === MOCK_ACCESS_TOKEN_BASE || token.startsWith(`${MOCK_ACCESS_TOKEN_BASE}:`)
}

export function findAccountByUsername(username: string): MockAccount | undefined {
  return MOCK_ACCOUNTS.find((account) => account.username === username)
}

export function findAccountByToken(token: string | null): MockAccount | undefined {
  if (!token || !isMockToken(token)) return undefined
  if (token === MOCK_ACCESS_TOKEN_BASE) {
    return findAccountByUsername(MOCK_DEMO_USERNAME)
  }
  const username = token.slice(MOCK_ACCESS_TOKEN_BASE.length + 1)
  return findAccountByUsername(username)
}

export let MOCK_ACCESS_TOKEN = MOCK_ACCESS_TOKEN_BASE

const storedToken = readStoredMockToken()
if (storedToken && isMockToken(storedToken)) {
  MOCK_ACCESS_TOKEN = storedToken
}

function bindMockAccessToken(token: string): void {
  MOCK_ACCESS_TOKEN = token
}

function buildEnvelope<T>(
  partial: Omit<ApiEnvelope<T>, 'timestamp' | 'request_id' | 'metadata'>,
): ApiEnvelope<T> {
  return {
    ...partial,
    timestamp: new Date().toISOString(),
    request_id: `mock-req-${crypto.randomUUID()}`,
    metadata: {},
  }
}

function toSessionPublic(account: MockAccount): SessionPublic {
  const accessToken = tokenForUsername(account.username)
  bindMockAccessToken(accessToken)
  return {
    access_token: accessToken,
    token_type: 'bearer',
    username: account.username,
    role: account.role,
  }
}

export function resolveMockLogin(username: string, password: string): SessionPublic | null {
  if (password !== MOCK_DEMO_PASSWORD) return null
  const account = findAccountByUsername(username)
  if (!account) return null
  return toSessionPublic(account)
}

export function resolveMockCurrent(token: string | null): CurrentSessionData | null {
  const account = findAccountByToken(token)
  if (!account) return null
  bindMockAccessToken(tokenForUsername(account.username))
  return { username: account.username, role: account.role }
}

export function clearMockSession(): void {
  MOCK_ACCESS_TOKEN = MOCK_ACCESS_TOKEN_BASE
}

export function buildLoginSuccess(): ApiEnvelope<SessionPublic> {
  const data = toSessionPublic(findAccountByUsername(MOCK_DEMO_USERNAME)!)
  return buildEnvelope({
    success: true,
    data,
    error: null,
    error_code: null,
    message: 'ok',
  })
}

export function buildLoginUnauthorized(): ApiEnvelope<null> {
  return buildEnvelope({
    success: false,
    data: null,
    error: '用户名或密码错误',
    error_code: 'UNAUTHORIZED',
    message: null,
  })
}

export function buildLoginValidationError(): ApiEnvelope<null> {
  return buildEnvelope({
    success: false,
    data: null,
    error: '请输入用户名和密码',
    error_code: 'VALIDATION_ERROR',
    message: null,
  })
}

export function buildCurrentSessionSuccess(username?: string): ApiEnvelope<CurrentSessionData> {
  const fromToken = findAccountByToken(MOCK_ACCESS_TOKEN)
  const account =
    fromToken ??
    (username ? findAccountByUsername(username) : undefined) ??
    findAccountByUsername(MOCK_DEMO_USERNAME)!
  const data: CurrentSessionData = { username: account.username, role: account.role }
  return buildEnvelope({
    success: true,
    data,
    error: null,
    error_code: null,
    message: 'ok',
  })
}

export function buildCurrentSessionUnauthorized(): ApiEnvelope<null> {
  return buildEnvelope({
    success: false,
    data: null,
    error: '请先登录',
    error_code: 'UNAUTHORIZED',
    message: null,
  })
}
