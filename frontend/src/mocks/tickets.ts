import type { MessagePublic } from '../services/agentInboxService.ts'
import type { ApiEnvelope } from '../types/api.ts'
import type {
  AgentPolishCreate,
  AgentPolishPublic,
  BusinessLine,
  FieldStatus,
  KnowledgeSuggestionItem,
  KnowledgeSuggestionPublic,
  LogisticsSnapshot,
  OrderMatchPublic,
  OrderOrValueCandidate,
  ResultFeedbackCreate,
  ResultFeedbackPublic,
  TicketAttachment,
  TicketField,
  TicketPublic,
  TicketStatus,
  TicketType,
  TicketUpdate,
} from '../types/ticket.ts'
import { withMockLabel } from '../utils/mockFlag.ts'
import { MAX_UPLOAD_BYTES } from './documents.ts'
import { getEntity, newId, nowIso, okEnvelope } from './conversationStore.ts'

export const MOCK_EXTRACT_DELAY_MS = 2000
export const TICKET_EMPTY_KNOWLEDGE = '当前没有可推送的政策或流程'
export const TICKET_NO_LINE_HINT = '未指定业务线，不套用单一口径'
const STORE_KEY = 'mock_tickets'
const FEEDBACK_STORE_KEY = 'mock_result_feedbacks'
const CONTENT_MAX = 4000
const COMMENT_MAX = 500

export const TICKET_TYPES: { value: TicketType; label: string }[] = [
  { value: 'return_exchange', label: '退换货' },
  { value: 'address_change', label: '修改地址' },
  { value: 'invoice', label: '开发票' },
  { value: 'complaint', label: '投诉维权' },
  { value: 'fee_dispute', label: '费用争议' },
  { value: 'logistics_exception', label: '物流异常' },
]

export const BUSINESS_LINES: { value: BusinessLine; label: string }[] = [
  { value: 'digital_3c', label: '3C 数码' },
  { value: 'apparel_beauty', label: '服饰美妆' },
]

export const FIELD_LABELS: Record<string, string> = {
  order_no: '订单号',
  product_info: '商品信息',
  amount: '相关金额',
  intent_summary: '用户诉求摘要',
  return_method: '售后方式',
  return_reason: '退换原因',
  quantity: '数量',
  original_address: '原地址',
  new_address: '新地址',
  recipient_name: '收件人',
  phone: '联系电话',
  invoice_kind: '发票种类',
  invoice_title: '抬头',
  tax_id: '纳税人识别号',
  invoice_contact: '接收邮箱或手机',
  complaint_category: '投诉类别',
  incident_summary: '事实经过摘要',
  user_expectation: '用户期望',
  need_escalate: '是否要求升级',
  dispute_type: '争议类型',
  claimed_amount: '用户主张金额',
  platform_amount: '平台核算金额',
  diff_reason: '差异原因',
  tracking_no: '物流单号',
  exception_type: '异常类型',
  responsible_party: '责任方',
  user_request: '用户诉求',
  compensation_plan: '补偿方案',
  attachments: '证据截图',
  ticket_type: '工单类型',
  business_line: '业务线',
}

export const FIELD_STATUS_LABEL: Record<FieldStatus, string> = {
  filled: '已填',
  agent_edited: '已填',
  candidate: '待确认',
  missing: '缺失',
  conflict: '冲突',
}

export const RETURN_METHOD_OPTIONS = [
  { value: 'return_only', label: '退货' },
  { value: 'exchange', label: '换货' },
  { value: 'refund_only', label: '仅退款' },
] as const

export const INVOICE_KIND_OPTIONS = [
  { value: 'plain', label: '普通发票' },
  { value: 'vat_special', label: '专用发票' },
] as const

export const NEED_ESCALATE_OPTIONS = [
  { value: 'true', label: '是' },
  { value: 'false', label: '否' },
] as const

export const DISPUTE_TYPE_OPTIONS = [
  { value: 'price_protect', label: '价保' },
  { value: 'shipping_fee', label: '运费' },
  { value: 'refund_amount', label: '退款金额' },
] as const

export const EXCEPTION_TYPE_OPTIONS = [
  { value: 'delay', label: '延迟' },
  { value: 'lost', label: '丢件' },
  { value: 'damaged', label: '破损' },
  { value: 'wrong_or_missing', label: '错发或漏发' },
  { value: 'refused', label: '拒收' },
  { value: 'address_exception', label: '地址异常' },
] as const

export const RESPONSIBLE_PARTY_OPTIONS = [
  { value: 'courier', label: '快递' },
  { value: 'warehouse', label: '仓库' },
  { value: 'platform', label: '平台' },
] as const

const COMMON_KEYS = ['order_no', 'product_info', 'amount', 'intent_summary'] as const

const TYPE_KEYS: Record<TicketType, readonly string[]> = {
  return_exchange: [...COMMON_KEYS, 'return_method', 'return_reason', 'quantity'],
  address_change: [...COMMON_KEYS, 'original_address', 'new_address', 'recipient_name', 'phone'],
  invoice: [...COMMON_KEYS, 'invoice_kind', 'invoice_title', 'tax_id', 'invoice_contact'],
  complaint: [...COMMON_KEYS, 'complaint_category', 'incident_summary', 'user_expectation', 'need_escalate'],
  fee_dispute: [...COMMON_KEYS, 'dispute_type', 'claimed_amount', 'platform_amount', 'diff_reason'],
  logistics_exception: [
    ...COMMON_KEYS,
    'tracking_no',
    'exception_type',
    'responsible_party',
    'user_request',
    'compensation_plan',
  ],
}

