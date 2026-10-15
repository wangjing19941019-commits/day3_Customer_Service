import {
  AxiosError,
  AxiosHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import {
  AgentInboxMockError,
  handleAgentReply,
  handleListConversations,
} from '../mocks/agentInbox.ts'
import {
  buildCurrentSessionSuccess,
  buildCurrentSessionUnauthorized,
  buildLoginUnauthorized,
  buildLoginValidationError,
  findAccountByToken,
  resolveMockCurrent,
  resolveMockLogin,
} from '../mocks/auth.ts'
import {
  mockCreateConversation,
  mockGetConversation,
  mockSendEmployeeMessage,
  mockTransferConversation,
} from '../mocks/conversations.ts'
import { failEnvelope, okEnvelope } from '../mocks/conversationStore.ts'
import {
  mockGetDocument,
  mockListDocuments,
  mockUpdateDocument,
  mockUploadDocument,
  type DocumentUpdate,
  type MockHandlerResult,
} from '../mocks/documents.ts'
import {
  EVAL_FILE_REQUIRED,
  TemplateMockError,
  handleGetPromptTemplate,
  handleGetPromptTemplateMetrics,
  handleGetWorkspaceSettings,
  handleImportEvaluationSet,
  handleListPromptTemplateAlerts,
  handleListPromptTemplateVersions,
  handleListPromptTemplates,
  handlePatchWorkspaceSettings,
  handlePreviewPromptTemplate,
  handleReleasePromptTemplate,
  handleRollbackPromptTemplate,
  handleSavePromptTemplate,
  toTemplateFailEnvelope,
  type TemplateMockHandlerResult,
} from '../mocks/templates.ts'
import {
  TicketListMockError,
  mockApproveUrgency,
  mockClaimTicket,
  mockGetTicket,
  mockListTickets,
  mockPatchTicket,
} from '../mocks/ticketList.ts'
import {
  TicketMockError,
  handleConfirmTicket,
  handleGetTicket,
  handleKnowledgeSuggestions,
  handlePatchTicket,
  handlePolishReply,
  handleResultFeedback,
  handleUploadTicketAttachment,
} from '../mocks/tickets.ts'
import type { AgentPolishCreate, ApiEnvelope, TicketUpdate } from '../types/api.ts'
import type { ResultFeedbackCreate } from '../types/ticket.ts'
import type {
  TicketListQuery,
  TicketStatusPatch,
  TicketType,
  TicketListStatus,
  TicketUrgency,
  TicketQueue,
  UrgencyApprovalCreate,
} from '../types/ticketList.ts'

function resolvePath(config: InternalAxiosRequestConfig): string {
  const base = (config.baseURL ?? '').replace(/\/$/, '')
  const url = config.url ?? ''
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return new URL(url).pathname
  }
  if (url.startsWith('/')) {
    return url.split('?')[0]
  }
  return `${base}/${url}`.replace(/\/{2,}/g, '/').split('?')[0]
}

function readQuery(config: InternalAxiosRequestConfig): Record<string, string> {
  const query: Record<string, string> = {}
  const rawUrl = config.url ?? ''
  const searchIndex = rawUrl.indexOf('?')
  if (searchIndex >= 0) {
    const search = new URLSearchParams(rawUrl.slice(searchIndex + 1))
    search.forEach((value, key) => {
      query[key] = value
    })
  }
  const params = config.params as unknown
  if (params instanceof URLSearchParams) {
    params.forEach((value, key) => {
      query[key] = value
    })
  } else if (params && typeof params === 'object') {
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      if (value == null || value === '') continue
      query[key] = String(value)
    }
  }
  return query
}

function parseBody(config: InternalAxiosRequestConfig): Record<string, unknown> {
  const raw = config.data as unknown
  if (raw == null || raw === '') return {}
  if (typeof FormData !== 'undefined' && raw instanceof FormData) return {}
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  if (typeof raw === 'object') {
    return raw as Record<string, unknown>
  }
  return {}
}

function readUploadFile(config: InternalAxiosRequestConfig): File | null {
  const raw = config.data as unknown
  if (typeof FormData !== 'undefined' && raw instanceof FormData) {
    const file = raw.get('file')
    return file instanceof File ? file : null
  }
  return raw instanceof File ? raw : null
}

