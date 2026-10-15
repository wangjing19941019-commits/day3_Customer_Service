import {
  DOCUMENT_UPLOAD_EXTENSIONS,
  type ApiEnvelope,
  type DocumentUploadExtension,
  type IngestStatus,
} from '../types/api.ts'
import {
  DOCUMENT_VISIBILITY_OPTIONS,
  type ChunkPreview,
  type DocumentEntity,
  type DocumentListItem,
  type DocumentPublic,
  type DocumentUpdate,
  type DocumentVisibility,
  type EntityTag,
  type EntityTagType,
  type FaqItem,
} from '../types/document.ts'
import addressChangeMd from './knowledge/address-change.md?raw'
import apparelFaqMd from './knowledge/apparel-faq.md?raw'
import apparelReturnMd from './knowledge/apparel-return-policy.md?raw'
import complaintPolicyMd from './knowledge/complaint-policy.md?raw'
import digitalFaqMd from './knowledge/digital-3c-faq.md?raw'
import digitalWarrantyMd from './knowledge/digital-3c-warranty.md?raw'
import invoicePolicyMd from './knowledge/invoice-policy.md?raw'
import shippingPolicyMd from './knowledge/shipping-policy.md?raw'

export const CHUNK_MAX_CHARS = 800
export const CHUNK_OVERLAP_CHARS = 160
export const MOCK_INGEST_DELAY_MS = 8000
export const MAX_UPLOAD_BYTES = 5_242_880
export const SCAN_ONLY_PDF_FIXTURE = 'scan-only.pdf'
export const CHUNK_STRATEGY_TEXT =
  '所有格式先转为 Markdown；按 Markdown 标题与段落切块，单块不超过 800 字，块间重叠 160 字（上限的 20%）；有标题时保留标题路径，没有则路径为空。'
export const UPLOAD_HINT_TEXT = '支持 Markdown、TXT，以及能抽出文字的 PDF'
export const EMPTY_ALL_DOCUMENTS_TEXT =
  '还没有知识文档。请上传 Markdown、TXT 或能抽出文字的 PDF。'

export const OBJECT_TYPE_OPTIONS = [
  { code: 'product_3c', name: '3C数码商品' },
  { code: 'product_fashion', name: '服饰美妆商品' },
  { code: 'order_logistics', name: '订单与配送' },
  { code: 'return_exchange', name: '退换货' },
  { code: 'address_change', name: '修改地址' },
  { code: 'invoice', name: '发票' },
  { code: 'complaint', name: '投诉维权' },
] as const

export const REQUEST_TYPE_OPTIONS = [
  { code: 'pre_sale_consult', name: '售前咨询' },
  { code: 'usage_guidance', name: '使用与保养指导' },
  { code: 'policy_process', name: '制度与流程说明' },
  { code: 'after_sale_howto', name: '售后办理说明' },
  { code: 'troubleshooting', name: '商品异常说明' },
] as const

export const ENTITY_TYPE_OPTIONS = [
  { code: 'product', name: '商品' },
  { code: 'order', name: '订单' },
  { code: 'spec', name: '规格' },
] as const

export type { IngestStatus }
export type {
  ChunkPreview,
  DocumentEntity,
  DocumentListItem,
  DocumentPublic,
  DocumentUpdate,
  DocumentVisibility,
  EntityTag,
  EntityTagType,
  FaqItem,
}
export { DOCUMENT_VISIBILITY_OPTIONS }

export type Pagination = {
  page: number
  page_size: number
  total_items: number
  total_pages: number
  has_next: boolean
  has_prev: boolean
}

export type PaginatedEnvelope<T> = ApiEnvelope<T> & {
  pagination: Pagination
}

export type MockHandlerResult<T> = {
  status: number
  envelope: ApiEnvelope<T> | PaginatedEnvelope<T>
}

const STORAGE_KEY = 'customer_service_mock_documents_v6'
const ALLOWED_INGEST_STATUS: ReadonlySet<string> = new Set(['ingesting', 'ready', 'failed'])
const OBJECT_CODES = new Set<string>(OBJECT_TYPE_OPTIONS.map((item) => item.code))
const REQUEST_CODES = new Set<string>(REQUEST_TYPE_OPTIONS.map((item) => item.code))
const ENTITY_CODES = new Set<string>(ENTITY_TYPE_OPTIONS.map((item) => item.code))
const VISIBILITY_CODES = new Set<string>(DOCUMENT_VISIBILITY_OPTIONS.map((item) => item.code))
const DEFAULT_READY_VISIBILITY: DocumentVisibility = 'user_visible'