const TICKET_TYPE_SET = new Set<string>(TICKET_TYPES.map((item) => item.value))
const BUSINESS_LINE_SET = new Set<string>(BUSINESS_LINES.map((item) => item.value))
const ATTACH_EXT = ['.png', '.jpg', '.jpeg', '.webp']

type MockOrder = {
  order_no: string
  title: string
  ordered_at: string
  keywords: string[]
  time_token: string
  platform_amount: string
}

const MOCK_ORDERS: MockOrder[] = [
  {
    order_no: 'JD20260922001',
    title: '蓝色手机',
    ordered_at: '2026-09-21T10:00:00.000000',
    keywords: ['蓝色', '手机'],
    time_token: '昨天',
    platform_amount: '99',
  },
  {
    order_no: 'JD20260922002',
    title: '蓝色手机（另一笔）',
    ordered_at: '2026-09-21T16:00:00.000000',
    keywords: ['蓝色', '手机'],
    time_token: '昨天',
    platform_amount: '88',
  },
  {
    order_no: 'AP20260921011',
    title: '连衣裙',
    ordered_at: '2026-09-20T09:00:00.000000',
    keywords: ['连衣裙'],
    time_token: '前天',
    platform_amount: '199',
  },
]

type TicketEntity = {
  id: string
  conversation_id: string
  status: TicketStatus
  ticket_no: string | null
  ticket_type: TicketType | null
  business_line: BusinessLine | null
  urgency: TicketPublic['urgency']
  queue: TicketPublic['queue']
  assigned_role: string | null
  assigned_user_id: string | null
  assigned_display: string | null
  upgrade_undelivered: boolean
  extract_status: TicketPublic['extract_status']
  extract_error: string | null
  fields: Record<string, TicketField>
  order_match: OrderMatchPublic | null
  logistics_snapshot: LogisticsSnapshot | null
  attachments: TicketAttachment[]
  sla: TicketPublic['sla']
  confirmed_at: string | null
  last_extracted_message_id: string | null
  created_at: string
  updated_at: string
}

const extractTimers = new Map<string, ReturnType<typeof setTimeout>>()

export class TicketMockError extends Error {
  status: number
  error_code: string
  metadata: Record<string, unknown>

  constructor(status: number, error_code: string, message: string, metadata: Record<string, unknown> = {}) {
    super(message)
    this.name = 'TicketMockError'
    this.status = status
    this.error_code = error_code
    this.metadata = metadata
  }
}

function fail(
  status: number,
  error_code: string,
  error: string,
  metadata: Record<string, unknown> = {},
): never {
  throw new TicketMockError(status, error_code, error, metadata)
}

export function keysForTicketType(ticketType: TicketType | null): readonly string[] {
  if (!ticketType) return COMMON_KEYS
  return TYPE_KEYS[ticketType]
}

function readStore(): Record<string, TicketEntity> {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, TicketEntity>
  } catch {
    return {}
  }
}

function writeStore(store: Record<string, TicketEntity>): void {
  sessionStorage.setItem(STORE_KEY, JSON.stringify(store))
}

function saveTicket(entity: TicketEntity): TicketEntity {
  const store = readStore()
  store[entity.conversation_id] = entity
  writeStore(store)
  return entity
}

function getTicketEntity(conversationId: string): TicketEntity | undefined {
  return readStore()[conversationId]
}

function emptyField(): TicketField {
  return { value: null, status: 'missing', candidates: [], conflict_value: null }
}

function normalizeField(raw: Partial<TicketField> | undefined): TicketField {
  const value = raw?.value == null || raw.value === '' ? null : raw.value
  const rawStatus = String(raw?.status ?? '')
  let status: FieldStatus
  if (rawStatus === 'extracted') status = 'filled'
  else if (rawStatus === 'incomplete') status = 'missing'
  else if (rawStatus === 'filled' || rawStatus === 'candidate' || rawStatus === 'missing' || rawStatus === 'conflict' || rawStatus === 'agent_edited') {
    status = rawStatus
  } else {
    status = value ? 'filled' : 'missing'
  }
  if (value == null && (!raw?.candidates || raw.candidates.length === 0) && status !== 'conflict') {
    status = 'missing'
  }
  return {
    value,
    status,
    candidates: raw?.candidates ?? [],
    conflict_value: raw?.conflict_value ?? null,
  }
}

function isDraft(entity: TicketEntity): boolean {
  return entity.status === 'draft'
}

function isSettled(status: FieldStatus): boolean {
  return status === 'filled' || status === 'agent_edited'
}

function confirmState(entity: TicketEntity): { can_confirm: boolean; confirm_blockers: string[] } {
  const blockers: string[] = []
  if (!isDraft(entity)) return { can_confirm: false, confirm_blockers: blockers }
  if (!entity.ticket_type || !TICKET_TYPE_SET.has(entity.ticket_type)) blockers.push('ticket_type')
  if (!entity.business_line) blockers.push('business_line')
  for (const key of keysForTicketType(entity.ticket_type)) {
    const field = normalizeField(entity.fields[key])
    const requiredTax = entity.ticket_type === 'invoice' && entity.fields.invoice_kind?.value === 'vat_special'
    if (key === 'tax_id' && !requiredTax && !field.value) continue
    if (!isSettled(field.status) || field.status === 'candidate' || field.status === 'conflict') {
      if (!blockers.includes(key)) blockers.push(key)
    }
  }
  if (entity.ticket_type === 'fee_dispute' && entity.attachments.length === 0) {
    blockers.push('attachments')
  }
  return { can_confirm: blockers.length === 0, confirm_blockers: blockers }
}