function readBearer(config: InternalAxiosRequestConfig): string | null {
  const header = config.headers
  const value =
    header instanceof AxiosHeaders
      ? header.get('Authorization')
      : ((header as Record<string, unknown> | undefined)?.Authorization ??
        (header as Record<string, unknown> | undefined)?.authorization)
  if (typeof value !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match?.[1] ?? null
}

function statusTextFor(status: number): string {
  if (status === 202) return 'Accepted'
  if (status === 401) return 'Unauthorized'
  if (status === 403) return 'Forbidden'
  if (status === 404) return 'Not Found'
  if (status === 409) return 'Conflict'
  if (status >= 400) return 'Bad Request'
  return 'OK'
}

function respond<T>(config: InternalAxiosRequestConfig, status: number, data: T): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: statusTextFor(status),
    headers: {},
    config,
  }
}

function fail(config: InternalAxiosRequestConfig, status: number, data: ApiEnvelope<null>): Promise<never> {
  const error = new AxiosError(
    'Request failed',
    AxiosError.ERR_BAD_REQUEST,
    config,
    undefined,
    {
      data,
      status,
      statusText: statusTextFor(status),
      headers: {},
      config,
    },
  )
  return Promise.reject(error)
}

function statusFromErrorCode(errorCode: string | null): number {
  if (errorCode === 'NOT_FOUND') return 404
  if (errorCode === 'UNAUTHORIZED') return 401
  if (errorCode === 'FORBIDDEN') return 403
  if (errorCode === 'CONFLICT') return 409
  return 400
}

function fromEnvelope(
  config: InternalAxiosRequestConfig,
  envelope: ApiEnvelope<unknown>,
  successStatus = 200,
): Promise<AxiosResponse> {
  if (!envelope.success) {
    return fail(config, statusFromErrorCode(envelope.error_code), envelope as ApiEnvelope<null>)
  }
  return Promise.resolve(respond(config, successStatus, envelope))
}

function fromHandlerResult(
  config: InternalAxiosRequestConfig,
  result: MockHandlerResult<unknown> | TemplateMockHandlerResult<unknown>,
): Promise<AxiosResponse> {
  if (result.status >= 400) {
    return fail(config, result.status, result.envelope as ApiEnvelope<null>)
  }
  return Promise.resolve(respond(config, result.status, result.envelope))
}

function fromTicketError(
  config: InternalAxiosRequestConfig,
  error: TicketMockError | AgentInboxMockError | TicketListMockError | TemplateMockError,
): Promise<never> {
  return fail(config, error.status, failEnvelope(error.message, error.error_code))
}

function runInbox(
  config: InternalAxiosRequestConfig,
  run: () => ApiEnvelope<unknown>,
): Promise<AxiosResponse> {
  try {
    return fromEnvelope(config, run())
  } catch (error) {
    if (error instanceof AgentInboxMockError) return fromTicketError(config, error)
    throw error
  }
}

function runTicket(
  config: InternalAxiosRequestConfig,
  run: () => ApiEnvelope<unknown>,
): Promise<AxiosResponse> {
  try {
    return fromEnvelope(config, run())
  } catch (error) {
    if (error instanceof TicketMockError) return fromTicketError(config, error)
    throw error
  }
}

function runTemplate(
  config: InternalAxiosRequestConfig,
  run: () => TemplateMockHandlerResult<unknown>,
): Promise<AxiosResponse> {
  try {
    return fromHandlerResult(config, run())
  } catch (error) {
    if (error instanceof TemplateMockError) {
      return fail(config, error.status, toTemplateFailEnvelope(error))
    }
    throw error
  }
}

function handleLogin(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const body = parseBody(config)
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!username || !password) {
    return fail(config, 400, buildLoginValidationError())
  }
  const session = resolveMockLogin(username, password)
  if (!session) {
    return fail(config, 401, buildLoginUnauthorized())
  }
  return Promise.resolve(respond(config, 200, okEnvelope(session)))
}

function handleCurrent(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const current = resolveMockCurrent(readBearer(config))
  if (!current) {
    return fail(config, 401, buildCurrentSessionUnauthorized())
  }
  return Promise.resolve(respond(config, 200, buildCurrentSessionSuccess(current.username)))
}