let documents: DocumentEntity[] = loadStore()

function nowIso(): string {
  return new Date().toISOString()
}

function buildEnvelope<T>(
  partial: Omit<ApiEnvelope<T>, 'timestamp' | 'request_id' | 'metadata'>,
): ApiEnvelope<T> {
  return {
    ...partial,
    timestamp: nowIso(),
    request_id: `mock-req-${crypto.randomUUID()}`,
    metadata: {},
  }
}

export function fileExtension(name: string): string {
  const lower = String(name || '').toLowerCase()
  const index = lower.lastIndexOf('.')
  return index >= 0 ? lower.slice(index) : ''
}

export function isAllowedDocumentFilename(name: string): boolean {
  return (DOCUMENT_UPLOAD_EXTENSIONS as readonly string[]).includes(fileExtension(name))
}

function isScanOnlyPdfFixture(name: string): boolean {
  return String(name || '').toLowerCase() === SCAN_ONLY_PDF_FIXTURE
}

function normalizeSourceText(text: string): string {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .trim()
}

function unescapePdfString(value: string): string {
  return String(value)
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .replace(/\\\)/g, ')')
    .replace(/\\\(/g, '(')
}

function maybeDecodeUtf8(value: string): string {
  const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return value
  }
}

export function extractPdfText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let raw = ''
  for (let i = 0; i < bytes.length; i += 1) {
    raw += String.fromCharCode(bytes[i])
  }
  const parts: string[] = []
  const tjRe = /\(((?:\\.|[^\\)])*)\)\s*Tj/g
  let match: RegExpExecArray | null
  while ((match = tjRe.exec(raw))) {
    parts.push(unescapePdfString(match[1]))
  }
  const arrRe = /\[([\s\S]*?)\]\s*TJ/g
  while ((match = arrRe.exec(raw))) {
    const innerRe = /\(((?:\\.|[^\\)])*)\)/g
    let inner: RegExpExecArray | null
    while ((inner = innerRe.exec(match[1]))) {
      parts.push(unescapePdfString(inner[1]))
    }
  }
  return maybeDecodeUtf8(
    parts
      .join('')
      .split('')
      .filter((char) => {
        const code = char.charCodeAt(0)
        return code === 9 || code === 10 || code === 13 || code >= 32
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function txtToMarkdown(text: string): string {
  // Keep paragraphs as Markdown body. Do not invent heading lines.
  return normalizeSourceText(text)
}

function pdfToMarkdown(extracted: string): string {
  return normalizeSourceText(extracted)
}

export function convertToMarkdown(filename: string, sourceText: string): string {
  const ext = fileExtension(filename) as DocumentUploadExtension | ''
  if (ext === '.txt') return txtToMarkdown(sourceText)
  if (ext === '.pdf') return pdfToMarkdown(sourceText)
  return normalizeSourceText(sourceText)
}

function ingestChunks(filename: string, sourceText: string): ChunkPreview[] {
  return chunkMarkdown(convertToMarkdown(filename, sourceText))
}

function splitWithOverlap(text: string, max: number, overlap: number): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= max) return [trimmed]
  const out: string[] = []
  let start = 0
  while (start < trimmed.length) {
    const end = Math.min(start + max, trimmed.length)
    out.push(trimmed.slice(start, end))
    if (end >= trimmed.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return out
}

export function chunkMarkdown(raw: string): ChunkPreview[] {
  const text = String(raw || '').replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const sections: Array<{ heading_path: string; content: string }> = []
  let path: string[] = []
  let body: string[] = []

  function currentPath(): string {
    return path.filter(Boolean).join(' / ')
  }

  function pushSection() {
    const content = body.join('\n').trim()
    body = []
    if (!content && !currentPath()) return
    const headingPath = currentPath()
    const prefixed = headingPath ? `${headingPath}\n${content}` : content
    for (const part of splitWithOverlap(prefixed, CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS)) {
      sections.push({ heading_path: headingPath, content: part })
    }
  }

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line)
    if (match) {
      pushSection()
      const level = match[1].length
      path = path.slice(0, level - 1)
      path[level - 1] = match[2].trim()
      continue
    }
    body.push(line)
  }
  pushSection()
  return sections.map((section, index) => ({
    position: index + 1,
    heading_path: section.heading_path,
    content: section.content,
  }))
}

function readyVisibility(doc: DocumentEntity): DocumentVisibility | null {
  if (doc.ingest_status !== 'ready') return doc.visibility
  return doc.visibility ?? DEFAULT_READY_VISIBILITY
}

function toListItem(doc: DocumentEntity): DocumentListItem {
  const ready = doc.ingest_status === 'ready'
  return {
    id: doc.id,
    filename: doc.filename,
    ingest_status: doc.ingest_status,
    ingest_error: doc.ingest_error,
    object_types: ready ? [...doc.object_types] : [],
    request_types: ready ? [...doc.request_types] : [],
    faq_count: ready ? doc.faqs.length : 0,
    chunk_count: ready ? doc.chunks.length : 0,
    visibility: readyVisibility(doc),
    effective_from: ready ? doc.effective_from : null,
    effective_to: ready ? doc.effective_to : null,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  }
}

function toPublic(doc: DocumentEntity): DocumentPublic {
  const previewable = doc.ingest_status === 'ready'
  const chunks = previewable
    ? [...doc.chunks].sort((a, b) => a.position - b.position)
    : []
  return {
    id: doc.id,
    filename: doc.filename,
    ingest_status: doc.ingest_status,
    ingest_error: doc.ingest_error,
    object_types: previewable ? [...doc.object_types] : [],
    request_types: previewable ? [...doc.request_types] : [],
    entities: previewable ? doc.entities.map((item) => ({ ...item })) : [],
    faqs: previewable ? doc.faqs.map((item) => ({ ...item })) : [],
    chunks,
    chunk_count: chunks.length,
    visibility: readyVisibility(doc),
    effective_from: previewable ? doc.effective_from : null,
    effective_to: previewable ? doc.effective_to : null,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  }
}

function persist() {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(documents))
  } catch {
    // 私密模式或容量不足时仍保留内存态，保证当前 SPA 会话可离开再回。
  }
}