function toTicketPublic(entity: TicketEntity): TicketPublic {
  const keys = keysForTicketType(entity.ticket_type)
  const fields: Record<string, TicketField> = {}
  for (const key of keys) {
    fields[key] = normalizeField(entity.fields[key])
  }
  const { can_confirm, confirm_blockers } = confirmState(entity)
  return {
    id: entity.id,
    ticket_no: entity.ticket_no,
    conversation_id: entity.conversation_id,
    status: String(entity.status) === 'confirmed' ? 'in_progress' : entity.status,
    ticket_type: entity.ticket_type,
    business_line: entity.business_line,
    urgency: entity.urgency,
    queue: entity.queue,
    assigned_role: entity.assigned_role,
    assigned_user_id: entity.assigned_user_id,
    assigned_display: entity.assigned_display,
    upgrade_undelivered: entity.upgrade_undelivered,
    extract_status: entity.extract_status,
    extract_error: entity.extract_error,
    can_confirm,
    confirm_blockers,
    fields,
    order_match: entity.order_match,
    logistics_snapshot: entity.logistics_snapshot,
    attachments: entity.attachments,
    progress: [],
    sla: entity.sla,
    confirmed_at: entity.confirmed_at,
    created_at: entity.created_at,
    updated_at: entity.updated_at,
  }
}

function requireHandedOff(conversationId: string) {
  const conversation = getEntity(conversationId)
  if (!conversation) fail(404, 'NOT_FOUND', '会话不存在')
  if (conversation.status !== 'handed_off') {
    fail(409, 'CONFLICT', '会话尚未转人工，不能填单')
  }
  return conversation
}

function ensureDraft(conversationId: string): TicketEntity {
  const existing = getTicketEntity(conversationId)
  if (existing) {
    if (String(existing.status) === 'confirmed') existing.status = 'in_progress'
    return existing
  }
  const timestamp = nowIso()
  return saveTicket({
    id: `tkt_${newId()}`,
    conversation_id: conversationId,
    status: 'draft',
    ticket_no: null,
    ticket_type: null,
    business_line: null,
    urgency: null,
    queue: null,
    assigned_role: null,
    assigned_user_id: null,
    assigned_display: null,
    upgrade_undelivered: false,
    extract_status: 'idle',
    extract_error: null,
    fields: {},
    order_match: null,
    logistics_snapshot: null,
    attachments: [],
    sla: null,
    confirmed_at: null,
    last_extracted_message_id: null,
    created_at: timestamp,
    updated_at: timestamp,
  })
}

function lastMessageId(messages: MessagePublic[]): string | null {
  if (messages.length === 0) return null
  return messages[messages.length - 1].id
}

function corpus(messages: MessagePublic[]): string {
  return messages.map((message) => message.content).join('\n')
}

function lastEmployeeText(messages: MessagePublic[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'employee') return messages[index].content
  }
  return ''
}

type GuessedField = {
  value: string | null
  confidence: 'high' | 'low'
}

function guessed(value: string | null | undefined, confidence: 'high' | 'low' = 'high'): GuessedField {
  if (value == null || value === '') return { value: null, confidence: 'high' }
  return { value, confidence }
}

function detectTimeRange(text: string): string | null {
  if (/昨天/.test(text)) return '昨天'
  if (/今天/.test(text)) return '今天'
  if (/前天/.test(text)) return '前天'
  const range = text.match(/(\d{1,2}月\d{1,2}日)/)
  return range ? range[1] : null
}

function matchOrders(text: string): OrderMatchPublic {
  const timeRange = detectTimeRange(text)
  const keywords: string[] = []
  if (/蓝色/.test(text)) keywords.push('蓝色')
  if (/手机/.test(text)) keywords.push('手机')
  if (/连衣裙/.test(text)) keywords.push('连衣裙')

  if (/查不到|无法查询|暂时无法|暂时查不到/.test(text)) {
    return {
      status: 'query_failed',
      query_message: '暂未查到',
      time_range_text: timeRange,
      keywords,
      candidates: [],
    }
  }

  let hits = MOCK_ORDERS.filter((order) => order.keywords.every((word) => text.includes(word)))
  if (timeRange) {
    hits = hits.filter((order) => order.time_token === timeRange)
  }

  if (/两笔|两条/.test(text) && /蓝色/.test(text) && /手机/.test(text)) {
    hits = MOCK_ORDERS.filter((order) => order.keywords.includes('手机') && order.time_token === (timeRange ?? '昨天'))
  } else if (hits.length > 1) {
    hits = hits.slice(0, 1)
  }

  const candidates: OrderOrValueCandidate[] = hits.map((order) => ({
    order_no: order.order_no,
    title: order.title,
    ordered_at: order.ordered_at,
    value: order.order_no,
    label: `${order.order_no} · ${order.title}`,
  }))

  if (candidates.length === 1) {
    return {
      status: 'auto_filled',
      query_message: null,
      time_range_text: timeRange,
      keywords,
      candidates,
    }
  }
  if (candidates.length > 1) {
    return {
      status: 'candidates',
      query_message: null,
      time_range_text: timeRange,
      keywords,
      candidates,
    }
  }
  return {
    status: 'missing',
    query_message: keywords.length > 0 || timeRange ? '暂未查到' : null,
    time_range_text: timeRange,
    keywords,
    candidates: [],
  }
}

