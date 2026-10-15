import { handleKnowledgeSuggestions, TicketMockError } from '../mocks/tickets.ts'
import type { ApiEnvelope } from '../types/api.ts'
import type { KnowledgeSuggestionPublic } from '../types/ticket.ts'
import { isMockEnabled } from '../utils/mockFlag.ts'
import api from './api.ts'

const REQUEST_TIMEOUT_MS = 30000

function unwrap<T>(envelope: ApiEnvelope<T>, fallback: string): T {
  if (!envelope.success || envelope.data == null) {
    throw new Error(envelope.error ?? fallback)
  }
  return envelope.data
}

function runMock<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof TicketMockError) {
      throw new Error(error.message)
    }
    throw error
  }
}

export async function fetchKnowledgeSuggestions(
  conversationId: string,
  q?: string,
): Promise<KnowledgeSuggestionPublic> {
  if (isMockEnabled()) {
    return runMock(() => unwrap(handleKnowledgeSuggestions(conversationId, q), '无法加载知识推送'))
  }
  const response = await api.get<ApiEnvelope<KnowledgeSuggestionPublic>>(
    `conversations/${conversationId}/knowledge-suggestions`,
    { timeout: REQUEST_TIMEOUT_MS, params: q ? { q } : undefined },
  )
  return unwrap(response.data, '无法加载知识推送')
}