function readyDoc(input: {
  id: string
  filename: string
  source: string
  updatedAt: string
  objectTypes: string[]
  requestTypes: string[]
  entities: EntityTag[]
  faqs: FaqItem[]
  visibility?: DocumentVisibility
  effectiveFrom?: string | null
  effectiveTo?: string | null
}): DocumentEntity {
  return {
    id: input.id,
    filename: input.filename,
    ingest_status: 'ready',
    ingest_error: null,
    object_types: input.objectTypes,
    request_types: input.requestTypes,
    entities: input.entities,
    faqs: input.faqs,
    chunks: ingestChunks(input.filename, input.source),
    visibility: input.visibility ?? DEFAULT_READY_VISIBILITY,
    effective_from: input.effectiveFrom ?? null,
    effective_to: input.effectiveTo ?? null,
    created_at: input.updatedAt,
    updated_at: input.updatedAt,
    source_text: input.source,
    ready_at: null,
    fail_ingest: false,
  }
}

function seedDocuments(): DocumentEntity[] {
  const scanUpdated = '2026-09-12T08:00:00.000Z'
  const shippingUpdated = '2026-09-22T12:40:00.000Z'
  return [
    readyDoc({
      id: 'doc_apparel_return',
      filename: '服饰美妆退换货政策.md',
      source: apparelReturnMd,
      updatedAt: '2026-09-22T12:10:00.000Z',
      objectTypes: ['product_fashion', 'return_exchange'],
      requestTypes: ['policy_process', 'after_sale_howto'],
      entities: [{ name: '连衣裙', type: 'product' }],
      faqs: [
        {
          id: 'faq_apparel_return',
          question: '服饰可以七天无理由退货吗',
          answer: '签收后七日内，吊牌和包装完整、未下水、不影响二次销售时可以。该口径不适用于 3C 数码。',
        },
      ],
      visibility: 'user_visible',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-12-31T23:59:59.000Z',
    }),
    readyDoc({
      id: 'doc_3c_warranty',
      filename: '3C数码质保与退换.md',
      source: digitalWarrantyMd,
      updatedAt: '2026-09-22T12:12:00.000Z',
      objectTypes: ['product_3c', 'return_exchange'],
      requestTypes: ['policy_process', 'after_sale_howto'],
      entities: [{ name: '耳机', type: 'product' }],
      faqs: [
        {
          id: 'faq_3c_warranty',
          question: '3C 数码能按七天无理由退吗',
          answer: '不能套用服饰七天无理由。未激活且包装完整可在签收七日内退货；已拆封的性能故障按页面质保处理。',
        },
      ],
      visibility: 'user_visible',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-12-31T23:59:59.000Z',
    }),
    readyDoc({
      id: 'doc_apparel_faq',
      filename: '服饰美妆常见问题.md',
      source: apparelFaqMd,
      updatedAt: '2026-09-22T12:20:00.000Z',
      objectTypes: ['product_fashion'],
      requestTypes: ['pre_sale_consult', 'usage_guidance'],
      entities: [
        { name: '连衣裙', type: 'product' },
        { name: '尺码', type: 'spec' },
      ],
      faqs: [
        {
          id: 'faq_apparel_size',
          question: '连衣裙 M 码是多大',
          answer: '按该商品页面尺码表对照胸围、腰围和衣长，不要套用其他商品的 M 码。',
        },
      ],
    }),
    readyDoc({
      id: 'doc_3c_faq',
      filename: '3C数码常见问题.md',
      source: digitalFaqMd,
      updatedAt: '2026-09-22T12:22:00.000Z',
      objectTypes: ['product_3c'],
      requestTypes: ['pre_sale_consult', 'troubleshooting'],
      entities: [{ name: '耳机', type: 'product' }],
      faqs: [
        {
          id: 'faq_earphone_pair',
          question: '耳机能不能同时连两台手机',
          answer: '以该型号页面规格为准。页面没写明时不要答应可以。',
        },
      ],
    }),
    readyDoc({
      id: 'doc_address_change',
      filename: '修改收货地址.md',
      source: addressChangeMd,
      updatedAt: '2026-09-22T12:28:00.000Z',
      objectTypes: ['address_change'],
      requestTypes: ['policy_process', 'after_sale_howto'],
      entities: [],
      faqs: [
        {
          id: 'faq_address_change',
          question: '发货后还能改地址吗',
          answer: '未发货可以改。已交给快递后不能保证拦截成功，也不在知识库里查实时物流。',
        },
      ],
      visibility: 'agent_only',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-12-31T23:59:59.000Z',
    }),
    readyDoc({
      id: 'doc_invoice',
      filename: '发票开具说明.md',
      source: invoicePolicyMd,
      updatedAt: '2026-09-22T12:32:00.000Z',
      objectTypes: ['invoice'],
      requestTypes: ['policy_process', 'after_sale_howto'],
      entities: [],
      faqs: [
        {
          id: 'faq_invoice',
          question: '怎么开增值税发票',
          answer: '电子普通发票个人只需抬头，公司需要名称和税号。专用发票还要补齐页面要求的开户资料。',
        },
      ],
      visibility: 'user_visible',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-12-31T23:59:59.000Z',
    }),
    readyDoc({
      id: 'doc_complaint',
      filename: '投诉处理说明.md',
      source: complaintPolicyMd,
      updatedAt: '2026-09-22T12:36:00.000Z',
      objectTypes: ['complaint'],
      requestTypes: ['policy_process', 'after_sale_howto'],
      entities: [],
      faqs: [
        {
          id: 'faq_complaint',
          question: '怎么投诉',
          answer: '写清订单号、时间和具体问题后转人工，由坐席确认投诉工单。不承诺固定回复时长。',
        },
      ],
      visibility: 'high_risk_human_only',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-12-31T23:59:59.000Z',
    }),
    {
      id: 'doc_shipping',
      filename: '订单配送时效说明.md',
      ingest_status: 'ingesting',
      ingest_error: null,
      object_types: [],
      request_types: [],
      entities: [],
      faqs: [],
      chunks: [],
      visibility: null,
      effective_from: null,
      effective_to: null,
      created_at: shippingUpdated,
      updated_at: shippingUpdated,
      source_text: shippingPolicyMd,
      ready_at: null,
      fail_ingest: false,
    },
    {
      id: 'doc_scan_only',
      filename: SCAN_ONLY_PDF_FIXTURE,
      ingest_status: 'failed',
      ingest_error: '请重新上传',
      object_types: [],
      request_types: [],
      entities: [],
      faqs: [],
      chunks: [],
      visibility: null,
      effective_from: null,
      effective_to: null,
      created_at: scanUpdated,
      updated_at: scanUpdated,
      source_text: '',
      ready_at: null,
      fail_ingest: false,
    },
  ]
}