function guessFields(messages: MessagePublic[], ticketType: TicketType | null): Record<string, GuessedField> {
  const text = corpus(messages)
  const lastUser = lastEmployeeText(messages)
  const guessedFields: Record<string, GuessedField> = {}
  for (const key of keysForTicketType(ticketType)) {
    guessedFields[key] = guessed(null)
  }

  const explicitOrder = text.match(/订单号?\s*[:：]?\s*([A-Za-z0-9-]{6,})/) ?? text.match(/\b(JD\d{6,}|AP\d{6,})\b/i)
  if (explicitOrder) guessedFields.order_no = guessed(explicitOrder[1], 'high')

  if (/连衣裙/.test(text)) guessedFields.product_info = guessed('连衣裙')
  else if (/耳机/.test(text)) guessedFields.product_info = guessed('耳机')
  else if (/黑色手机/.test(text)) guessedFields.product_info = guessed('黑色手机')
  else if (/蓝色手机|蓝色.{0,4}手机/.test(text)) guessedFields.product_info = guessed('蓝色手机')
  else if (/手机/.test(text)) guessedFields.product_info = guessed('手机', 'low')

  const amounts = [...text.matchAll(/((?:大概|大约|左右)?\s*)(\d+(?:\.\d+)?)\s*元/g)]
  if (amounts.length > 0) {
    const last = amounts[amounts.length - 1]
    const vague = /大概|大约|左右/.test(last[0])
    guessedFields.amount = guessed(last[2], vague ? 'low' : 'high')
  }

  if (lastUser) guessedFields.intent_summary = guessed(lastUser.slice(0, 40))

  if (ticketType === 'return_exchange') {
    if (/换货/.test(text)) guessedFields.return_method = guessed('exchange')
    else if (/仅退款|只退款/.test(text)) guessedFields.return_method = guessed('refund_only')
    else if (/退货|能退|退换/.test(text)) guessedFields.return_method = guessed('return_only')
    if (/划痕|屏幕/.test(text)) guessedFields.return_reason = guessed('屏幕有划痕')
    else if (/质量/.test(text)) guessedFields.return_reason = guessed('质量问题')
    const qty = text.match(/(\d+)\s*[件个台]/)
    if (qty) guessedFields.quantity = guessed(qty[1])
  }

  if (ticketType === 'address_change') {
    const original = text.match(/原地址[:：]?\s*([^\n。]{6,})/)
    if (original) guessedFields.original_address = guessed(original[1].trim())
    const next = text.match(/新地址[:：]?\s*([^\n。]{6,})/)
    if (next) {
      guessedFields.new_address = guessed(next[1].trim())
    } else {
      const city = text.match(/((?:北京|上海|广州|深圳|杭州|成都|武汉|南京|西安)[^\n。]{4,})/)
      if (city && /改地址|修改地址|新地址/.test(text)) guessedFields.new_address = guessed(city[1].trim())
    }
    const recipient = text.match(/收件人[:：]?\s*([^\n。]{1,20})/)
    if (recipient) guessedFields.recipient_name = guessed(recipient[1].trim())
    const phone = text.match(/1[3-9]\d{9}/)
    if (phone) guessedFields.phone = guessed(phone[0])
  }

  if (ticketType === 'invoice') {
    if (/专票|专用发票/.test(text)) guessedFields.invoice_kind = guessed('vat_special')
    else if (/发票/.test(text)) guessedFields.invoice_kind = guessed('plain')
    const title = text.match(/抬头[:：]?\s*([^\n。]{2,40})/)
    if (title) guessedFields.invoice_title = guessed(title[1].trim())
    const tax = text.match(/税号[:：]?\s*([A-Za-z0-9]{15,20})/)
    if (tax) guessedFields.tax_id = guessed(tax[1])
    const contact = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/) ?? text.match(/1[3-9]\d{9}/)
    if (contact) guessedFields.invoice_contact = guessed(contact[0])
  }

  if (ticketType === 'complaint') {
    if (/态度|服务/.test(text)) guessedFields.complaint_category = guessed('服务态度')
    else if (/质量/.test(text)) guessedFields.complaint_category = guessed('商品质量')
    else if (/投诉|维权/.test(text)) guessedFields.complaint_category = guessed('售后维权')
    if (lastUser) guessedFields.incident_summary = guessed(lastUser.slice(0, 80))
    const expect = text.match(/希望[:：]?\s*([^\n。]{2,40})/)
    if (expect) guessedFields.user_expectation = guessed(expect[1].trim())
    if (/升级/.test(text)) guessedFields.need_escalate = guessed('true')
  }

  if (ticketType === 'fee_dispute') {
    if (/价保/.test(text)) guessedFields.dispute_type = guessed('price_protect')
    else if (/运费/.test(text)) guessedFields.dispute_type = guessed('shipping_fee')
    else if (/退款/.test(text)) guessedFields.dispute_type = guessed('refund_amount')
    const claimed = text.match(/主张[:：]?\s*(\d+(?:\.\d+)?)元/) ?? text.match(/要退\s*(\d+(?:\.\d+)?)元/)
    if (claimed) guessedFields.claimed_amount = guessed(claimed[1])
    else if (amounts.length > 0) guessedFields.claimed_amount = guessed(amounts[amounts.length - 1][2])
    const diff = text.match(/差异[:：]?\s*([^\n。]{2,40})/)
    if (diff) guessedFields.diff_reason = guessed(diff[1].trim())
    else if (/价保|运费|退款金额/.test(text)) guessedFields.diff_reason = guessed('用户主张与核算不一致')
  }

  if (ticketType === 'logistics_exception') {
    const tracking = text.match(/物流单号[:：]?\s*([A-Za-z0-9]{8,})/) ?? text.match(/\b(SF\d{8,}|YT\d{8,})\b/)
    if (tracking) guessedFields.tracking_no = guessed(tracking[1])
    if (/延迟|太慢/.test(text)) guessedFields.exception_type = guessed('delay')
    else if (/丢了|丢件/.test(text)) guessedFields.exception_type = guessed('lost')
    else if (/破损/.test(text)) guessedFields.exception_type = guessed('damaged')
    else if (/错发|漏发/.test(text)) guessedFields.exception_type = guessed('wrong_or_missing')
    else if (/拒收/.test(text)) guessedFields.exception_type = guessed('refused')
    else if (/地址异常|寄错地址/.test(text)) guessedFields.exception_type = guessed('address_exception')
    if (lastUser) guessedFields.user_request = guessed(lastUser.slice(0, 40))
  }

  return guessedFields
}

