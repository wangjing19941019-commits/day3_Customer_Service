import type {
  ConversationListItem,
  PaginationMeta,
} from '../services/agentInboxService.ts'
import type {
  ConversationPublic,
  MessageKind,
  MessagePublic,
  MessageRole,
} from '../services/conversationService.ts'
import type { ApiEnvelope } from '../types/api.ts'
import { withMockLabel } from '../utils/mockFlag.ts'

export const CONVERSATION_STORE_KEY = 'mock_conversations'
const PREVIEW_MAX = 40

export type ConversationEntity = {
  id: string
  status: 'bot' | 'handed_off'
  clarification_round: number
  waiting_for_agent: boolean
  messages: MessagePublic[]
  created_at: string
  updated_at: string
}

export type PaginatedEnvelope<T> = ApiEnvelope<T> & {
  pagination: PaginationMeta
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function newId(): string {
  return crypto.randomUUID()
}

export function okEnvelope<T>(data: T): ApiEnvelope<T> {
  return {
    success: true,
    data,
    error: null,
    error_code: null,
    message: 'ok',
    timestamp: nowIso(),
    request_id: `mock-req-${newId()}`,
    metadata: {},
  }
}

export function failEnvelope<T>(error: string, errorCode: string): ApiEnvelope<T> {
  return {
    success: false,
    data: null,
    error,
    error_code: errorCode,
    message: null,
    timestamp: nowIso(),
    request_id: `mock-req-${newId()}`,
    metadata: {},
  }
}

function labelText(value: string | null): string | null {
  if (value == null || value === '') return value
  return withMockLabel(value)
}

export function readStore(): Record<string, ConversationEntity> {
  try {
    const raw = sessionStorage.getItem(CONVERSATION_STORE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, ConversationEntity>
  } catch {
    return {}
  }
}

function writeStore(store: Record<string, ConversationEntity>): void {
  sessionStorage.setItem(CONVERSATION_STORE_KEY, JSON.stringify(store))
}

export function getEntity(conversationId: string): ConversationEntity | undefined {
  return readStore()[conversationId]
}

export function saveEntity(entity: ConversationEntity): ConversationEntity {
  const store = readStore()
  store[entity.id] = entity
  writeStore(store)
  return entity
}

export function listHandedOffEntities(): ConversationEntity[] {
  return Object.values(readStore())
    .filter((conversation) => conversation.status === 'handed_off')
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
}

export function makeMessage(input: {
  role: MessageRole
  kind: MessageKind
  content: string
  original_content?: string | null
  rewritten_content?: string | null
}): MessagePublic {
  return {
    id: newId(),
    role: input.role,
    kind: input.kind,
    content: input.content,
    original_content: input.original_content ?? null,
    rewritten_content: input.rewritten_content ?? null,
    created_at: nowIso(),
  }
}

export function toPublicMessage(message: MessagePublic): MessagePublic {
  return {
    id: message.id,
    role: message.role,
    kind: message.kind,
    content: message.content ? withMockLabel(message.content) : message.content,
    original_content: labelText(message.original_content),
    rewritten_content: labelText(message.rewritten_content),
    created_at: message.created_at,
  }
}

export function toConversationPublic(entity: ConversationEntity): ConversationPublic {
  return {
    id: entity.id,
    status: entity.status,
    clarification_round: entity.clarification_round,
    waiting_for_agent: entity.waiting_for_agent,
    messages: entity.messages.map(toPublicMessage),
    created_at: entity.created_at,
    updated_at: entity.updated_at,
  }
}

function previewOf(conversation: ConversationEntity): string {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]
    if (message.role === 'employee') {
      const text = withMockLabel(message.content)
      return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text
    }
  }
  const last = conversation.messages[conversation.messages.length - 1]
  if (!last) return ''
  const text = last.content ? withMockLabel(last.content) : last.content
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text
}

export function toListItem(conversation: ConversationEntity): ConversationListItem {
  return {
    id: conversation.id,
    status: conversation.status,
    updated_at: conversation.updated_at,
    preview: previewOf(conversation),
    waiting_for_agent: conversation.waiting_for_agent,
  }
}

export function paginateItems<T>(
  items: T[],
  page: number,
  pageSize: number,
): { slice: T[]; pagination: PaginationMeta } {
  const totalItems = items.length
  const totalPages = pageSize > 0 ? Math.ceil(totalItems / pageSize) : 0
  const start = (page - 1) * pageSize
  return {
    slice: items.slice(start, start + pageSize),
    pagination: {
      page,
      page_size: pageSize,
      total_items: totalItems,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1,
    },
  }
}
