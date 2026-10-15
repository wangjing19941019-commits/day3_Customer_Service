import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import {
  mockApproveUrgency,
  mockClaimTicket,
  mockGetTicket,
  mockListTickets,
  mockPatchTicket,
  type MockHandlerResult,
  type PaginatedEnvelope,
} from '../mocks/ticketList.ts'
import type { ApiEnvelope } from '../types/api.ts'
import type {
  Pagination,
  TicketListItem,
  TicketListQuery,
  TicketProgressItem,
  TicketPublic,
  TicketStatusPatch,
  UrgencyApprovalCreate,
} from '../types/ticketList.ts'
import { getAccessToken } from '../utils/authStorage.ts'
import { isMockEnabled } from '../utils/mockFlag.ts'
import api from './api.ts'

export type TicketListResult = {
  items: TicketListItem[]
  pagination: Pagination
}

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20

function unwrap<T>(envelope: ApiEnvelope<T>, fallback: string): T {
  if (!envelope.success || envelope.data == null) {
    throw new Error(envelope.error ?? fallback)
  }
  return envelope.data
}

function progressText(item: TicketProgressItem): string {
  const detail = item.detail?.trim()
  if (detail) return detail
  return item.summary?.trim() ?? ''
}

function progressAt(item: TicketProgressItem): string {
  return item.at?.trim() || item.created_at?.trim() || ''
}

function normalizeProgress(item: TicketProgressItem, index: number): TicketProgressItem {
  const at = progressAt(item)
  const text = progressText(item)
  return {
    ...item,
    id: item.id ?? `${at || 'progress'}-${index}`,
    created_at: at || item.created_at,
    at: at || item.at,
    summary: text || item.summary,
    detail: text || item.detail,
    channel: item.channel,
    event: item.event,
  }
}

function normalizeTicket(ticket: TicketPublic): TicketPublic {
  return {
    ...ticket,
    assigned_display: ticket.assigned_display ?? '',
    hold_reason: ticket.hold_reason ?? null,
    user_name: ticket.user_name ?? '',
    progress: (ticket.progress ?? []).map(normalizeProgress),
  }
}

function rejectMock<T>(result: MockHandlerResult<T>): never {
  const envelope = result.envelope as ApiEnvelope<null>
  const error = new AxiosError(
    envelope.error ?? 'Request failed',
    result.status === 401 ? AxiosError.ERR_BAD_REQUEST : AxiosError.ERR_BAD_RESPONSE,
    {
      headers: new AxiosHeaders(),
    } as InternalAxiosRequestConfig,
    undefined,
    {
      data: envelope,
      status: result.status,
      statusText:
        result.status === 401
          ? 'Unauthorized'
          : result.status === 403
            ? 'Forbidden'
            : result.status === 404
              ? 'Not Found'
              : result.status === 409
                ? 'Conflict'
                : 'Bad Request',
      headers: {},
      config: { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
    },
  )
  throw error
}

function readMock<T>(result: MockHandlerResult<T | null>, fallback: string): T {
  if (result.status >= 400 || !result.envelope.success || result.envelope.data == null) {
    rejectMock(result)
  }
  return unwrap(result.envelope as ApiEnvelope<T>, fallback)
}

export async function listTickets(query: TicketListQuery = {}): Promise<TicketListResult> {
  const page = query.page ?? DEFAULT_PAGE
  const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE
  const params: TicketListQuery = { page, page_size: pageSize }
  if (query.ticket_type) params.ticket_type = query.ticket_type
  if (query.status) params.status = query.status
  if (query.urgency) params.urgency = query.urgency
  if (query.order_no) params.order_no = query.order_no
  if (query.user_query) params.user_query = query.user_query
  if (query.ticket_no) params.ticket_no = query.ticket_no
  if (query.time_from) params.time_from = query.time_from
  if (query.time_to) params.time_to = query.time_to
  if (query.queue) params.queue = query.queue

  if (isMockEnabled()) {
    const result = mockListTickets(getAccessToken(), params)
    const items = readMock(result, '无法加载工单列表')
    const pagination = (result.envelope as PaginatedEnvelope<TicketListItem[]>).pagination
    return { items, pagination }
  }

  const response = await api.get<PaginatedEnvelope<TicketListItem[]>>('tickets', { params })
  return {
    items: unwrap(response.data, '无法加载工单列表'),
    pagination: response.data.pagination,
  }
}

export async function getTicket(ticketId: string): Promise<TicketPublic> {
  if (isMockEnabled()) {
    return normalizeTicket(readMock(mockGetTicket(getAccessToken(), ticketId), '工单不存在'))
  }
  const response = await api.get<ApiEnvelope<TicketPublic>>(`tickets/${ticketId}`)
  return normalizeTicket(unwrap(response.data, '工单不存在'))
}

export async function claimTicket(ticketId: string): Promise<TicketPublic> {
  if (isMockEnabled()) {
    return normalizeTicket(readMock(mockClaimTicket(getAccessToken(), ticketId), '认领失败'))
  }
  const response = await api.post<ApiEnvelope<TicketPublic>>(`tickets/${ticketId}/claim`)
  return normalizeTicket(unwrap(response.data, '认领失败'))
}

export async function patchTicket(ticketId: string, payload: TicketStatusPatch): Promise<TicketPublic> {
  if (isMockEnabled()) {
    return normalizeTicket(readMock(mockPatchTicket(getAccessToken(), ticketId, payload), '处理失败'))
  }
  const response = await api.patch<ApiEnvelope<TicketPublic>>(`tickets/${ticketId}`, payload)
  return normalizeTicket(unwrap(response.data, '处理失败'))
}

export async function approveTicketUrgency(
  ticketId: string,
  payload: UrgencyApprovalCreate,
): Promise<TicketPublic> {
  if (isMockEnabled()) {
    return normalizeTicket(readMock(mockApproveUrgency(getAccessToken(), ticketId, payload), '审批失败'))
  }
  const response = await api.post<ApiEnvelope<TicketPublic>>(
    `tickets/${ticketId}/urgency-approvals`,
    payload,
  )
  return normalizeTicket(unwrap(response.data, '审批失败'))
}
