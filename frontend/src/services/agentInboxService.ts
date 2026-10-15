import {
  AgentInboxMockError,
  handleAgentReply,
  handleGetConversation,
  handleListConversations,
} from '../mocks/agentInbox.ts'
import type { ApiEnvelope } from '../types/api.ts'
import { isMockEnabled } from '../utils/mockFlag.ts'
import api from './api.ts'

export type ConversationStatus = 'bot' | 'handed_off'

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
  role: 'employee' | 'system' | 'agent'
  kind: MessageKind
  content: string
  original_content: string | null
  rewritten_content: string | null
  created_at: string
}

export type ConversationPublic = {
  id: string
  status: ConversationStatus
  clarification_round: number
  waiting_for_agent: boolean
  messages: MessagePublic[]
  created_at: string
  updated_at: string
}

export type ConversationListItem = {
  id: string
  status: ConversationStatus
  updated_at: string
  preview: string
  waiting_for_agent: boolean
}

export type PaginationMeta = {
  page: number
  page_size: number
  total_items: number
  total_pages: number
  has_next: boolean
  has_prev: boolean
}

export type ConversationListResult = {
  items: ConversationListItem[]
  pagination: PaginationMeta
}

export type AgentReplyResult = {
  conversation: ConversationPublic
  reply: MessagePublic
}

export type AgentReplyCreate = {
  content: string
}

type PaginatedEnvelope<T> = ApiEnvelope<T> & {
  pagination: PaginationMeta
}

const REQUEST_TIMEOUT_MS = 15000

export { getPollIntervalMs as getAgentInboxPollIntervalMs } from './conversationService.ts'

function unwrap<T>(envelope: ApiEnvelope<T>, fallback: string): T {
  if (!envelope.success || envelope.data == null) {
    throw new Error(envelope.error ?? fallback)
  }
  return envelope.data
}

function unwrapList(envelope: PaginatedEnvelope<ConversationListItem[]>): ConversationListResult {
  return {
    items: unwrap(envelope, '无法加载已转人工会话'),
    pagination: envelope.pagination,
  }
}

function runMock<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof AgentInboxMockError) {
      throw new Error(error.message)
    }
    throw error
  }
}

export async function fetchHandedOffConversations(
  page = 1,
  pageSize = 20,
): Promise<ConversationListResult> {
  if (isMockEnabled()) {
    return runMock(() => unwrapList(handleListConversations(page, pageSize)))
  }

  const response = await api.get<PaginatedEnvelope<ConversationListItem[]>>('conversations', {
    params: { page, page_size: pageSize },
    timeout: REQUEST_TIMEOUT_MS,
  })
  return unwrapList(response.data)
}

export async function fetchConversation(conversationId: string): Promise<ConversationPublic> {
  if (isMockEnabled()) {
    return runMock(() => unwrap(handleGetConversation(conversationId), '会话不存在'))
  }

  const response = await api.get<ApiEnvelope<ConversationPublic>>(`conversations/${conversationId}`, {
    timeout: REQUEST_TIMEOUT_MS,
  })
  return unwrap(response.data, '会话不存在')
}

export async function sendAgentReply(
  conversationId: string,
  payload: AgentReplyCreate,
): Promise<AgentReplyResult> {
  if (isMockEnabled()) {
    return runMock(() => unwrap(handleAgentReply(conversationId, payload), '无法发送回复'))
  }

  const response = await api.post<ApiEnvelope<AgentReplyResult>>(
    `conversations/${conversationId}/replies`,
    payload,
    { timeout: REQUEST_TIMEOUT_MS },
  )
  return unwrap(response.data, '无法发送回复')
}