function requireAuth(config: InternalAxiosRequestConfig): Promise<never> | null {
  if (!findAccountByToken(readBearer(config))) {
    return fail(config, 401, buildCurrentSessionUnauthorized())
  }
  return null
}

function readPage(query: Record<string, string>): { page: number; pageSize: number } {
  return {
    page: Number(query.page ?? 1),
    pageSize: Number(query.page_size ?? 20),
  }
}

function optionalInt(value?: string): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function asTicketListQuery(query: Record<string, string>): TicketListQuery {
  const { page, pageSize } = readPage(query)
  const params: TicketListQuery = { page, page_size: pageSize }
  if (query.ticket_type) params.ticket_type = query.ticket_type as TicketType
  if (query.status) params.status = query.status as TicketListStatus
  if (query.urgency) params.urgency = query.urgency as TicketUrgency
  if (query.order_no) params.order_no = query.order_no
  if (query.user_query) params.user_query = query.user_query
  if (query.ticket_no) params.ticket_no = query.ticket_no
  if (query.time_from) params.time_from = query.time_from
  if (query.time_to) params.time_to = query.time_to
  if (query.queue) params.queue = query.queue as TicketQueue
  return params
}

async function handleDocuments(
  config: InternalAxiosRequestConfig,
  method: string,
  path: string,
): Promise<AxiosResponse | null> {
  if (method === 'POST' && path === '/api/documents') {
    const file = readUploadFile(config)
    if (!file) {
      return fail(config, 400, failEnvelope('请重新上传', 'VALIDATION_ERROR'))
    }
    return fromHandlerResult(config, await mockUploadDocument(file))
  }

  if (method === 'GET' && path === '/api/documents') {
    const query = readQuery(config)
    const { page, pageSize } = readPage(query)
    const ingestStatus = query.ingest_status
    return fromHandlerResult(
      config,
      mockListDocuments(page, pageSize, ingestStatus ? ingestStatus : undefined),
    )
  }

  const documentMatch = /^\/api\/documents\/([^/]+)$/.exec(path)
  if (documentMatch) {
    const documentId = decodeURIComponent(documentMatch[1])
    if (method === 'GET') {
      return fromHandlerResult(config, mockGetDocument(documentId))
    }
    if (method === 'PATCH') {
      return fromHandlerResult(config, mockUpdateDocument(documentId, parseBody(config) as DocumentUpdate))
    }
  }

  return null
}