function normalizeEntity(doc: DocumentEntity): DocumentEntity {
  const ready = doc.ingest_status === 'ready'
  return {
    ...doc,
    visibility: ready ? (doc.visibility ?? DEFAULT_READY_VISIBILITY) : (doc.visibility ?? null),
    effective_from: doc.effective_from ?? null,
    effective_to: doc.effective_to ?? null,
  }
}

function loadStore(): DocumentEntity[] {
  try {
    if (typeof sessionStorage === 'undefined') return seedDocuments()
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DocumentEntity[]
      if (Array.isArray(parsed)) return parsed.map(normalizeEntity)
    }
  } catch {
    // 损坏的缓存回退到种子数据
  }
  return seedDocuments()
}

function sortByUpdatedDesc(items: DocumentEntity[]): DocumentEntity[] {
  return [...items].sort((a, b) => {
    if (a.updated_at === b.updated_at) return 0
    return a.updated_at < b.updated_at ? 1 : -1
  })
}

function mockTagAndFaq(filename: string, text: string, chunks: ChunkPreview[]) {
  const haystack = `${filename}\n${text}`.toLowerCase()
  const object_types: string[] = []
  if (/耳机|数码|3c|质保|充电器|手机/.test(haystack)) object_types.push('product_3c')
  if (/连衣裙|服饰|美妆|尺码|七天|鞋包/.test(haystack)) object_types.push('product_fashion')
  if (/退货|退换|退款|无理由/.test(haystack)) object_types.push('return_exchange')
  if (/地址/.test(haystack)) object_types.push('address_change')
  if (/发票|税号|抬头/.test(haystack)) object_types.push('invoice')
  if (/投诉/.test(haystack)) object_types.push('complaint')
  if (/物流|发货|运费|配送|包邮/.test(haystack)) object_types.push('order_logistics')
  if (object_types.length === 0) object_types.push('order_logistics')

  const request_types: string[] = []
  if (/尺码|色号|规格|能不能连|咨询/.test(haystack)) request_types.push('pre_sale_consult')
  if (/洗涤|充电|保养|怎么洗/.test(haystack)) request_types.push('usage_guidance')
  if (/政策|规则|说明|可以|是否/.test(haystack)) request_types.push('policy_process')
  if (/怎么办|怎么办理|如何/.test(haystack)) request_types.push('after_sale_howto')
  if (/没声|故障|异常|坏了/.test(haystack)) request_types.push('troubleshooting')
  if (request_types.length === 0) request_types.push('policy_process')

  const entities: EntityTag[] = []
  if (/连衣裙/.test(haystack)) entities.push({ name: '连衣裙', type: 'product' })
  if (/耳机/.test(haystack)) entities.push({ name: '耳机', type: 'product' })
  if (/尺码/.test(haystack)) entities.push({ name: '尺码', type: 'spec' })

  const title = chunks[0]?.heading_path || filename.replace(/\.(md|txt|pdf)$/i, '')
  const answer = (chunks[0]?.content || text).slice(0, 400)
  const faqs: FaqItem[] = [
    {
      id: `faq_${crypto.randomUUID()}`,
      question: `${title} 常见问题怎么处理`,
      answer: answer || '请按文档中的步骤处理。',
    },
  ]
  return { object_types, request_types, entities, faqs }
}

