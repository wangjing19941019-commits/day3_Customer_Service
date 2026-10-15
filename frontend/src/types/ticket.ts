export type TicketType =
  | 'return_exchange'
  | 'address_change'
  | 'invoice'
  | 'complaint'
  | 'fee_dispute'
  | 'logistics_exception'

export type BusinessLine = 'digital_3c' | 'apparel_beauty'

export type TicketStatus = 'draft' | 'pending' | 'in_progress' | 'on_hold' | 'completed' | 'closed'

export type ExtractStatus = 'idle' | 'extracting' | 'ready' | 'failed'

export type FieldStatus = 'filled' | 'candidate' | 'missing' | 'conflict' | 'agent_edited'

export type Urgency = 'normal' | 'vip' | 'high_risk'

export type TicketQueue = 'normal' | 'vip_priority' | 'high_risk'

export type Visibility = 'user_visible' | 'agent_only' | 'high_risk_human_only'

export type OrderMatchStatus = 'auto_filled' | 'candidates' | 'missing' | 'query_failed'

export type OrderOrValueCandidate = {
  order_no?: string
  title?: string
  ordered_at?: string
  value?: string
  label?: string
}

export type TicketField = {
  value: string | null
  status: FieldStatus
  candidates: OrderOrValueCandidate[]
  conflict_value: string | null
}

export type OrderMatchPublic = {
  status: OrderMatchStatus
  query_message: string | null
  time_range_text: string | null
  keywords: string[]
  candidates: OrderOrValueCandidate[]
}

export type LogisticsSnapshot = {
  query_status: 'ok' | 'empty' | 'failed'
  sign_status: string | null
  note: string | null
}

export type TicketAttachment = {
  id: string
  filename: string
  created_at: string
}

export type TicketSla = {
  due_at: string
  warn_at: string
  close_after: string | null
  level: string
}

export type TicketPublic = {
  id: string
  ticket_no: string | null
  conversation_id: string
  status: TicketStatus
  ticket_type: TicketType | null
  business_line: BusinessLine | null
  urgency: Urgency | null
  queue: TicketQueue | null
  assigned_role: string | null
  assigned_user_id: string | null
  assigned_display: string | null
  upgrade_undelivered: boolean
  extract_status: ExtractStatus
  extract_error: string | null
  can_confirm: boolean
  confirm_blockers: string[]
  fields: Record<string, TicketField>
  order_match: OrderMatchPublic | null
  logistics_snapshot: LogisticsSnapshot | null
  attachments: TicketAttachment[]
  progress: unknown[]
  sla: TicketSla | null
  confirmed_at: string | null
  created_at: string
  updated_at: string
}

export type TicketUpdate = {
  ticket_type?: TicketType | null
  business_line?: BusinessLine | null
  fields?: Record<string, string | null>
}

export type KnowledgeSuggestionItem = {
  document_id: string
  filename: string
  heading_path: string
  main_answer: string
  summary: string
  source: string
  effective_from: string
  effective_to: string
  applicable_category: string
  visibility: Visibility
}

export type KnowledgeSuggestionPublic = {
  conversation_id: string
  ticket_type: TicketType | null
  business_line: BusinessLine | null
  suggestions: KnowledgeSuggestionItem[]
  empty_message: string | null
}

export type AgentPolishCreate = {
  content: string
}

export type AgentPolishPublic = {
  original_content: string
  polished_content: string
  compliance_passed: boolean
  can_adopt: boolean
  risk_reasons: string[]
}

export type ResultFeedbackCreate = {
  rating: 'useful' | 'useless'
  comment?: string
  target: 'extract' | 'knowledge' | 'polish'
}

export type ResultFeedbackPublic = {
  id: string
  conversation_id: string
  template_id: string | null
  template_version: number | null
  rating: 'useful' | 'useless'
  comment: string | null
  created_at: string
}
