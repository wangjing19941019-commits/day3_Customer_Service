import type { ApiEnvelope } from '../types/api.ts'
import type { UserRole } from '../types/auth.ts'
import type {
  Pagination,
  TicketHoldReason,
  TicketListItem,
  TicketListQuery,
  TicketListStatus,
  TicketProgressChannel,
  TicketProgressItem,
  TicketPublic,
  TicketQueue,
  TicketStatusPatch,
  TicketType,
  TicketUrgency,
  UrgencyApprovalCreate,
} from '../types/ticketList.ts'
import { findAccountByToken } from './auth.ts'
import { newId, nowIso } from './conversationStore.ts'
import { withMockLabel } from '../utils/mockFlag.ts'

export const EMPTY_TICKETS_TEXT = '当前没有符合条件的工单'

export const TICKET_TYPE_OPTIONS: { value: TicketType; label: string }[] = [
  { value: 'return_exchange', label: '退换货' },
  { value: 'address_change', label: '修改地址' },
  { value: 'invoice', label: '开发票' },
  { value: 'complaint', label: '投诉维权' },
  { value: 'fee_dispute', label: '费用争议' },
  { value: 'logistics_exception', label: '物流异常' },
]

export const TICKET_STATUS_OPTIONS: { value: TicketListStatus; label: string }[] = [
  { value: 'pending', label: '待处理' },
  { value: 'in_progress', label: '处理中' },
  { value: 'on_hold', label: '挂起' },
  { value: 'completed', label: '已完成' },
  { value: 'closed', label: '已关闭' },
]

export const TICKET_URGENCY_OPTIONS: { value: TicketUrgency; label: string }[] = [
  { value: 'normal', label: '普通' },
  { value: 'vip', label: 'VIP' },
  { value: 'high_risk', label: '高风险' },
]

export const HOLD_REASON_LABEL: Record<TicketHoldReason, string> = {
  wait_user: '在等用户补充',
  wait_warehouse: '在等仓储确认',
}

export type PaginatedEnvelope<T> = ApiEnvelope<T> & {
  pagination: Pagination
}

export type MockHandlerResult<T> = {
  status: number
  envelope: ApiEnvelope<T> | PaginatedEnvelope<T>
}

export class TicketListMockError extends Error {
  status: number
  error_code: string

  constructor(status: number, error_code: string, message: string) {
    super(message)
    this.name = 'TicketListMockError'
    this.status = status
    this.error_code = error_code
  }
}

type TicketEntity = {
  id: string
  ticket_no: string
  conversation_id: string
  status: TicketListStatus
  ticket_type: TicketType
  business_line: TicketPublic['business_line']
  urgency: TicketUrgency
  queue: TicketQueue
  assigned_role: string
  assigned_user_id: string | null
  assigned_display: string
  upgrade_undelivered: boolean
  hold_reason: TicketHoldReason | null
  order_no: string | null
  user_name: string
  progress: TicketProgressItem[]
  sla_due_at: string | null
  confirmed_at: string
  created_at: string
  updated_at: string
  origin_agent: string | null
}

const STORAGE_KEY = 'customer_service_mock_ticket_list_v2'
const TYPE_SET = new Set<string>(TICKET_TYPE_OPTIONS.map((item) => item.value))
const STATUS_SET = new Set<string>(TICKET_STATUS_OPTIONS.map((item) => item.value))
const URGENCY_SET = new Set<string>(TICKET_URGENCY_OPTIONS.map((item) => item.value))
const QUEUE_SET = new Set<string>(['normal', 'vip_priority', 'high_risk'])
const QUEUE_RANK: Record<TicketQueue, number> = {
  high_risk: 0,
  vip_priority: 1,
  normal: 2,
}
const ROLE_LABEL: Record<string, string> = {
  after_sales_specialist: '售后专员',
  senior_after_sales: '高级售后专员',
  supervisor: '主管',
  after_sales_supervisor: '售后主管',
  cs_lead: '客服负责人',
  logistics_after_sales: '物流售后专员',
  cs_supervisor: '客服主管',
  admin: '管理员',
}

const tickets: TicketEntity[] = loadStore()

