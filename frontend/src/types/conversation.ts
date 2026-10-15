export type MessageRole = 'employee' | 'system' | 'agent'

export type MessageKind =
  | 'employee_turn'
  | 'clarification'
  | 'faq'
  | 'small_talk'
  | 'knowledge'
  | 'fallback'
  | 'waiting_for_agent'
  | 'agent'
  | 'ticket_progress'

export type MessagePublic = {
  id: string
  role: MessageRole
  kind: MessageKind
  content: string
  original_content: string | null
  rewritten_content: string | null
  created_at: string
}

export type ConversationPublic = {
  id: string
  status: 'bot' | 'handed_off'
  clarification_round: number
  waiting_for_agent: boolean
  messages: MessagePublic[]
  created_at: string
  updated_at: string
}

export type EmployeeMessageResponse = {
  conversation: ConversationPublic
  reply: MessagePublic
}