function applyGuess(current: TicketField | undefined, next: GuessedField): TicketField {
  const base = normalizeField(current)
  if (!next.value) {
    return base.value || base.candidates.length > 0 ? base : emptyField()
  }
  if (base.status === 'agent_edited') {
    if (next.value !== base.value) {
      return { ...base, status: 'conflict', conflict_value: next.value }
    }
    return base
  }
  if (next.confidence === 'low') {
    const candidates = [{ value: next.value, label: next.value }]
    if (isSettled(base.status) && base.value) {
      return { ...base, candidates }
    }
    return { value: null, status: 'candidate', candidates, conflict_value: null }
  }
  if (isSettled(base.status) && base.value && base.value !== next.value) {
    return {
      value: base.value,
      status: 'conflict',
      candidates: [],
      conflict_value: next.value,
    }
  }
  if (base.status === 'missing' || !base.value || base.value === next.value) {
    return { value: next.value, status: 'filled', candidates: [], conflict_value: null }
  }
  return base
}

function applyOrderMatch(entity: TicketEntity, match: OrderMatchPublic): void {
  entity.order_match = match
  const current = normalizeField(entity.fields.order_no)
  if (current.status === 'agent_edited') return
  if (match.status === 'auto_filled' && match.candidates[0]?.order_no) {
    const nextValue = match.candidates[0].order_no
    if (isSettled(current.status) && current.value && current.value !== nextValue) {
      entity.fields.order_no = {
        value: current.value,
        status: 'conflict',
        candidates: match.candidates,
        conflict_value: nextValue,
      }
      return
    }
    entity.fields.order_no = {
      value: nextValue,
      status: 'filled',
      candidates: match.candidates,
      conflict_value: null,
    }
    return
  }
  if (match.status === 'candidates') {
    entity.fields.order_no = {
      value: null,
      status: 'candidate',
      candidates: match.candidates,
      conflict_value: null,
    }
    return
  }
  if (isSettled(current.status) && current.value) return
  entity.fields.order_no = emptyField()
}

function lookupPlatformAmount(orderNo: string | null): string | null {
  if (!orderNo) return null
  return MOCK_ORDERS.find((item) => item.order_no === orderNo)?.platform_amount ?? null
}

function applyLogistics(entity: TicketEntity, text: string): void {
  if (entity.ticket_type !== 'logistics_exception') {
    entity.logistics_snapshot = null
    return
  }
  if (/查不到轨迹|轨迹暂未|暂时查不到/.test(text)) {
    entity.logistics_snapshot = {
      query_status: 'failed',
      sign_status: null,
      note: '物流轨迹暂时查不到，不能判断责任方。',
    }
    entity.fields.responsible_party = emptyField()
    entity.fields.compensation_plan = emptyField()
    return
  }
  if (/丢了|丢件/.test(text)) {
    entity.logistics_snapshot = {
      query_status: 'ok',
      sign_status: 'signed',
      note: '用户说快递丢了；轨迹显示已签收。不能把丢件当成已确定事实。',
    }
    entity.fields.responsible_party = emptyField()
    entity.fields.compensation_plan = emptyField()
    return
  }
  entity.logistics_snapshot = {
    query_status: 'ok',
    sign_status: 'in_transit',
    note: null,
  }
}

function mergeExtracted(
  entity: TicketEntity,
  guessedFields: Record<string, GuessedField>,
  messages: MessagePublic[],
): void {
  const text = corpus(messages)
  for (const [key, next] of Object.entries(guessedFields)) {
    if (key === 'order_no') continue
    if (key === 'responsible_party' || key === 'compensation_plan') continue
    if (key === 'platform_amount') continue
    entity.fields[key] = applyGuess(entity.fields[key], next)
  }
  applyOrderMatch(entity, matchOrders(text))
  if (entity.ticket_type === 'fee_dispute') {
    const orderNo = entity.fields.order_no?.value ?? null
    const platform = lookupPlatformAmount(orderNo)
    const current = normalizeField(entity.fields.platform_amount)
    if (current.status !== 'agent_edited') {
      entity.fields.platform_amount = platform
        ? { value: platform, status: 'filled', candidates: [], conflict_value: null }
        : emptyField()
    }
  }
  applyLogistics(entity, text)
}

function finishExtract(conversationId: string): void {
  const entity = getTicketEntity(conversationId)
  if (!entity || !isDraft(entity)) return
  if (!entity.ticket_type || !TICKET_TYPE_SET.has(entity.ticket_type)) {
    entity.extract_status = 'idle'
    saveTicket(entity)
    return
  }
  const conversation = getEntity(conversationId)
  if (!conversation || conversation.status !== 'handed_off') return
  mergeExtracted(entity, guessFields(conversation.messages, entity.ticket_type), conversation.messages)
  entity.extract_status = 'ready'
  entity.extract_error = null
  entity.last_extracted_message_id = lastMessageId(conversation.messages)
  entity.updated_at = nowIso()
  saveTicket(entity)
}