function loadStore(): TicketEntity[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return seedTickets()
    const parsed = JSON.parse(raw) as TicketEntity[]
    if (!Array.isArray(parsed) || parsed.length === 0) return seedTickets()
    return parsed
  } catch {
    return seedTickets()
  }
}

function persist(): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tickets))
}

function labeled(text: string): string {
  return withMockLabel(text)
}

function progressItem(
  channel: TicketProgressChannel,
  summary: string,
  createdAt: string,
): TicketProgressItem {
  const text = labeled(summary)
  return {
    id: `prg_${createdAt}_${channel}`,
    created_at: createdAt,
    at: createdAt,
    summary: text,
    detail: text,
    channel,
    event: channel,
  }
}

function seedTickets(): TicketEntity[] {
  const rows: TicketEntity[] = [
    {
      id: 'tkt_pending_normal',
      ticket_no: 'TKT-20260922-A001',
      conversation_id: 'c_pending_normal',
      status: 'pending',
      ticket_type: 'address_change',
      business_line: 'apparel_beauty',
      urgency: 'normal',
      queue: 'normal',
      assigned_role: 'after_sales_specialist',
      assigned_user_id: null,
      assigned_display: '售后专员',
      upgrade_undelivered: false,
      hold_reason: null,
      order_no: 'AP20260921011',
      user_name: '王敏',
      progress: [progressItem('status', '已确认，等待售后专员接起', '2026-09-22T09:00:00.000Z')],
      sla_due_at: '2026-09-22T11:00:00.000Z',
      confirmed_at: '2026-09-22T09:00:00.000Z',
      created_at: '2026-09-22T08:40:00.000Z',
      updated_at: '2026-09-22T09:00:00.000Z',
      origin_agent: 'agent',
    },
    {
      id: 'tkt_in_progress_return',
      ticket_no: 'TKT-20260922-A002',
      conversation_id: 'c_in_progress_return',
      status: 'in_progress',
      ticket_type: 'return_exchange',
      business_line: 'apparel_beauty',
      urgency: 'normal',
      queue: 'normal',
      assigned_role: 'after_sales_specialist',
      assigned_user_id: 'specialist',
      assigned_display: '售后专员',
      upgrade_undelivered: false,
      hold_reason: null,
      order_no: 'AP20260922021',
      user_name: '李芳',
      progress: [
        progressItem('status', '已确认并分配给售后专员', '2026-09-22T10:00:00.000Z'),
        progressItem('warehouse', '已发起退货', '2026-09-22T10:02:00.000Z'),
      ],
      sla_due_at: '2026-09-23T10:00:00.000Z',
      confirmed_at: '2026-09-22T10:00:00.000Z',
      created_at: '2026-09-22T09:50:00.000Z',
      updated_at: '2026-09-22T10:02:00.000Z',
      origin_agent: 'agent',
    },
    {
      id: 'tkt_vip_invoice',
      ticket_no: 'TKT-20260922-V003',
      conversation_id: 'c_vip_invoice',
      status: 'in_progress',
      ticket_type: 'invoice',
      business_line: 'digital_3c',
      urgency: 'vip',
      queue: 'vip_priority',
      assigned_role: 'after_sales_specialist',
      assigned_user_id: 'specialist',
      assigned_display: '售后专员',
      upgrade_undelivered: false,
      hold_reason: null,
      order_no: 'JD20260922001',
      user_name: '赵雅',
      progress: [
        progressItem('status', 'VIP 优先队列已分配给售后专员', '2026-09-22T11:00:00.000Z'),
        progressItem('finance', '已向财务发起开票', '2026-09-22T11:01:00.000Z'),
      ],
      sla_due_at: '2026-09-22T11:30:00.000Z',
      confirmed_at: '2026-09-22T11:00:00.000Z',
      created_at: '2026-09-22T10:50:00.000Z',
      updated_at: '2026-09-22T11:01:00.000Z',
      origin_agent: 'agent',
    },
    {
      id: 'tkt_high_risk',
      ticket_no: 'TKT-20260922-R004',
      conversation_id: 'c_high_risk',
      status: 'in_progress',
      ticket_type: 'complaint',
      business_line: 'digital_3c',
      urgency: 'high_risk',
      queue: 'high_risk',
      assigned_role: 'senior_after_sales',
      assigned_user_id: 'senior',
      assigned_display: '高级售后专员',
      upgrade_undelivered: false,
      hold_reason: null,
      order_no: 'JD20260922002',
      user_name: '周强',
      progress: [progressItem('status', '高风险已分配给高级售后专员', '2026-09-22T12:00:00.000Z')],
      sla_due_at: '2026-09-24T12:00:00.000Z',
      confirmed_at: '2026-09-22T12:00:00.000Z',
      created_at: '2026-09-22T11:40:00.000Z',
      updated_at: '2026-09-22T12:00:00.000Z',
      origin_agent: 'agent',
    },
    {
      id: 'tkt_hold_user',
      ticket_no: 'TKT-20260921-H005',
      conversation_id: 'c_hold_user',
      status: 'on_hold',
      ticket_type: 'fee_dispute',
      business_line: 'digital_3c',
      urgency: 'normal',
      queue: 'normal',
      assigned_role: 'after_sales_specialist',
      assigned_user_id: 'specialist',
      assigned_display: '售后专员',
      upgrade_undelivered: false,
      hold_reason: 'wait_user',
      order_no: 'JD20260921008',
      user_name: '陈冬',
      progress: [progressItem('status', '挂起：在等用户补充', '2026-09-21T16:00:00.000Z')],
      sla_due_at: '2026-09-22T16:00:00.000Z',
      confirmed_at: '2026-09-21T14:00:00.000Z',
      created_at: '2026-09-21T13:40:00.000Z',
      updated_at: '2026-09-21T16:00:00.000Z',
      origin_agent: 'agent',
    },
    {
      id: 'tkt_hold_warehouse',
      ticket_no: 'TKT-20260921-H006',
      conversation_id: 'c_hold_warehouse',
      status: 'on_hold',
      ticket_type: 'return_exchange',
      business_line: 'apparel_beauty',
      urgency: 'normal',
      queue: 'normal',
      assigned_role: 'after_sales_specialist',
      assigned_user_id: 'specialist',
      assigned_display: '售后专员',
      upgrade_undelivered: false,
      hold_reason: 'wait_warehouse',
      order_no: 'AP20260920007',
      user_name: '吴兰',
      progress: [
        progressItem('warehouse', '仓储未接单：仓配系统繁忙，未生成退货单', '2026-09-21T15:10:00.000Z'),
        progressItem('status', '挂起：在等仓储确认', '2026-09-21T15:12:00.000Z'),
      ],
      sla_due_at: '2026-09-22T15:00:00.000Z',
      confirmed_at: '2026-09-21T15:00:00.000Z',
      created_at: '2026-09-21T14:50:00.000Z',
      updated_at: '2026-09-21T15:12:00.000Z',
      origin_agent: 'agent',
    },
    {
      id: 'tkt_completed',
      ticket_no: 'TKT-20260920-C007',
      conversation_id: 'c_completed',
      status: 'completed',
      ticket_type: 'invoice',
      business_line: 'digital_3c',
      urgency: 'normal',
      queue: 'normal',
      assigned_role: 'after_sales_specialist',
      assigned_user_id: 'specialist',
      assigned_display: '售后专员',
      upgrade_undelivered: false,
      hold_reason: null,
      order_no: 'JD20260919003',
      user_name: '孙悦',
      progress: [
        progressItem('finance', '已向财务发起开票', '2026-09-20T11:00:00.000Z'),
        progressItem('status', '处理结果已回写，状态为已完成', '2026-09-20T18:00:00.000Z'),
      ],
      sla_due_at: '2026-09-20T13:00:00.000Z',
      confirmed_at: '2026-09-20T11:00:00.000Z',
      created_at: '2026-09-20T10:40:00.000Z',
      updated_at: '2026-09-20T18:00:00.000Z',
      origin_agent: 'agent',
    },
    {
      id: 'tkt_closed',
      ticket_no: 'TKT-20260920-C008',
      conversation_id: 'c_closed',
      status: 'closed',
      ticket_type: 'logistics_exception',
      business_line: 'apparel_beauty',
      urgency: 'normal',
      queue: 'normal',
      assigned_role: 'after_sales_specialist',
      assigned_user_id: 'specialist',
      assigned_display: '售后专员',
      upgrade_undelivered: false,
      hold_reason: null,
      order_no: 'AP20260918002',
      user_name: '郑浩',
      progress: [progressItem('status', '用户确认已经解决，工单已关闭', '2026-09-20T19:00:00.000Z')],
      sla_due_at: '2026-09-21T12:00:00.000Z',
      confirmed_at: '2026-09-20T12:00:00.000Z',
      created_at: '2026-09-20T11:40:00.000Z',
      updated_at: '2026-09-20T19:00:00.000Z',
      origin_agent: 'agent',
    },
    {
      id: 'tkt_pending_vip',
      ticket_no: 'TKT-20260923-V009',
      conversation_id: 'c_pending_vip',
      status: 'pending',
      ticket_type: 'return_exchange',
      business_line: 'digital_3c',
      urgency: 'vip',
      queue: 'vip_priority',
      assigned_role: 'after_sales_specialist',
      assigned_user_id: null,
      assigned_display: '售后专员',
      upgrade_undelivered: true,
      hold_reason: null,
      order_no: 'JD20260923009',
      user_name: '林悦',
      progress: [progressItem('status', 'VIP 待分配；升级未送达，处理人仍为售后专员', '2026-09-23T07:00:00.000Z')],
      sla_due_at: '2026-09-23T11:00:00.000Z',
      confirmed_at: '2026-09-23T07:00:00.000Z',
      created_at: '2026-09-23T06:50:00.000Z',
      updated_at: '2026-09-23T07:00:00.000Z',
      origin_agent: 'agent',
    },
    {
      id: 'tkt_pending_risk',
      ticket_no: 'TKT-20260923-R010',
      conversation_id: 'c_pending_risk',
      status: 'pending',
      ticket_type: 'complaint',
      business_line: 'digital_3c',
      urgency: 'high_risk',
      queue: 'high_risk',
      assigned_role: 'senior_after_sales',
      assigned_user_id: null,
      assigned_display: '高级售后专员',
      upgrade_undelivered: false,
      hold_reason: null,
      order_no: 'JD20260923010',
      user_name: '黄涛',
      progress: [progressItem('status', '高风险待高级售后专员认领', '2026-09-23T07:30:00.000Z')],
      sla_due_at: '2026-09-25T07:30:00.000Z',
      confirmed_at: '2026-09-23T07:30:00.000Z',
      created_at: '2026-09-23T07:20:00.000Z',
      updated_at: '2026-09-23T07:30:00.000Z',
      origin_agent: 'agent',
    },
  ]
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  return rows
}

