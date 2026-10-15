import type {
  AgentReplyCreate,
  AgentReplyResult,
  ConversationListItem,
  ConversationPublic,
} from '../services/agentInboxService.ts'
import type { ApiEnvelope } from '../types/api.ts'
import {
  getEntity,
  listHandedOffEntities,
  makeMessage,
  okEnvelope,
  paginateItems,
  saveEntity,
  toConversationPublic,
  toListItem,
  toPublicMessage,
  type PaginatedEnvelope,
} from './conversationStore.ts'

export class AgentInboxMockError extends Error {
  status: number
  error_code: string

  constructor(status: number, error_code: string, message: string) {
    super(message)
    this.name = 'AgentInboxMockError'
    this.status = status
    this.error_code = error_code
  }
}

function fail(status: number, error_code: string, error: string): never {
  throw new AgentInboxMockError(status, error_code, error)
}

export function handleListConversations(
  page: number,
  pageSize: number,
): PaginatedEnvelope<ConversationListItem[]> {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    fail(400, 'VALIDATION_ERROR', '分页参数无效')
  }

  const items = listHandedOffEntities().map(toListItem)
  const { slice, pagination } = paginateItems(items, page, pageSize)
  return {
    ...okEnvelope(slice),
    pagination,
  }
}

export function handleGetConversation(conversationId: string): ApiEnvelope<ConversationPublic> {
  const conversation = getEntity(conversationId)
  if (!conversation) fail(404, 'NOT_FOUND', '会话不存在')
  return okEnvelope(toConversationPublic(conversation))
}

export function handleAgentReply(
  conversationId: string,
  payload: AgentReplyCreate,
): ApiEnvelope<AgentReplyResult> {
  const content = payload.content.trim()
  if (!content) fail(400, 'VALIDATION_ERROR', '请输入回复内容')
  if (content.length > 4000) fail(400, 'VALIDATION_ERROR', '回复内容不能超过 4000 字')

  const conversation = getEntity(conversationId)
  if (!conversation) fail(404, 'NOT_FOUND', '会话不存在')
  if (conversation.status !== 'handed_off') {
    fail(409, 'CONFLICT', '会话尚未转人工，无法以客服身份回复')
  }

  const reply = makeMessage({
    role: 'agent',
    kind: 'agent',
    content,
  })
  conversation.messages.push(reply)
  conversation.waiting_for_agent = false
  conversation.updated_at = reply.created_at
  saveEntity(conversation)

  return okEnvelope({
    conversation: toConversationPublic(conversation),
    reply: toPublicMessage(reply),
  })
}
