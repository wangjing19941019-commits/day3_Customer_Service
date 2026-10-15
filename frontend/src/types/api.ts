export type ApiEnvelope<T> = {
  success: boolean
  data: T | null
  error: string | null
  error_code: string | null
  message: string | null
  timestamp: string
  request_id: string
  metadata: Record<string, unknown>
}

export type IngestStatus = 'ingesting' | 'ready' | 'failed'

export const DOCUMENT_UPLOAD_EXTENSIONS = ['.md', '.txt', '.pdf'] as const
export type DocumentUploadExtension = (typeof DOCUMENT_UPLOAD_EXTENSIONS)[number]

export const DOCUMENT_UPLOAD_ACCEPT =
  '.md,.txt,.pdf,text/markdown,text/plain,application/pdf'

export type DocumentListQuery = {
  page?: number
  page_size?: number
  ingest_status?: IngestStatus
}

export type TicketType = 'return_exchange' | 'address_change' | 'invoice' | 'complaint'
export type BusinessLine = 'digital_3c' | 'apparel_beauty'
export type TicketStatus = 'draft' | 'confirmed'
export type ExtractStatus = 'idle' | 'extracting' | 'ready' | 'failed'
export type FieldStatus = 'extracted' | 'incomplete' | 'agent_edited'

export type TicketField = {
  value: string | null
  status: FieldStatus
}

export type TicketPublic = {
  id: string
  conversation_id: string
  status: TicketStatus
  ticket_type: TicketType | null
  business_line: BusinessLine | null
  extract_status: ExtractStatus
  extract_error: string | null
  can_confirm: boolean
  fields: Record<string, TicketField>
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
  content: string
}

export type KnowledgeSuggestionPublic = {
  conversation_id: string
  ticket_type: TicketType | null
  business_line: BusinessLine | null
  business_line_locked: boolean
  suggestions: KnowledgeSuggestionItem[]
  empty_message: string | null
}

export type AgentPolishCreate = {
  content: string
}

export type AgentPolishPublic = {
  original_content: string
  polished_content: string
}
