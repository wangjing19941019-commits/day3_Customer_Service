import type { ApiEnvelope } from '../types/api.ts'
import type {
  ConversationPublic,
  EmployeeMessageResponse,
  MessageKind,
  MessagePublic,
} from '../services/conversationService.ts'
import {
  failEnvelope,
  getEntity,
  makeMessage,
  newId,
  nowIso,
  okEnvelope,
  saveEntity,
  toConversationPublic,
  toPublicMessage,
  type ConversationEntity,
} from './conversationStore.ts'

export const FALLBACK_CONTENT =
  '抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。'

export const CLARIFICATION_QUESTION =
  '请问是哪件商品？例如连衣裙、耳机，还是订单和发票问题。'

export const FAQ_INVOICE_ANSWER =
  '开具增值税发票请提供公司抬头与税号；电子普通发票可开到个人邮箱。'

export const SMALL_TALK_ANSWER = '你好，可以问商品规格、退换货或发票规则。'

export const WAITING_FOR_AGENT_HINT = '已转交客服，请等待回复。'

export const NO_TICKET_PROGRESS_CONTENT = '目前没有可查询的工单进度。'

const TICKET_STORE_KEY = 'mock_tickets'

const RETURN_METHOD_LABEL: Record<string, string> = {
  return_only: '退货',
  exchange: '换货',
  refund_only: '仅退款',
}

type TicketFieldSnapshot = {
  value?: string | null
}

type TicketSnapshot = {
  conversation_id?: string
  status?: string
  ticket_type?: string | null
  fields?: Record<string, TicketFieldSnapshot | undefined>
}