function scheduleExtract(entity: TicketEntity): void {
  if (!isDraft(entity) || !entity.ticket_type) return
  entity.extract_status = 'extracting'
  entity.extract_error = null
  entity.updated_at = nowIso()
  saveTicket(entity)
  const previous = extractTimers.get(entity.conversation_id)
  if (previous) clearTimeout(previous)
  const timer = setTimeout(() => {
    extractTimers.delete(entity.conversation_id)
    finishExtract(entity.conversation_id)
  }, MOCK_EXTRACT_DELAY_MS)
  extractTimers.set(entity.conversation_id, timer)
}

function maybeScheduleExtract(entity: TicketEntity, messages: MessagePublic[]): void {
  if (!isDraft(entity)) return
  if (!entity.ticket_type) {
    entity.extract_status = 'idle'
    return
  }
  if (entity.extract_status === 'extracting') return
  const currentLast = lastMessageId(messages)
  if (entity.extract_status === 'ready' && entity.last_extracted_message_id === currentLast) return
  scheduleExtract(entity)
}

function normalizeOptionalEnum<T extends string>(value: unknown, allowed: Set<string>): T | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || !allowed.has(value)) {
    fail(400, 'VALIDATION_ERROR', '工单字段无效')
  }
  return value as T
}

function logisticsLocked(entity: TicketEntity): boolean {
  return entity.ticket_type === 'logistics_exception' && entity.logistics_snapshot?.query_status !== 'ok'
}

export function handleGetTicket(conversationId: string): ApiEnvelope<TicketPublic> {
  const conversation = requireHandedOff(conversationId)
  const entity = ensureDraft(conversationId)
  maybeScheduleExtract(entity, conversation.messages)
  return okEnvelope(toTicketPublic(getTicketEntity(conversationId) ?? entity))
}

export function handlePatchTicket(conversationId: string, payload: TicketUpdate): ApiEnvelope<TicketPublic> {
  requireHandedOff(conversationId)
  const entity = ensureDraft(conversationId)
  let typeChanged = false

  if ('ticket_type' in payload) {
    if (!isDraft(entity)) {
      fail(409, 'CONFLICT', '工单已确认，不能更改工单类型')
    }
    const nextType = normalizeOptionalEnum<TicketType>(payload.ticket_type, TICKET_TYPE_SET)
    if (nextType !== entity.ticket_type) {
      entity.ticket_type = nextType
      typeChanged = true
    }
  }

  if ('business_line' in payload) {
    entity.business_line = normalizeOptionalEnum<BusinessLine>(payload.business_line, BUSINESS_LINE_SET)
  }

  if (payload.fields) {
    const allowed = new Set(keysForTicketType(entity.ticket_type))
    for (const [key, raw] of Object.entries(payload.fields)) {
      if (!allowed.has(key)) {
        fail(400, 'VALIDATION_ERROR', '工单字段无效')
      }
      if ((key === 'responsible_party' || key === 'compensation_plan') && logisticsLocked(entity) && raw) {
        fail(409, 'CONFLICT', '物流轨迹暂未核实，不能填写责任方或补偿方案')
      }
      const value = raw == null || raw === '' ? null : raw
      entity.fields[key] =
        value == null ? emptyField() : { value, status: 'agent_edited', candidates: [], conflict_value: null }
    }
  }

  if (!entity.ticket_type) {
    entity.extract_status = 'idle'
    entity.extract_error = null
  }

  entity.updated_at = nowIso()
  saveTicket(entity)

  if (isDraft(entity) && entity.ticket_type && (typeChanged || entity.extract_status === 'idle')) {
    scheduleExtract(entity)
  }

  return okEnvelope(toTicketPublic(getTicketEntity(conversationId) ?? entity))
}

function makeTicketNo(): string {
  const stamp = nowIso().slice(0, 10).replaceAll('-', '')
  return `TKT-${stamp}-${newId().slice(0, 4).toUpperCase()}`
}

export function handleConfirmTicket(conversationId: string): ApiEnvelope<TicketPublic> {
  requireHandedOff(conversationId)
  const entity = ensureDraft(conversationId)
  if (!isDraft(entity)) {
    return okEnvelope(toTicketPublic(entity))
  }
  const { can_confirm, confirm_blockers } = confirmState(entity)
  if (confirm_blockers.includes('ticket_type')) {
    fail(409, 'CONFLICT', '请先选择售后工单类型', { confirm_blockers })
  }
  if (confirm_blockers.includes('business_line')) {
    fail(409, 'CONFLICT', '请先选择业务线', { confirm_blockers })
  }
  if (confirm_blockers.includes('attachments')) {
    fail(409, 'CONFLICT', '费用争议需要证据截图', { confirm_blockers })
  }
  if (!can_confirm) {
    const labels = confirm_blockers.map((key) => FIELD_LABELS[key] ?? key).join('、')
    fail(409, 'CONFLICT', `存在未落实字段：${labels}`, { confirm_blockers })
  }
  const timer = extractTimers.get(conversationId)
  if (timer) {
    clearTimeout(timer)
    extractTimers.delete(conversationId)
  }
  const confirmedAt = nowIso()
  entity.status = 'in_progress'
  entity.ticket_no = makeTicketNo()
  entity.extract_status = 'ready'
  entity.confirmed_at = confirmedAt
  entity.updated_at = confirmedAt
  entity.urgency = 'normal'
  entity.queue = 'normal'
  entity.assigned_role = 'after_sales_specialist'
  entity.assigned_user_id = 'usr_mock_agent'
  entity.assigned_display = withMockLabel('售后专员')
  entity.sla = {
    due_at: confirmedAt,
    warn_at: confirmedAt,
    close_after: confirmedAt,
    level: 'normal',
  }
  saveTicket(entity)
  return okEnvelope(toTicketPublic(entity))
}