function fail(status: number, error_code: string, error: string): never {
  throw new TicketListMockError(status, error_code, error)
}

function envelope<T>(data: T): ApiEnvelope<T> {
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

function failEnvelope(error: string, error_code: string): ApiEnvelope<null> {
  return {
    success: false,
    data: null,
    error,
    error_code,
    message: null,
    timestamp: nowIso(),
    request_id: `mock-req-${newId()}`,
    metadata: {},
  }
}

function requireActor(token: string | null): { username: string; role: UserRole } {
  const account = findAccountByToken(token)
  if (!account) fail(401, 'UNAUTHORIZED', '当前未登录')
  return account
}

function queueForUrgency(urgency: TicketUrgency): TicketQueue {
  if (urgency === 'high_risk') return 'high_risk'
  if (urgency === 'vip') return 'vip_priority'
  return 'normal'
}

function roleForQueue(queue: TicketQueue): string {
  if (queue === 'high_risk') return 'senior_after_sales'
  return 'after_sales_specialist'
}

function toListItem(entity: TicketEntity): TicketListItem {
  return {
    id: entity.id,
    ticket_no: labeled(entity.ticket_no),
    ticket_type: entity.ticket_type,
    status: entity.status,
    urgency: entity.urgency,
    queue: entity.queue,
    order_no: entity.order_no ? labeled(entity.order_no) : null,
    assigned_display: labeled(entity.assigned_display),
    upgrade_undelivered: entity.upgrade_undelivered,
    confirmed_at: entity.confirmed_at,
    sla_due_at: entity.sla_due_at,
    updated_at: entity.updated_at,
  }
}

function toPublic(entity: TicketEntity): TicketPublic {
  return {
    id: entity.id,
    ticket_no: labeled(entity.ticket_no),
    conversation_id: entity.conversation_id,
    status: entity.status,
    ticket_type: entity.ticket_type,
    business_line: entity.business_line,
    urgency: entity.urgency,
    queue: entity.queue,
    assigned_role: entity.assigned_role,
    assigned_user_id: entity.assigned_user_id,
    assigned_display: labeled(entity.assigned_display),
    upgrade_undelivered: entity.upgrade_undelivered,
    hold_reason: entity.hold_reason,
    order_no: entity.order_no ? labeled(entity.order_no) : null,
    user_name: labeled(entity.user_name),
    progress: entity.progress.map((item) => ({
      ...item,
      summary: labeled(item.summary || item.detail || ''),
      detail: labeled(item.detail || item.summary || ''),
      at: item.at || item.created_at,
      created_at: item.created_at || item.at,
    })),
    sla_due_at: entity.sla_due_at,
    confirmed_at: entity.confirmed_at,
    created_at: entity.created_at,
    updated_at: entity.updated_at,
  }
}

function findTicket(ticketId: string): TicketEntity {
  const entity = tickets.find((item) => item.id === ticketId)
  if (!entity) fail(404, 'NOT_FOUND', '工单不存在')
  return entity
}

function save(entity: TicketEntity): TicketEntity {
  const index = tickets.findIndex((item) => item.id === entity.id)
  if (index >= 0) tickets[index] = entity
  persist()
  return entity
}

function appendProgress(entity: TicketEntity, channel: TicketProgressChannel, summary: string): void {
  entity.progress = [...entity.progress, progressItem(channel, summary, nowIso())]
}

function canManage(role: UserRole): boolean {
  return role !== 'employee' && role !== 'frontline_agent'
}

function canClaim(role: UserRole, entity: TicketEntity): boolean {
  if (role === 'admin') return true
  if (role === 'senior_after_sales' && entity.queue === 'high_risk') return true
  if (role === 'after_sales_specialist' && entity.queue !== 'high_risk') return true
  return false
}

function includesText(haystack: string | null, needle: string): boolean {
  if (!needle) return true
  if (!haystack) return false
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

function parseTime(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export function mockListTickets(
  token: string | null,
  query: TicketListQuery = {},
): MockHandlerResult<TicketListItem[] | null> {
  try {
    const actor = requireActor(token)
    if (actor.role === 'employee') fail(403, 'FORBIDDEN', '没有权限查看工单列表')

    const page = Number(query.page ?? 1)
    const pageSize = Number(query.page_size ?? 20)
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      fail(400, 'VALIDATION_ERROR', '分页参数无效')
    }
    if (query.ticket_type && !TYPE_SET.has(query.ticket_type)) fail(400, 'VALIDATION_ERROR', '工单类型无效')
    if (query.status && !STATUS_SET.has(query.status)) fail(400, 'VALIDATION_ERROR', '工单状态无效')
    if (query.urgency && !URGENCY_SET.has(query.urgency)) fail(400, 'VALIDATION_ERROR', '紧急程度无效')
    if (query.queue && !QUEUE_SET.has(query.queue)) fail(400, 'VALIDATION_ERROR', '队列无效')

    const timeFrom = parseTime(query.time_from)
    const timeTo = parseTime(query.time_to)
    if (timeFrom !== null && Number.isNaN(timeFrom)) fail(400, 'VALIDATION_ERROR', '开始时间无效')
    if (timeTo !== null && Number.isNaN(timeTo)) fail(400, 'VALIDATION_ERROR', '结束时间无效')

    const orderNo = query.order_no?.trim() ?? ''
    const ticketNo = query.ticket_no?.trim() ?? ''
    const userQuery = query.user_query?.trim() ?? ''

    let rows = tickets.filter((item) => item.status !== ('draft' as TicketListStatus))
    if (actor.role === 'frontline_agent') {
      rows = rows.filter((item) => item.origin_agent === actor.username)
    }
    if (query.ticket_type) rows = rows.filter((item) => item.ticket_type === query.ticket_type)
    if (query.status) rows = rows.filter((item) => item.status === query.status)
    if (query.urgency) rows = rows.filter((item) => item.urgency === query.urgency)
    if (query.queue) rows = rows.filter((item) => item.queue === query.queue)
    if (orderNo) rows = rows.filter((item) => includesText(item.order_no, orderNo))
    if (ticketNo) rows = rows.filter((item) => includesText(item.ticket_no, ticketNo))
    if (userQuery) rows = rows.filter((item) => includesText(item.user_name, userQuery))
    if (timeFrom !== null) {
      rows = rows.filter((item) => Date.parse(item.confirmed_at) >= timeFrom)
    }
    if (timeTo !== null) {
      rows = rows.filter((item) => Date.parse(item.confirmed_at) <= timeTo)
    }

    rows = [...rows].sort((left, right) => {
      const queueDiff = QUEUE_RANK[left.queue] - QUEUE_RANK[right.queue]
      if (queueDiff !== 0) return queueDiff
      return Date.parse(right.confirmed_at) - Date.parse(left.confirmed_at)
    })

    const totalItems = rows.length
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize) || 1)
    const start = (page - 1) * pageSize
    const items = rows.slice(start, start + pageSize).map(toListItem)
    const paginated: PaginatedEnvelope<TicketListItem[]> = {
      ...envelope(items),
      pagination: {
        page,
        page_size: pageSize,
        total_items: totalItems,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
    }
    return { status: 200, envelope: paginated }
  } catch (error) {
    if (error instanceof TicketListMockError) {
      return { status: error.status, envelope: failEnvelope(error.message, error.error_code) }
    }
    throw error
  }
}

export function mockGetTicket(token: string | null, ticketId: string): MockHandlerResult<TicketPublic | null> {
  try {
    const actor = requireActor(token)
    if (actor.role === 'employee') fail(403, 'FORBIDDEN', '没有权限查看工单')
    const entity = findTicket(ticketId)
    if (actor.role === 'frontline_agent' && entity.origin_agent !== actor.username) {
      fail(403, 'FORBIDDEN', '没有权限查看该工单')
    }
    return { status: 200, envelope: envelope(toPublic(entity)) }
  } catch (error) {
    if (error instanceof TicketListMockError) {
      return { status: error.status, envelope: failEnvelope(error.message, error.error_code) }
    }
    throw error
  }
}

export function mockClaimTicket(token: string | null, ticketId: string): MockHandlerResult<TicketPublic | null> {
  try {
    const actor = requireActor(token)
    if (actor.role === 'employee' || actor.role === 'frontline_agent') {
      fail(403, 'FORBIDDEN', '一线坐席不能把工单领去处理')
    }
    const entity = findTicket(ticketId)
    if (entity.assigned_user_id) fail(409, 'CONFLICT', '工单已有处理人')
    if (entity.status !== 'pending') fail(409, 'CONFLICT', '只能认领尚未接起的工单')
    if (actor.role === 'after_sales_specialist' && entity.queue === 'high_risk') {
      fail(409, 'CONFLICT', '售后专员不能认领高风险工单')
    }
    if (!canClaim(actor.role, entity)) fail(403, 'FORBIDDEN', '不属于该队列的角色不能认领')
    if (entity.urgency === 'vip') entity.queue = 'vip_priority'
    entity.status = 'in_progress'
    entity.assigned_user_id = actor.username
    entity.assigned_role = actor.role
    entity.assigned_display = ROLE_LABEL[actor.role] ?? actor.username
    entity.upgrade_undelivered = false
    entity.updated_at = nowIso()
    appendProgress(entity, 'status', `已认领，处理人为${entity.assigned_display}`)
    save(entity)
    return { status: 200, envelope: envelope(toPublic(entity)) }
  } catch (error) {
    if (error instanceof TicketListMockError) {
      return { status: error.status, envelope: failEnvelope(error.message, error.error_code) }
    }
    throw error
  }
}

export function mockPatchTicket(
  token: string | null,
  ticketId: string,
  payload: TicketStatusPatch,
): MockHandlerResult<TicketPublic | null> {
  try {
    const actor = requireActor(token)
    if (!canManage(actor.role)) fail(403, 'FORBIDDEN', '没有权限处理工单')
    const entity = findTicket(ticketId)
    if (entity.status === 'closed' && payload.status && payload.status !== 'closed') {
      fail(409, 'CONFLICT', '已关闭不再回到待处理')
    }
    if (payload.status === 'on_hold') {
      if (payload.hold_reason !== 'wait_user' && payload.hold_reason !== 'wait_warehouse') {
        fail(400, 'VALIDATION_ERROR', '挂起需要说明在等用户补充或等仓储确认')
      }
      entity.status = 'on_hold'
      entity.hold_reason = payload.hold_reason
      entity.updated_at = nowIso()
      appendProgress(entity, 'status', `挂起：${HOLD_REASON_LABEL[payload.hold_reason]}`)
    } else if (payload.status === 'completed') {
      entity.status = 'completed'
      entity.hold_reason = null
      entity.updated_at = nowIso()
      appendProgress(entity, 'status', '处理结果已回写，状态为已完成')
    } else if (payload.status === 'closed') {
      entity.status = 'closed'
      entity.hold_reason = null
      entity.updated_at = nowIso()
      appendProgress(entity, 'status', '用户确认已经解决，工单已关闭')
    }

    if (payload.urgency) {
      if (!URGENCY_SET.has(payload.urgency)) fail(400, 'VALIDATION_ERROR', '紧急程度无效')
      const rank = { normal: 0, vip: 1, high_risk: 2 }
      if (rank[payload.urgency] < rank[entity.urgency]) {
        fail(409, 'CONFLICT', '下调高风险必须由主管同意')
      }
      if (payload.urgency !== entity.urgency) {
        entity.urgency = payload.urgency
        entity.queue = queueForUrgency(payload.urgency)
        entity.assigned_role = roleForQueue(entity.queue)
        entity.assigned_display = ROLE_LABEL[entity.assigned_role]
        if (payload.urgency === 'high_risk') {
          entity.assigned_user_id = entity.assigned_user_id && actor.role === 'senior_after_sales'
            ? entity.assigned_user_id
            : null
          if (!entity.assigned_user_id) entity.status = entity.status === 'closed' || entity.status === 'completed' ? entity.status : 'pending'
        }
        entity.updated_at = nowIso()
        appendProgress(entity, 'urgency', `紧急程度上调为${TICKET_URGENCY_OPTIONS.find((item) => item.value === payload.urgency)?.label ?? payload.urgency}`)
      }
    }

    save(entity)
    return { status: 200, envelope: envelope(toPublic(entity)) }
  } catch (error) {
    if (error instanceof TicketListMockError) {
      return { status: error.status, envelope: failEnvelope(error.message, error.error_code) }
    }
    throw error
  }
}

export function mockApproveUrgency(
  token: string | null,
  ticketId: string,
  payload: UrgencyApprovalCreate,
): MockHandlerResult<TicketPublic | null> {
  try {
    const actor = requireActor(token)
    if (actor.role !== 'supervisor') fail(403, 'FORBIDDEN', '仅主管可以同意高风险降级')
    const entity = findTicket(ticketId)
    if (entity.urgency !== 'high_risk') fail(409, 'CONFLICT', '当前不是高风险')
    if (payload.target_urgency !== 'normal' && payload.target_urgency !== 'vip') {
      fail(400, 'VALIDATION_ERROR', '目标紧急程度无效')
    }
    if (payload.approved) {
      entity.urgency = payload.target_urgency
      entity.queue = queueForUrgency(payload.target_urgency)
      entity.assigned_role = roleForQueue(entity.queue)
      entity.assigned_display = ROLE_LABEL[entity.assigned_role]
      entity.assigned_user_id = null
      if (entity.status === 'in_progress') entity.status = 'pending'
      entity.updated_at = nowIso()
      appendProgress(
        entity,
        'urgency',
        `主管同意降级为${TICKET_URGENCY_OPTIONS.find((item) => item.value === payload.target_urgency)?.label ?? payload.target_urgency}`,
      )
    } else {
      entity.updated_at = nowIso()
      appendProgress(entity, 'urgency', '主管未同意降级，保持高风险')
    }
    save(entity)
    return { status: 200, envelope: envelope(toPublic(entity)) }
  } catch (error) {
    if (error instanceof TicketListMockError) {
      return { status: error.status, envelope: failEnvelope(error.message, error.error_code) }
    }
    throw error
  }
}