function fieldValue(ticket: TicketSnapshot, key: string): string | null {
  const value = ticket.fields?.[key]?.value
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function readTicketSnapshot(conversationId: string): TicketSnapshot | null {
  try {
    const raw = sessionStorage.getItem(TICKET_STORE_KEY)
    if (!raw) return null
    const store = JSON.parse(raw) as Record<string, TicketSnapshot>
    return store[conversationId] ?? null
  } catch {
    return null
  }
}

export function asksTicketProgress(text: string): boolean {
  return /退款到哪|工单进度|退货进度|退款进度|开票进度|发票开好|我的退款|处理到哪了|退到哪了|开票到哪/.test(
    text,
  )
}

export function writtenProgressFor(conversationId: string): string | null {
  const ticket = readTicketSnapshot(conversationId)
  if (!ticket || !ticket.status || ticket.status === 'draft') return null

  const orderNo = fieldValue(ticket, 'order_no')
  const product = fieldValue(ticket, 'product_info')
  const orderBit = orderNo ? `订单 ${orderNo}` : null
  const productBit = product ? product : null
  const subject = [orderBit, productBit].filter(Boolean).join('，')

  if (ticket.ticket_type === 'return_exchange') {
    const method = fieldValue(ticket, 'return_method')
    const methodLabel = method ? RETURN_METHOD_LABEL[method] ?? null : null
    if (methodLabel === '换货') {
      return subject
        ? `仓储已完成收货核验。${subject} 的换货正在备货发出。`
        : '仓储已完成收货核验，换货正在备货发出。'
    }
    if (methodLabel === '仅退款') {
      return subject
        ? `仓储已受理。${subject} 的仅退款正在处理中，尚未到账。`
        : '仓储已受理，仅退款正在处理中，尚未到账。'
    }
    return subject
      ? `仓储已完成收货核验。${subject} 的退货退款正在处理中，尚未到账。`
      : '仓储已完成收货核验，退货退款正在处理中，尚未到账。'
  }

  if (ticket.ticket_type === 'invoice') {
    return subject
      ? `财务已接收开票申请，${subject} 正在开具发票。`
      : '财务已接收开票申请，正在开具发票。'
  }

  return null
}

function syncWrittenProgress(entity: ConversationEntity): void {
  const text = writtenProgressFor(entity.id)
  if (!text) return
  const exists = entity.messages.some(
    (message) => (message.kind as string) === 'ticket_progress' && message.content === text,
  )
  if (exists) return
  entity.messages.push(
    makeMessage({
      role: 'system',
      kind: 'ticket_progress' as MessageKind,
      content: text,
    }),
  )
  entity.updated_at = nowIso()
  saveEntity(entity)
}

export const APPAREL_KNOWLEDGE_ANSWER = '服饰美妆支持七天无理由退货，需商品完好'

export const DIGITAL_KNOWLEDGE_ANSWER =
  '3C 数码以签收后的质保说明为准，不适用服饰的七天无理由口径。'

const MAX_CLARIFICATION_ROUNDS = 5
const CONTENT_MAX = 4000

type RouteKind = 'clarification' | 'faq' | 'small_talk' | 'knowledge' | 'fallback'
type KnowledgeTopic = 'apparel' | 'digital'

export function buildConversationNotFound<T>(): ApiEnvelope<T> {
  return failEnvelope('会话不存在', 'NOT_FOUND')
}

export function buildMessageValidationError<T>(): ApiEnvelope<T> {
  return failEnvelope('请输入 1～4000 字的问题', 'VALIDATION_ERROR')
}

function priorEmployeeTexts(entity: ConversationEntity): string[] {
  return entity.messages.filter((message) => message.role === 'employee').map((message) => message.content)
}

function topicsFrom(text: string): KnowledgeTopic[] {
  const topics: KnowledgeTopic[] = []
  if (/连衣裙|服饰|尺码|七天|美妆/.test(text)) topics.push('apparel')
  if (/耳机|保修|充电器/.test(text)) topics.push('digital')
  return topics
}

function knowledgeTopics(text: string, prior: string[]): KnowledgeTopic[] {
  const current = topicsFrom(text)
  if (current.length > 0) return current
  if (text.length < 8 || /能退吗|可以退吗/.test(text)) {
    return topicsFrom(prior.join('\n'))
  }
  return []
}

function isSmallTalk(text: string): boolean {
  return /^(你好|您好|谢谢|哈哈|在吗|早上好|晚上好|谢谢你|谢谢您)([!！。.~]*)$/u.test(text)
}

function isOutOfScope(text: string): boolean {
  return /物流到哪|订单现在|库存还有|支付成功了没|工资|天气|股票|外卖/.test(text)
}

function isFaqHit(text: string): boolean {
  return /增值税发票|怎么开发票|开票需要/.test(text)
}

function needsClarification(text: string, prior: string[]): boolean {
  if (isSmallTalk(text) || isOutOfScope(text) || isFaqHit(text) || knowledgeTopics(text, prior).length > 0) {
    return false
  }
  return text.length < 8 || /能不能退|怎么办|不行|转人工|找人工|客服/.test(text)
}

function rewriteQuery(original: string, prior: string[]): string {
  if (isFaqHit(original)) return '询问开具发票所需资料'
  const haystack = [...prior, original].join('\n')
  const topics = knowledgeTopics(original, prior)
  if (topics.includes('apparel') && /退/.test(original)) {
    return /连衣裙/.test(haystack) ? '询问该连衣裙是否支持退货' : '询问该服饰商品是否支持退货'
  }
  if (topics.length >= 2) {
    return '咨询耳机保修与服饰退换货时限'
  }
  if (topics.includes('apparel')) return original.includes('尺码') ? '咨询服饰商品尺码' : original
  if (topics.includes('digital')) return '咨询 3C 数码质保说明'
  if (isSmallTalk(original) || isOutOfScope(original)) return original
  if (needsClarification(original, prior)) {
    return '当前问法缺少商品或订单对象，需补充后才能检索'
  }
  return original
}

function knowledgeAnswer(topics: KnowledgeTopic[]): string {
  const lines = topics.map((topic, index) => {
    const n = index + 1
    if (topic === 'apparel') {
      return topics.length > 1 ? `${n}. ${APPAREL_KNOWLEDGE_ANSWER}` : APPAREL_KNOWLEDGE_ANSWER
    }
    return topics.length > 1 ? `${n}. ${DIGITAL_KNOWLEDGE_ANSWER}` : DIGITAL_KNOWLEDGE_ANSWER
  })
  return lines.join('\n')
}

function routeMessage(text: string, prior: string[]): { kind: RouteKind; content: string } {
  if (needsClarification(text, prior)) {
    return { kind: 'clarification', content: CLARIFICATION_QUESTION }
  }
  if (isSmallTalk(text)) {
    return { kind: 'small_talk', content: SMALL_TALK_ANSWER }
  }
  if (isFaqHit(text)) {
    return { kind: 'faq', content: FAQ_INVOICE_ANSWER }
  }
  if (isOutOfScope(text)) {
    return { kind: 'fallback', content: FALLBACK_CONTENT }
  }
  const topics = knowledgeTopics(text, prior)
  if (topics.length > 0) {
    return { kind: 'knowledge', content: knowledgeAnswer(topics) }
  }
  return { kind: 'fallback', content: FALLBACK_CONTENT }
}

export function mockCreateConversation(): ApiEnvelope<ConversationPublic> {
  const timestamp = nowIso()
  const entity: ConversationEntity = {
    id: newId(),
    status: 'bot',
    clarification_round: 0,
    waiting_for_agent: false,
    messages: [],
    created_at: timestamp,
    updated_at: timestamp,
  }
  return okEnvelope(toConversationPublic(saveEntity(entity)))
}

export function mockGetConversation(conversationId: string): ApiEnvelope<ConversationPublic> {
  const entity = getEntity(conversationId)
  if (!entity) return buildConversationNotFound<ConversationPublic>()
  syncWrittenProgress(entity)
  return okEnvelope(toConversationPublic(getEntity(conversationId) ?? entity))
}

export function mockSendEmployeeMessage(
  conversationId: string,
  rawContent: string,
): ApiEnvelope<EmployeeMessageResponse> {
  const content = rawContent.trim()
  if (!content || content.length > CONTENT_MAX) {
    return buildMessageValidationError<EmployeeMessageResponse>()
  }

  const existing = getEntity(conversationId)
  if (!existing) return buildConversationNotFound<EmployeeMessageResponse>()

  const entity = existing
  const timestamp = nowIso()
  syncWrittenProgress(entity)

  if (asksTicketProgress(content)) {
    const employee = makeMessage({
      role: 'employee',
      kind: 'employee_turn',
      content,
      original_content: content,
      rewritten_content: null,
    })
    entity.messages.push(employee)
    const reply = makeMessage({
      role: 'system',
      kind: 'ticket_progress' as MessageKind,
      content: writtenProgressFor(entity.id) ?? NO_TICKET_PROGRESS_CONTENT,
    })
    entity.messages.push(reply)
    entity.updated_at = timestamp
    return okEnvelope({
      conversation: toConversationPublic(saveEntity(entity)),
      reply: toPublicMessage(reply),
    })
  }

  if (entity.status === 'handed_off') {
    const previous = entity.messages[entity.messages.length - 1]
    const employee = makeMessage({
      role: 'employee',
      kind: 'employee_turn',
      content,
      original_content: content,
      rewritten_content: null,
    })
    entity.messages.push(employee)
    entity.updated_at = timestamp
    entity.waiting_for_agent = true

    let reply: MessagePublic
    if (previous?.kind === 'waiting_for_agent') {
      reply = previous
    } else {
      reply = makeMessage({
        role: 'system',
        kind: 'waiting_for_agent',
        content: WAITING_FOR_AGENT_HINT,
      })
      entity.messages.push(reply)
    }
    return okEnvelope({ conversation: toConversationPublic(saveEntity(entity)), reply: toPublicMessage(reply) })
  }

  const prior = priorEmployeeTexts(entity)
  const rewritten = rewriteQuery(content, prior)
  const employee = makeMessage({
    role: 'employee',
    kind: 'employee_turn',
    content,
    original_content: content,
    rewritten_content: rewritten,
  })
  entity.messages.push(employee)

  const routed = routeMessage(content, prior)
  let replyKind: MessageKind = routed.kind
  let replyContent = routed.content
  let nextRound = entity.clarification_round

  if (routed.kind === 'clarification') {
    if (entity.clarification_round < MAX_CLARIFICATION_ROUNDS) {
      nextRound = entity.clarification_round + 1
    } else {
      replyKind = 'fallback'
      replyContent = FALLBACK_CONTENT
      nextRound = 0
    }
  } else {
    nextRound = 0
  }

  const reply = makeMessage({
    role: 'system',
    kind: replyKind,
    content: replyContent,
  })
  entity.messages.push(reply)
  entity.clarification_round = nextRound
  entity.updated_at = timestamp
  return okEnvelope({
    conversation: toConversationPublic(saveEntity(entity)),
    reply: toPublicMessage(reply),
  })
}

export function mockTransferConversation(conversationId: string): ApiEnvelope<ConversationPublic> {
  const existing = getEntity(conversationId)
  if (!existing) return buildConversationNotFound<ConversationPublic>()
  existing.status = 'handed_off'
  existing.waiting_for_agent = true
  existing.updated_at = nowIso()
  return okEnvelope(toConversationPublic(saveEntity(existing)))
}