function finalizeDue() {
  const now = Date.now()
  let changed = false
  for (const doc of documents) {
    if (doc.ingest_status !== 'ingesting' || doc.ready_at == null || now < doc.ready_at) {
      continue
    }
    changed = true
    const stamp = nowIso()
    if (doc.fail_ingest) {
      doc.ingest_status = 'failed'
      doc.ingest_error = '请重新上传'
      doc.object_types = []
      doc.request_types = []
      doc.entities = []
      doc.faqs = []
      doc.chunks = []
      doc.visibility = null
      doc.effective_from = null
      doc.effective_to = null
      doc.updated_at = stamp
      continue
    }
    const markdown = convertToMarkdown(doc.filename, doc.source_text)
    if (!markdown) {
      doc.ingest_status = 'failed'
      doc.ingest_error = '请重新上传'
      doc.object_types = []
      doc.request_types = []
      doc.entities = []
      doc.faqs = []
      doc.chunks = []
      doc.visibility = null
      doc.effective_from = null
      doc.effective_to = null
      doc.updated_at = stamp
      continue
    }
    const chunks = chunkMarkdown(markdown)
    const tagged = mockTagAndFaq(doc.filename, markdown, chunks)
    doc.ingest_status = 'ready'
    doc.ingest_error = null
    doc.object_types = tagged.object_types
    doc.request_types = tagged.request_types
    doc.entities = tagged.entities
    doc.faqs = tagged.faqs
    doc.chunks = chunks
    doc.visibility = DEFAULT_READY_VISIBILITY
    doc.effective_from = null
    doc.effective_to = null
    doc.updated_at = stamp
  }
  if (changed) persist()
}

