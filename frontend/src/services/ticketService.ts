import {
  handleConfirmTicket,
  handleGetTicket,
  handlePatchTicket,
  handleUploadTicketAttachment,
  TicketMockError,
} from '../mocks/tickets.ts'
import type { ApiEnvelope } from '../types/api.ts'
import type { TicketPublic, TicketUpdate } from '../types/ticket.ts'
import { isMockEnabled } from '../utils/mockFlag.ts'
import api from './api.ts'

const REQUEST_TIMEOUT_MS = 15000

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

export async function fetchTicket(conversationId: string): Promise<TicketPublic> {
  if (isMockEnabled()) {
    return runMock(() => unwrap(handleGetTicket(conversationId), '无法读取工单'))
  }
  const response = await api.get<ApiEnvelope<TicketPublic>>(`conversations/${conversationId}/ticket`, {
    timeout: REQUEST_TIMEOUT_MS,
  })
  return unwrap(response.data, '无法读取工单')
}

export async function updateTicket(
  conversationId: string,
  payload: TicketUpdate,
): Promise<TicketPublic> {
  if (isMockEnabled()) {
    return runMock(() => unwrap(handlePatchTicket(conversationId, payload), '无法保存工单'))
  }
  const response = await api.patch<ApiEnvelope<TicketPublic>>(
    `conversations/${conversationId}/ticket`,
    payload,
    { timeout: REQUEST_TIMEOUT_MS },
  )
  return unwrap(response.data, '无法保存工单')
}

export async function confirmTicket(conversationId: string): Promise<TicketPublic> {
  if (isMockEnabled()) {
    return runMock(() => unwrap(handleConfirmTicket(conversationId), '无法确认工单'))
  }
  const response = await api.post<ApiEnvelope<TicketPublic>>(
    `conversations/${conversationId}/ticket/confirm`,
    undefined,
    { timeout: REQUEST_TIMEOUT_MS },
  )
  return unwrap(response.data, '无法确认工单')
}

export async function uploadTicketAttachment(
  conversationId: string,
  file: File,
): Promise<TicketPublic> {
  if (isMockEnabled()) {
    return runMock(() =>
      unwrap(handleUploadTicketAttachment(conversationId, file), '请重新上传'),
    )
  }
  const body = new FormData()
  body.append('file', file)
  const response = await api.post<ApiEnvelope<TicketPublic>>(
    `conversations/${conversationId}/ticket/attachments`,
    body,
    {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': undefined as unknown as string },
    },
  )
  return unwrap(response.data, '请重新上传')
}