function attachmentExt(name: string): string {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

export function handleUploadTicketAttachment(
  conversationId: string,
  file: { name: string; size: number; type?: string },
): ApiEnvelope<TicketPublic> {
  requireHandedOff(conversationId)
  const entity = ensureDraft(conversationId)
  if (!ATTACH_EXT.includes(attachmentExt(file.name)) || file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    fail(400, 'VALIDATION_ERROR', '请重新上传')
  }
  entity.attachments = [
    ...entity.attachments,
    { id: `att_${newId()}`, filename: withMockLabel(file.name), created_at: nowIso() },
  ]
  entity.updated_at = nowIso()
  saveTicket(entity)
  return okEnvelope(toTicketPublic(entity))
}

function knowledgeCatalog(): KnowledgeSuggestionItem[] {
  return [
    {
      document_id: 'doc_apparel_return',
      filename: '服饰美妆退换货政策.md',
      heading_path: '服饰美妆退换货政策 / 七天无理由',
      main_answer: '签收后七日内可无理由退货，吊牌完整、不影响二次销售。',
      summary: '服饰美妆七天无理由，不适用于 3C 质保。',
      source: '服饰美妆退换货政策.md / 七天无理由',
      effective_from: '2026-01-01T00:00:00.000000',
      effective_to: '2026-12-31T23:59:59.000000',
      applicable_category: '服饰美妆',
      visibility: 'user_visible',
    },
    {
      document_id: 'doc_3c_warranty',
      filename: '3C数码质保与退换.md',
      heading_path: '3C数码质保与退换 / 质保',
      main_answer: '以签收后的保修说明为准，非人为损坏可保修或只换不修。',
      summary: '3C 按质保处理，不适用服饰七天无理由。',
      source: '3C数码质保与退换.md / 质保',
      effective_from: '2026-01-01T00:00:00.000000',
      effective_to: '2026-12-31T23:59:59.000000',
      applicable_category: '3C数码',
      visibility: 'agent_only',
    },
    {
      document_id: 'doc_apparel_faq',
      filename: '服饰美妆常见问题.md',
      heading_path: '服饰美妆常见问题 / 尺码怎么选',
      main_answer: '优先核对尺码、材质与退换政策。',
      summary: '服饰售前口径，不引用 3C 保修年限。',
      source: '服饰美妆常见问题.md / 尺码怎么选',
      effective_from: '2026-03-01T00:00:00.000000',
      effective_to: '2026-12-31T23:59:59.000000',
      applicable_category: '服饰美妆',
      visibility: 'user_visible',
    },
    {
      document_id: 'doc_3c_faq',
      filename: '3C数码常见问题.md',
      heading_path: '3C数码常见问题 / 规格核对',
      main_answer: '优先核对规格、兼容与质保。',
      summary: '3C 售前口径，不引用服饰七天无理由。',
      source: '3C数码常见问题.md / 规格核对',
      effective_from: '2026-03-01T00:00:00.000000',
      effective_to: '2026-12-31T23:59:59.000000',
      applicable_category: '3C数码',
      visibility: 'user_visible',
    },
    {
      document_id: 'doc_expired_return',
      filename: '过期退货政策.md',
      heading_path: '过期退货政策 / 旧七天',
      main_answer: '旧政策已过期，不得作为当前依据。',
      summary: '过期篇。',
      source: '过期退货政策.md / 旧七天',
      effective_from: '2024-01-01T00:00:00.000000',
      effective_to: '2025-12-31T23:59:59.000000',
      applicable_category: '服饰美妆',
      visibility: 'user_visible',
    },
  ]
}

function inEffect(item: KnowledgeSuggestionItem, now = Date.now()): boolean {
  if (!item.effective_from || !item.effective_to) return false
  const from = Date.parse(item.effective_from)
  const to = Date.parse(item.effective_to)
  return Number.isFinite(from) && Number.isFinite(to) && now >= from && now <= to
}

function knowledgeItems(entity: TicketEntity): KnowledgeSuggestionItem[] {
  const all = knowledgeCatalog().filter((item) => inEffect(item))
  if (!entity.business_line) return []
  if (entity.ticket_type === 'complaint') return []
  const lineCategory = entity.business_line === 'apparel_beauty' ? '服饰美妆' : '3C数码'
  return all.filter((item) => item.applicable_category === lineCategory)
}

function labelItem(item: KnowledgeSuggestionItem): KnowledgeSuggestionItem {
  return {
    ...item,
    filename: withMockLabel(item.filename),
    heading_path: withMockLabel(item.heading_path),
    main_answer: withMockLabel(item.main_answer),
    summary: withMockLabel(item.summary),
    source: withMockLabel(item.source),
  }
}

export function handleKnowledgeSuggestions(
  conversationId: string,
  q?: string,
): ApiEnvelope<KnowledgeSuggestionPublic> {
  requireHandedOff(conversationId)
  const entity = ensureDraft(conversationId)
  const query = q?.trim().toLowerCase() ?? ''
  let suggestions = knowledgeItems(entity)
  if (query) {
    suggestions = suggestions.filter((item) =>
      `${item.main_answer}${item.summary}${item.source}${item.heading_path}`.toLowerCase().includes(query),
    )
  }
  const labeled = suggestions.map(labelItem)
  return okEnvelope({
    conversation_id: conversationId,
    ticket_type: entity.ticket_type,
    business_line: entity.business_line,
    suggestions: labeled,
    empty_message: labeled.length === 0 ? TICKET_EMPTY_KNOWLEDGE : null,
  })
}

function sessionHasAnger(messages: MessagePublic[]): boolean {
  return messages.some(
    (message) => message.role === 'employee' && /气死|愤怒|太差|投诉|烦死|受不了/.test(message.content),
  )
}

function collectFacts(text: string): { amounts: string[]; days: string[]; policies: string[] } {
  return {
    amounts: [...text.matchAll(/(\d+(?:\.\d+)?)\s*元/g)].map((item) => item[1]),
    days: [...text.matchAll(/(\d+)\s*天/g)].map((item) => item[1]),
    policies: [...text.matchAll(/七天无理由|质保|保修/g)].map((item) => item[0]),
  }
}

function polishText(original: string, entity: TicketEntity, angry: boolean, sessionText: string): string {
  let body = original.trim()
  if (entity.business_line === 'digital_3c') {
    body = body.replace(/七天无理由/g, '保修与售后政策')
  }
  if (/一定全额退|一定退|赔\d+|保证退/.test(original)) {
    return body
  }
  const toneLead = angry
    ? '已记录您的不满，我们会按规则说明限制和下一步。'
    : '您好，已了解您希望办理的事项。'
  const facts = collectFacts(`${original}\n${sessionText}`)
  if (entity.ticket_type === 'complaint') {
    return `${toneLead}${body.replace(/。?$/, '。')}我们会按投诉处理流程说明下一步，而不会给出未确认的时限或赔付。`
  }
  if (/退不了|超时间/.test(body)) {
    const dayText = facts.days.length
      ? `仍按超过 ${facts.days[0]} 天无理由处理，不能直接退货。`
      : '已超过可退时效，不能直接退货。'
    return `${toneLead}原稿表达较生硬，整理如下：当前${dayText}可以继续看其他办法。`
  }
  return `${toneLead}${body.replace(/。?$/, '。')}请补充必要信息，我们会按现有规则帮您登记。`
}

export function handlePolishReply(
  conversationId: string,
  payload: AgentPolishCreate,
): ApiEnvelope<AgentPolishPublic> {
  const conversation = getEntity(conversationId)
  if (!conversation) fail(404, 'NOT_FOUND', '会话不存在')
  if (conversation.status !== 'handed_off') {
    fail(409, 'CONFLICT', '会话尚未转人工，无法润色')
  }
  const content = typeof payload.content === 'string' ? payload.content.trim() : ''
  if (!content) fail(400, 'VALIDATION_ERROR', '请输入回复内容')
  if (content.length > CONTENT_MAX) fail(400, 'VALIDATION_ERROR', '回复内容不能超过 4000 字')
  const entity = ensureDraft(conversationId)
  const angry = sessionHasAnger(conversation.messages)
  const polished = polishText(content, entity, angry, corpus(conversation.messages))
  const sessionText = `${content}\n${corpus(conversation.messages)}`
  const originalFacts = collectFacts(sessionText)
  const polishedFacts = collectFacts(polished)
  const riskReasons: string[] = []
  const newAmount = polishedFacts.amounts.find((item) => !originalFacts.amounts.includes(item))
  if (newAmount) riskReasons.push('润色稿新增了会话中不存在的赔付金额')
  if (/一定(全额)?退|保证退|必须退/.test(polished) && !/一定(全额)?退|保证退|必须退/.test(sessionText.replace(content, ''))) {
    if (!riskReasons.includes('润色稿新增了会话中不存在的赔付金额')) {
      riskReasons.push('润色稿出现会话中未承诺的「一定退」类表述')
    }
  }
  const changedDay = originalFacts.days.find((day) => !polishedFacts.days.includes(day))
  if (changedDay) riskReasons.push('润色稿改变了原稿或会话中的时效')
  const highRiskType =
    entity.ticket_type === 'fee_dispute' || entity.ticket_type === 'logistics_exception' || entity.urgency === 'high_risk'
  if (highRiskType && newAmount) {
    if (!riskReasons.includes('润色稿新增了会话中不存在的赔付金额')) {
      riskReasons.push('润色稿新增了会话中不存在的赔付金额')
    }
  }
  const passed = riskReasons.length === 0
  return okEnvelope({
    original_content: withMockLabel(content),
    polished_content: withMockLabel(polished),
    compliance_passed: passed,
    can_adopt: passed,
    risk_reasons: riskReasons,
  })
}

function readFeedbackStore(): ResultFeedbackPublic[] {
  try {
    const raw = sessionStorage.getItem(FEEDBACK_STORE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as ResultFeedbackPublic[]
  } catch {
    return []
  }
}

export function handleResultFeedback(
  conversationId: string,
  payload: ResultFeedbackCreate,
): ApiEnvelope<ResultFeedbackPublic> {
  const conversation = getEntity(conversationId)
  if (!conversation) fail(404, 'NOT_FOUND', '会话不存在')
  if (conversation.status !== 'handed_off') {
    fail(409, 'CONFLICT', '会话尚未转人工')
  }
  if (payload.rating !== 'useful' && payload.rating !== 'useless') {
    fail(400, 'VALIDATION_ERROR', '反馈无效')
  }
  if (payload.target !== 'extract' && payload.target !== 'knowledge' && payload.target !== 'polish') {
    fail(400, 'VALIDATION_ERROR', '反馈无效')
  }
  const comment = payload.comment?.trim() ?? ''
  if (comment.length > COMMENT_MAX) fail(400, 'VALIDATION_ERROR', '说明不能超过 500 字')
  const record: ResultFeedbackPublic = {
    id: `fb_${newId()}`,
    conversation_id: conversationId,
    template_id: 'tmpl_mock_current',
    template_version: 1,
    rating: payload.rating,
    comment: comment || null,
    created_at: nowIso(),
  }
  const store = readFeedbackStore()
  store.push(record)
  sessionStorage.setItem(FEEDBACK_STORE_KEY, JSON.stringify(store))
  return okEnvelope(record)
}
