export type TicketType =
  | 'return_exchange'
  | 'address_change'
  | 'invoice'
  | 'complaint'
  | 'fee_dispute'
  | 'logistics_exception'

export type TicketListStatus = 'pending' | 'in_progress' | 'on_hold' | 'completed' | 'closed'

export type TicketUrgency = 'normal' | 'vip' | 'high_risk'

export type TicketQueue = 'normal' | 'vip_priority' | 'high_risk'

export type TicketHoldReason = 'wait_user' | 'wait_warehouse'

export type TicketProgressChannel = 'status' | 'warehouse' | 'finance' | 'urgency'

export type TicketListQuery = {
  page?: number
  page_size?: number
  ticket_type?: TicketType
  status?: TicketListStatus
  urgency?: TicketUrgency
  order_no?: string
  user_query?: string
  ticket_no?: string
  time_from?: string
  time_to?: string
  queue?: TicketQueue
}

export type TicketListItem = {
  id: string
  ticket_no: string
  ticket_type: TicketType
  status: TicketListStatus
  urgency: TicketUrgency
  queue: TicketQueue
  order_no: string | null
  assigned_display: string
  upgrade_undelivered: boolean
  confirmed_at: string
  sla_due_at: string | null
  updated_at: string
}

export type TicketProgressItem = {
  id?: string
  created_at?: string
  summary?: string
  channel?: TicketProgressChannel
  event?: string
  at?: string
  detail?: string
}

export type TicketPublic = {
  id: string
  ticket_no: string | null
  conversation_id: string
  status: TicketListStatus
  ticket_type: TicketType
  business_line: 'digital_3c' | 'apparel_beauty'
  urgency: TicketUrgency
  queue: TicketQueue
  assigned_role: string
  assigned_user_id: string | number | null
  assigned_display: string
  upgrade_undelivered: boolean
  hold_reason?: TicketHoldReason | null
  order_no: string | null
  user_name?: string
  progress: TicketProgressItem[]
  sla_due_at: string | null
  confirmed_at: string
  created_at: string
  updated_at: string
}

export type TicketStatusPatch = {
  status?: 'on_hold' | 'completed' | 'closed'
  hold_reason?: TicketHoldReason
  urgency?: TicketUrgency
}

export type UrgencyApprovalCreate = {
  approved: boolean
  target_urgency: 'normal' | 'vip'
}

export type Pagination = {
  page: number
  page_size: number
  total_items: number
  total_pages: number
  has_next: boolean
  has_prev: boolean
}