function fail(status: number, error: string, errorCode: string): MockHandlerResult<null> {
  return {
    status,
    envelope: buildEnvelope({
      success: false,
      data: null,
      error,
      error_code: errorCode,
      message: null,
    }),
  }
}

function looksLikeUtf8Text(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return true
  }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return !decoded.includes('\uFFFD')
  } catch {
    return false
  }
}

export async function mockUploadDocument(file: File): Promise<MockHandlerResult<DocumentPublic | null>> {
  finalizeDue()
  const filename = file.name || ''
  if (!isAllowedDocumentFilename(filename) || file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return fail(400, '请重新上传', 'VALIDATION_ERROR')
  }
  const ext = fileExtension(filename)
  const buffer = await file.arrayBuffer()
  let sourceText = ''
  if (ext === '.pdf') {
    if (isScanOnlyPdfFixture(filename)) {
      return fail(400, '请重新上传', 'VALIDATION_ERROR')
    }
    sourceText = extractPdfText(buffer)
  } else {
    if (!looksLikeUtf8Text(buffer)) {
      return fail(400, '请重新上传', 'VALIDATION_ERROR')
    }
    sourceText = new TextDecoder('utf-8').decode(buffer)
  }
  if (!normalizeSourceText(sourceText)) {
    return fail(400, '请重新上传', 'VALIDATION_ERROR')
  }

  const stamp = nowIso()
  const stem = filename.replace(/\.(md|txt|pdf)$/i, '')
  const entity: DocumentEntity = {
    id: `doc_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    filename,
    ingest_status: 'ingesting',
    ingest_error: null,
    object_types: [],
    request_types: [],
    entities: [],
    faqs: [],
    chunks: [],
    visibility: null,
    effective_from: null,
    effective_to: null,
    created_at: stamp,
    updated_at: stamp,
    source_text: sourceText,
    ready_at: Date.now() + MOCK_INGEST_DELAY_MS,
    fail_ingest: stem.toLowerCase() === 'fail',
  }
  documents = [entity, ...documents]
  persist()
  return {
    status: 202,
    envelope: buildEnvelope({
      success: true,
      data: toPublic(entity),
      error: null,
      error_code: null,
      message: 'ok',
    }),
  }
}

export function mockListDocuments(
  page = 1,
  pageSize = 20,
  ingestStatus?: string | null,
): MockHandlerResult<DocumentListItem[] | null> {
  finalizeDue()
  if (!Number.isFinite(page) || page < 1 || !Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
    return fail(400, '分页参数无效', 'VALIDATION_ERROR')
  }
  if (ingestStatus != null && ingestStatus !== '' && !ALLOWED_INGEST_STATUS.has(ingestStatus)) {
    return fail(400, '入库状态筛选无效', 'VALIDATION_ERROR')
  }
  const safePage = Math.floor(page)
  const safeSize = Math.floor(pageSize)
  const filtered =
    ingestStatus && ALLOWED_INGEST_STATUS.has(ingestStatus)
      ? documents.filter((doc) => doc.ingest_status === ingestStatus)
      : documents
  const sorted = sortByUpdatedDesc(filtered)
  const totalItems = sorted.length
  const totalPages = Math.max(1, Math.ceil(totalItems / safeSize))
  const start = (safePage - 1) * safeSize
  const items = sorted.slice(start, start + safeSize).map(toListItem)
  const envelope: PaginatedEnvelope<DocumentListItem[]> = {
    ...buildEnvelope({
      success: true,
      data: items,
      error: null,
      error_code: null,
      message: 'ok',
    }),
    pagination: {
      page: safePage,
      page_size: safeSize,
      total_items: totalItems,
      total_pages: totalPages,
      has_next: safePage < totalPages,
      has_prev: safePage > 1,
    },
  }
  return { status: 200, envelope }
}

export function mockGetDocument(documentId: string): MockHandlerResult<DocumentPublic | null> {
  finalizeDue()
  const doc = documents.find((item) => item.id === documentId)
  if (!doc) {
    return fail(404, '文档不存在', 'NOT_FOUND')
  }
  return {
    status: 200,
    envelope: buildEnvelope({
      success: true,
      data: toPublic(doc),
      error: null,
      error_code: null,
      message: 'ok',
    }),
  }
}

export function mockUpdateDocument(
  documentId: string,
  payload: DocumentUpdate,
): MockHandlerResult<DocumentPublic | null> {
  finalizeDue()
  const doc = documents.find((item) => item.id === documentId)
  if (!doc) {
    return fail(404, '文档不存在', 'NOT_FOUND')
  }
  if (doc.ingest_status === 'ingesting') {
    return fail(409, '文档仍在入库中，完成后才能修改标签或 FAQ。', 'CONFLICT')
  }
  if (doc.ingest_status === 'failed') {
    return fail(409, '请重新上传', 'CONFLICT')
  }

  if (payload.object_types) {
    if (payload.object_types.some((code) => !OBJECT_CODES.has(code))) {
      return fail(400, '标签不在体系内', 'VALIDATION_ERROR')
    }
    doc.object_types = [...payload.object_types]
  }
  if (payload.request_types) {
    if (payload.request_types.some((code) => !REQUEST_CODES.has(code))) {
      return fail(400, '标签不在体系内', 'VALIDATION_ERROR')
    }
    doc.request_types = [...payload.request_types]
  }
  if (payload.entities) {
    if (
      payload.entities.some(
        (item) => !item.name.trim() || !ENTITY_CODES.has(item.type),
      )
    ) {
      return fail(400, '实体名称与类型无效', 'VALIDATION_ERROR')
    }
    doc.entities = payload.entities.map((item) => ({
      name: item.name.trim(),
      type: item.type,
    }))
  }
  if (payload.faqs) {
    if (
      payload.faqs.some(
        (item) => !item.question.trim() || !item.answer.trim(),
      )
    ) {
      return fail(400, 'FAQ 问法与答案不能为空', 'VALIDATION_ERROR')
    }
    const existing = new Map(doc.faqs.map((item) => [item.id, item]))
    doc.faqs = payload.faqs.map((item) => ({
      id: item.id && existing.has(item.id) ? item.id : `faq_${crypto.randomUUID()}`,
      question: item.question.trim().slice(0, 500),
      answer: item.answer.trim().slice(0, 4000),
    }))
  }

  if (payload.visibility !== undefined) {
    if (!VISIBILITY_CODES.has(payload.visibility)) {
      return fail(400, '可见范围非法', 'VALIDATION_ERROR')
    }
    doc.visibility = payload.visibility
  }

  const nextFrom = payload.effective_from !== undefined ? payload.effective_from : doc.effective_from
  const nextTo = payload.effective_to !== undefined ? payload.effective_to : doc.effective_to
  if (payload.effective_from !== undefined || payload.effective_to !== undefined) {
    if (nextFrom && nextTo) {
      const fromTime = new Date(nextFrom).getTime()
      const toTime = new Date(nextTo).getTime()
      if (Number.isNaN(fromTime) || Number.isNaN(toTime)) {
        return fail(400, '生效时间无效', 'VALIDATION_ERROR')
      }
      if (toTime < fromTime) {
        return fail(400, '结束时间不能早于开始时间', 'VALIDATION_ERROR')
      }
    }
    if (payload.effective_from !== undefined) {
      doc.effective_from = payload.effective_from
    }
    if (payload.effective_to !== undefined) {
      doc.effective_to = payload.effective_to
    }
  }

  doc.updated_at = nowIso()
  persist()
  return {
    status: 200,
    envelope: buildEnvelope({
      success: true,
      data: toPublic(doc),
      error: null,
      error_code: null,
      message: 'ok',
    }),
  }
}
