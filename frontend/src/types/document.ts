import type { IngestStatus } from './api.ts'

export type { IngestStatus }

export type DocumentVisibility = 'user_visible' | 'agent_only' | 'high_risk_human_only'

export const DOCUMENT_VISIBILITY_OPTIONS = [
  { code: 'user_visible', name: '用户可见' },
  { code: 'agent_only', name: '仅坐席可见' },
  { code: 'high_risk_human_only', name: '高风险仅人工' },
] as const

export type EntityTagType = 'product' | 'order' | 'spec'

export type EntityTag = {
  name: string
  type: EntityTagType
}

export type FaqItem = {
  id: string
  question: string
  answer: string
}

export type ChunkPreview = {
  position: number
  heading_path: string
  content: string
}

export type DocumentEntity = {
  id: string
  filename: string
  ingest_status: IngestStatus
  ingest_error: string | null
  object_types: string[]
  request_types: string[]
  entities: EntityTag[]
  faqs: FaqItem[]
  chunks: ChunkPreview[]
  visibility: DocumentVisibility | null
  effective_from: string | null
  effective_to: string | null
  created_at: string
  updated_at: string
  source_text: string
  ready_at: number | null
  fail_ingest: boolean
}

export type DocumentListItem = {
  id: string
  filename: string
  ingest_status: IngestStatus
  ingest_error: string | null
  object_types: string[]
  request_types: string[]
  faq_count: number
  chunk_count: number
  visibility: DocumentVisibility | null
  effective_from: string | null
  effective_to: string | null
  created_at: string
  updated_at: string
}

export type DocumentPublic = {
  id: string
  filename: string
  ingest_status: IngestStatus
  ingest_error: string | null
  object_types: string[]
  request_types: string[]
  entities: EntityTag[]
  faqs: FaqItem[]
  chunks: ChunkPreview[]
  chunk_count: number
  visibility: DocumentVisibility | null
  effective_from: string | null
  effective_to: string | null
  created_at: string
  updated_at: string
}

export type DocumentUpdate = {
  object_types?: string[]
  request_types?: string[]
  entities?: EntityTag[]
  faqs?: Array<{ id?: string; question: string; answer: string }>
  visibility?: DocumentVisibility
  effective_from?: string | null
  effective_to?: string | null
}