function handleConversations(
  config: InternalAxiosRequestConfig,
  method: string,
  path: string,
): Promise<AxiosResponse> | null {
  if (method === 'POST' && path === '/api/conversations') {
    return fromEnvelope(config, mockCreateConversation())
  }

  if (method === 'GET' && path === '/api/conversations') {
    const { page, pageSize } = readPage(readQuery(config))
    return runInbox(config, () => handleListConversations(page, pageSize))
  }

  const polishMatch = /^\/api\/conversations\/([^/]+)\/replies\/polish$/.exec(path)
  if (polishMatch && method === 'POST') {
    const conversationId = decodeURIComponent(polishMatch[1])
    return runTicket(config, () =>
      handlePolishReply(conversationId, parseBody(config) as AgentPolishCreate),
    )
  }

  const confirmMatch = /^\/api\/conversations\/([^/]+)\/ticket\/confirm$/.exec(path)
  if (confirmMatch && method === 'POST') {
    return runTicket(config, () => handleConfirmTicket(decodeURIComponent(confirmMatch[1])))
  }

  const attachmentMatch = /^\/api\/conversations\/([^/]+)\/ticket\/attachments$/.exec(path)
  if (attachmentMatch && method === 'POST') {
    const file = readUploadFile(config)
    if (!file) {
      return fail(config, 400, failEnvelope('请重新上传', 'VALIDATION_ERROR'))
    }
    return runTicket(config, () =>
      handleUploadTicketAttachment(decodeURIComponent(attachmentMatch[1]), file),
    )
  }

  const knowledgeMatch = /^\/api\/conversations\/([^/]+)\/knowledge-suggestions$/.exec(path)
  if (knowledgeMatch && method === 'GET') {
    const query = readQuery(config)
    return runTicket(config, () =>
      handleKnowledgeSuggestions(decodeURIComponent(knowledgeMatch[1]), query.q),
    )
  }

  const feedbackMatch = /^\/api\/conversations\/([^/]+)\/result-feedbacks$/.exec(path)
  if (feedbackMatch && method === 'POST') {
    return runTicket(config, () =>
      handleResultFeedback(decodeURIComponent(feedbackMatch[1]), parseBody(config) as ResultFeedbackCreate),
    )
  }

  const ticketMatch = /^\/api\/conversations\/([^/]+)\/ticket$/.exec(path)
  if (ticketMatch) {
    const conversationId = decodeURIComponent(ticketMatch[1])
    if (method === 'GET') return runTicket(config, () => handleGetTicket(conversationId))
    if (method === 'PATCH') {
      return runTicket(config, () => handlePatchTicket(conversationId, parseBody(config) as TicketUpdate))
    }
  }

  const messagesMatch = /^\/api\/conversations\/([^/]+)\/messages$/.exec(path)
  if (messagesMatch && method === 'POST') {
    const content = parseBody(config).content
    return fromEnvelope(
      config,
      mockSendEmployeeMessage(decodeURIComponent(messagesMatch[1]), typeof content === 'string' ? content : ''),
    )
  }

  const transferMatch = /^\/api\/conversations\/([^/]+)\/transfer$/.exec(path)
  if (transferMatch && method === 'POST') {
    return fromEnvelope(config, mockTransferConversation(decodeURIComponent(transferMatch[1])))
  }

  const repliesMatch = /^\/api\/conversations\/([^/]+)\/replies$/.exec(path)
  if (repliesMatch && method === 'POST') {
    const content = parseBody(config).content
    return runInbox(config, () =>
      handleAgentReply(decodeURIComponent(repliesMatch[1]), {
        content: typeof content === 'string' ? content : '',
      }),
    )
  }

  const detailMatch = /^\/api\/conversations\/([^/]+)$/.exec(path)
  if (detailMatch && method === 'GET') {
    return fromEnvelope(config, mockGetConversation(decodeURIComponent(detailMatch[1])))
  }

  return null
}

function handleTickets(
  config: InternalAxiosRequestConfig,
  method: string,
  path: string,
): Promise<AxiosResponse> | null {
  if (method === 'GET' && path === '/api/tickets') {
    return fromHandlerResult(config, mockListTickets(readBearer(config), asTicketListQuery(readQuery(config))))
  }

  const claimMatch = /^\/api\/tickets\/([^/]+)\/claim$/.exec(path)
  if (claimMatch && method === 'POST') {
    return fromHandlerResult(config, mockClaimTicket(readBearer(config), decodeURIComponent(claimMatch[1])))
  }

  const approvalMatch = /^\/api\/tickets\/([^/]+)\/urgency-approvals$/.exec(path)
  if (approvalMatch && method === 'POST') {
    return fromHandlerResult(
      config,
      mockApproveUrgency(
        readBearer(config),
        decodeURIComponent(approvalMatch[1]),
        parseBody(config) as UrgencyApprovalCreate,
      ),
    )
  }

  const ticketMatch = /^\/api\/tickets\/([^/]+)$/.exec(path)
  if (ticketMatch) {
    const ticketId = decodeURIComponent(ticketMatch[1])
    if (method === 'GET') {
      return fromHandlerResult(config, mockGetTicket(readBearer(config), ticketId))
    }
    if (method === 'PATCH') {
      return fromHandlerResult(
        config,
        mockPatchTicket(readBearer(config), ticketId, parseBody(config) as TicketStatusPatch),
      )
    }
  }

  return null
}

