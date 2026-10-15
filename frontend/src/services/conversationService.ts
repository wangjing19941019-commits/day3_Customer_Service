import axios from 'axios'
import type { ApiEnvelope } from '../types/api.ts'
import { isMockEnabled } from '../utils/mockFlag.ts'
import api from './api.ts'

export type MessageRole = 'employee' | 'system' | 'agent'

export type MessageKind =
  | 'employee_turn'
  | 'clarification'
  | 'faq'
  | 'small_talk'
  | 'knowledge'
  | 'fallback'
  | 'waiting_for_agent'
  | 'agent'

export type MessagePublic = {
  id: string
  role: MessageRole
  kind: MessageKind
  content: string
  original_content: string | null
  rewritten_content: string | null
  created_at: string
}

export type ConversationPublic = {
  id: string
  status: 'bot' | 'handed_off'
  clarification_round: number
  waiting_for_agent: boolean
  messages: MessagePublic[]
  created_at: string
  updated_at: string
}

export type EmployeeMessageResponse = {
  conversation: ConversationPublic
  reply: MessagePublic
}

export const DEFAULT_POLL_INTERVAL_MS = 3000

export function getPollIntervalMs(): number {
  const raw = Number(import.meta.env.VITE_POLL_INTERVAL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_POLL_INTERVAL_MS
}

export class ConversationNotFoundError extends Error {
  readonly error_code = 'NOT_FOUND'
  constructor(message = '会话不存在') {
    super(message)
    this.name = 'ConversationNotFoundError'
  }
}

function unwrap<T>(envelope: ApiEnvelope<T>, fallback: string): T {
  if (envelope.error_code === 'NOT_FOUND') {
    throw new ConversationNotFoundError(envelope.error ?? fallback)
  }
  if (!envelope.success || envelope.data == null) {
    throw new Error(envelope.error ?? fallback)
  }
  return envelope.data
}

export function isConversationNotFound(error: unknown): boolean {
  if (error instanceof ConversationNotFoundError) return true
  return axios.isAxiosError(error) && error.response?.status === 404
}

export async function createConversation(): Promise<ConversationPublic> {
  if (isMockEnabled()) {
    const { mockCreateConversation } = await import('../mocks/conversations.ts')
    return unwrap(mockCreateConversation(), '无法创建会话')
  }
  const response = await api.post<ApiEnvelope<ConversationPublic>>('conversations', undefined, {
    timeout: 15000,
  })
  return unwrap(response.data, '无法创建会话')
}

export async function fetchConversation(conversationId: string): Promise<ConversationPublic> {
  if (isMockEnabled()) {
    const { mockGetConversation } = await import('../mocks/conversations.ts')
    return unwrap(mockGetConversation(conversationId), '会话不存在')
  }
  const response = await api.get<ApiEnvelope<ConversationPublic>>(`conversations/${conversationId}`, {
    timeout: 15000,
  })
  return unwrap(response.data, '会话不存在')
}

export async function sendEmployeeMessage(
  conversationId: string,
  content: string,
): Promise<EmployeeMessageResponse> {
  if (isMockEnabled()) {
    const { mockSendEmployeeMessage } = await import('../mocks/conversations.ts')
    return unwrap(mockSendEmployeeMessage(conversationId, content), '发送失败')
  }
  const response = await api.post<ApiEnvelope<EmployeeMessageResponse>>(
    `conversations/${conversationId}/messages`,
    { content },
    { timeout: 60000 },
  )
  return unwrap(response.data, '发送失败')
}

export async function transferConversation(conversationId: string): Promise<ConversationPublic> {
  if (isMockEnabled()) {
    const { mockTransferConversation } = await import('../mocks/conversations.ts')
    return unwrap(mockTransferConversation(conversationId), '转人工失败')
  }
  const response = await api.post<ApiEnvelope<ConversationPublic>>(
    `conversations/${conversationId}/transfer`,
    undefined,
    { timeout: 15000 },
  )
  return unwrap(response.data, '转人工失败')
}
