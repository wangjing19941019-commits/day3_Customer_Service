import { handlePolishReply, handleResultFeedback, TicketMockError } from '../mocks/tickets.ts'
import type { ApiEnvelope } from '../types/api.ts'
import type {
  AgentPolishCreate,
  AgentPolishPublic,
  ResultFeedbackCreate,
  ResultFeedbackPublic,
} from '../types/ticket.ts'
import { isMockEnabled } from '../utils/mockFlag.ts'
import api from './api.ts'

const POLISH_TIMEOUT_MS = 60000
const FEEDBACK_TIMEOUT_MS = 15000

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

export async function previewPolish(
  conversationId: string,
  payload: AgentPolishCreate,
): Promise<AgentPolishPublic> {
  if (isMockEnabled()) {
    return runMock(() => unwrap(handlePolishReply(conversationId, payload), '无法润色'))
  }
  const response = await api.post<ApiEnvelope<AgentPolishPublic>>(
    `conversations/${conversationId}/replies/polish`,
    payload,
    { timeout: POLISH_TIMEOUT_MS },
  )
  return unwrap(response.data, '无法润色')
}

export async function submitResultFeedback(
  conversationId: string,
  payload: ResultFeedbackCreate,
): Promise<ResultFeedbackPublic> {
  if (isMockEnabled()) {
    return runMock(() => unwrap(handleResultFeedback(conversationId, payload), '无法提交反馈'))
  }
  const response = await api.post<ApiEnvelope<ResultFeedbackPublic>>(
    `conversations/${conversationId}/result-feedbacks`,
    payload,
    { timeout: FEEDBACK_TIMEOUT_MS },
  )
  return unwrap(response.data, '无法提交反馈')
}