async function handleTemplates(
  config: InternalAxiosRequestConfig,
  method: string,
  path: string,
): Promise<AxiosResponse | null> {
  if (method === 'GET' && path === '/api/prompt-templates') {
    return runTemplate(config, () => handleListPromptTemplates())
  }

  if (method === 'POST' && path === '/api/evaluation-sets') {
    const file = readUploadFile(config)
    if (!file) {
      return fail(config, 400, failEnvelope(EVAL_FILE_REQUIRED, 'VALIDATION_ERROR'))
    }
    const text = await file.text()
    return runTemplate(config, () => handleImportEvaluationSet(file.name, text))
  }

  if (method === 'GET' && path === '/api/prompt-template-alerts') {
    return runTemplate(config, () => handleListPromptTemplateAlerts())
  }

  if (path === '/api/workspace-settings') {
    if (method === 'GET') return runTemplate(config, () => handleGetWorkspaceSettings())
    if (method === 'PATCH') {
      const raw = parseBody(config).high_risk_amount_threshold
      const value = raw == null ? null : Number(raw)
      return runTemplate(config, () => handlePatchWorkspaceSettings(value))
    }
  }

  const previewMatch = /^\/api\/prompt-templates\/([^/]+)\/preview$/.exec(path)
  if (previewMatch && method === 'POST') {
    const sample = parseBody(config).sample_utterance
    return runTemplate(config, () =>
      handlePreviewPromptTemplate(
        decodeURIComponent(previewMatch[1]),
        typeof sample === 'string' ? sample : '',
      ),
    )
  }

  const versionsMatch = /^\/api\/prompt-templates\/([^/]+)\/versions$/.exec(path)
  if (versionsMatch && method === 'GET') {
    const query = readQuery(config)
    return runTemplate(config, () =>
      handleListPromptTemplateVersions(
        decodeURIComponent(versionsMatch[1]),
        optionalInt(query.from),
        optionalInt(query.to),
      ),
    )
  }

  const releaseMatch = /^\/api\/prompt-templates\/([^/]+)\/releases$/.exec(path)
  if (releaseMatch && method === 'POST') {
    const body = parseBody(config)
    return runTemplate(config, () =>
      handleReleasePromptTemplate(
        decodeURIComponent(releaseMatch[1]),
        Number(body.version),
        optionalInt(body.gray_percent == null ? undefined : String(body.gray_percent)),
      ),
    )
  }

  const rollbackMatch = /^\/api\/prompt-templates\/([^/]+)\/rollback$/.exec(path)
  if (rollbackMatch && method === 'POST') {
    const raw = parseBody(config).to_version
    return runTemplate(config, () =>
      handleRollbackPromptTemplate(
        decodeURIComponent(rollbackMatch[1]),
        raw == null ? null : Number(raw),
      ),
    )
  }

  const metricsMatch = /^\/api\/prompt-templates\/([^/]+)\/metrics$/.exec(path)
  if (metricsMatch && method === 'GET') {
    return runTemplate(config, () => handleGetPromptTemplateMetrics(decodeURIComponent(metricsMatch[1])))
  }

  const templateMatch = /^\/api\/prompt-templates\/([^/]+)$/.exec(path)
  if (templateMatch) {
    const templateId = decodeURIComponent(templateMatch[1])
    if (method === 'GET') return runTemplate(config, () => handleGetPromptTemplate(templateId))
    if (method === 'PATCH') {
      const body = parseBody(config)
      return runTemplate(config, () =>
        handleSavePromptTemplate(
          templateId,
          typeof body.body === 'string' ? body.body : '',
          typeof body.change_summary === 'string' ? body.change_summary : '',
        ),
      )
    }
  }

  return null
}

export async function mockAdapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const path = resolvePath(config)
  const method = (config.method ?? 'get').toUpperCase()

  if (method === 'POST' && path === '/api/sessions') {
    return handleLogin(config)
  }
  if (method === 'GET' && path === '/api/sessions/current') {
    return handleCurrent(config)
  }

  const unauthorized = requireAuth(config)
  if (unauthorized) return unauthorized

  const documents = await handleDocuments(config, method, path)
  if (documents) return documents

  const conversations = handleConversations(config, method, path)
  if (conversations) return conversations

  const tickets = handleTickets(config, method, path)
  if (tickets) return tickets

  const templates = await handleTemplates(config, method, path)
  if (templates) return templates

  return Promise.reject(
    new AxiosError(`No mock handler for ${method} ${path}`, 'ERR_NOT_IMPLEMENTED', config),
  )
}

export function isLoginRequest(config?: InternalAxiosRequestConfig): boolean {
  if (!config) return false
  const method = (config.method ?? 'get').toLowerCase()
  return method === 'post' && resolvePath(config) === '/api/sessions'
}
