import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import {
  mockGetDocument,
  mockListDocuments,
  mockUpdateDocument,
  mockUploadDocument,
  type DocumentListItem,
  type DocumentPublic,
  type DocumentUpdate,
  type MockHandlerResult,
  type PaginatedEnvelope,
  type Pagination,
} from '../mocks/documents.ts'
import type { ApiEnvelope, DocumentListQuery } from '../types/api.ts'
import { isMockEnabled } from '../utils/mockFlag.ts'
import api from './api.ts'

export type {
  ChunkPreview,
  DocumentListItem,
  DocumentPublic,
  DocumentUpdate,
  DocumentVisibility,
  EntityTag,
  FaqItem,
  IngestStatus,
  Pagination,
} from '../mocks/documents.ts'

export type DocumentListResult = {
  items: DocumentListItem[]
  pagination: Pagination
}

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20

function pollIntervalMs(): number {
  const raw = Number(import.meta.env.VITE_POLL_INTERVAL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 3000
}

export const DOCUMENT_POLL_INTERVAL_MS = pollIntervalMs()

function unwrap<T>(envelope: ApiEnvelope<T>, fallback: string): T {
  if (!envelope.success || envelope.data == null) {
    throw new Error(envelope.error ?? fallback)
  }
  return envelope.data
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
      statusText: result.status === 404 ? 'Not Found' : result.status === 409 ? 'Conflict' : 'Bad Request',
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

export async function listDocuments(
  query: DocumentListQuery = {},
): Promise<DocumentListResult> {
  const page = query.page ?? DEFAULT_PAGE
  const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE
  const ingestStatus = query.ingest_status
  if (isMockEnabled()) {
    const result = mockListDocuments(
      page,
      pageSize,
      ingestStatus === 'ingesting' || ingestStatus === 'ready' || ingestStatus === 'failed'
        ? ingestStatus
        : undefined,
    )
    const items = readMock(result, '无法加载文档列表')
    const pagination = (result.envelope as PaginatedEnvelope<DocumentListItem[]>).pagination
    return { items, pagination }
  }
  const params: DocumentListQuery = { page, page_size: pageSize }
  if (ingestStatus === 'ingesting' || ingestStatus === 'ready' || ingestStatus === 'failed') {
    params.ingest_status = ingestStatus
  }
  const response = await api.get<PaginatedEnvelope<DocumentListItem[]>>('documents', {
    params,
  })
  return {
    items: unwrap(response.data, '无法加载文档列表'),
    pagination: response.data.pagination,
  }
}

export async function uploadDocument(file: File): Promise<DocumentPublic> {
  if (isMockEnabled()) {
    const result = await mockUploadDocument(file)
    return readMock(result, '请重新上传')
  }
  const form = new FormData()
  form.append('file', file)
  const response = await api.post<ApiEnvelope<DocumentPublic>>('documents', form, {
    headers: { 'Content-Type': undefined as unknown as string },
  })
  return unwrap(response.data, '请重新上传')
}

export async function getDocument(documentId: string): Promise<DocumentPublic> {
  if (isMockEnabled()) {
    const result = mockGetDocument(documentId)
    return readMock(result, '文档不存在')
  }
  const response = await api.get<ApiEnvelope<DocumentPublic>>(`documents/${documentId}`)
  return unwrap(response.data, '文档不存在')
}

export async function updateDocument(
  documentId: string,
  payload: DocumentUpdate,
): Promise<DocumentPublic> {
  if (isMockEnabled()) {
    const result = mockUpdateDocument(documentId, payload)
    return readMock(result, '保存失败')
  }
  const response = await api.patch<ApiEnvelope<DocumentPublic>>(`documents/${documentId}`, payload)
  return unwrap(response.data, '保存失败')
}
