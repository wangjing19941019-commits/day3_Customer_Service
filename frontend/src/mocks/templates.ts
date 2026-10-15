import { findAccountByToken } from './auth.ts'
import { failEnvelope, newId, nowIso, okEnvelope } from './conversationStore.ts'
import type { ApiEnvelope } from '../types/api.ts'
import type {
  EvaluationSetPublic,
  PromptTemplateListItem,
  PromptTemplatePreviewPublic,
  PromptTemplatePublic,
  PromptTemplateReleasePublic,
  PromptTemplateVersionPublic,
  PromptTemplateVersionRecord,
  PromptTemplateVersionsPublic,
  TemplateAlertPublic,
  TemplateAlertsPublic,
  TemplateMetricsPublic,
  TemplateMetricsSlice,
  TemplateScene,
  WorkspaceSettingsPublic,
} from '../types/template.ts'
import { getAccessToken } from '../utils/authStorage.ts'

export const EVAL_MIN_ITEMS = 5000
export const TEMPLATE_GRAY_PERCENT = 5
export const GRAY_BLOCKED_MESSAGE = '没有不少于 5000 条的评测集，不能开始灰度'
export const PLACEHOLDER_NOTES =
  '可使用 {{emotion}} / {{情绪}}（用户情绪）、{{order}} / {{订单}}（订单信息）、{{policy}} / {{政策}}（政策条款）。预览用测试说法本地替换占位，不调用发出坐席回复的模型路径。'
export const ALERT_MESSAGE = '合规拦截率突然升高'
export const SAMPLE_UTTERANCE_HINT = '我很生气，订单JD20260922001还没按七天无理由退货处理。'
export const ROLLBACK_SUCCESS_TEXT = '新会话将使用该版本'
export const EVAL_FILE_INVALID = '评测集格式无效'
export const EVAL_FILE_REQUIRED = '请上传评测集文件'

const STORE_KEY = 'mock_prompt_templates_v1'
const SEED_BODY = '请结合用户情绪{{emotion}}、订单{{order}}与政策{{policy}}给出售后说明。'
const SEED_SUMMARY = '初始版本'

const EMOTION_RULES: readonly [RegExp, string][] = [
  [/愤怒|火大|气死|怒/, '愤怒'],
  [/生气|气愤/, '生气'],
  [/着急|焦虑|担心/, '着急'],
  [/失望|不满/, '失望'],
  [/开心|满意/, '开心'],
]
const ORDER_RE = /(?:订单号?|订单)\s*[:：#]?\s*([A-Za-z0-9_-]+)|(JD[A-Za-z0-9]+)/i
const POLICY_RE = /七天无理由退货|七天无理由|运费险|全国联保|退换货政策|保修\d+年/
const PLACEHOLDER_MAP: Record<string, readonly string[]> = {
  emotion: ['{{emotion}}', '{{情绪}}', '{emotion}', '{情绪}'],
  order: ['{{order}}', '{{订单}}', '{{订单信息}}', '{order}'],
  policy: ['{{policy}}', '{{政策}}', '{{政策条款}}', '{policy}'],
}

type TemplateEntity = {
  id: string
  business_line: string
  ticket_type: string
  scene: TemplateScene
  stable_version: number
  gray_version: number | null
  gray_percent: number
  previous_stable_version: number | null
  versions: PromptTemplateVersionRecord[]
}

type TemplateStore = {
  templates: Record<string, TemplateEntity>
  evaluation: EvaluationSetPublic | null
  alerts: TemplateAlertPublic[]
  settings: WorkspaceSettingsPublic
}

export class TemplateMockError extends Error {
  status: number
  error_code: string

  constructor(status: number, error_code: string, message: string) {
    super(message)
    this.name = 'TemplateMockError'
    this.status = status
    this.error_code = error_code
  }
}

export type TemplateMockHandlerResult<T> = {
  status: number
  envelope: ApiEnvelope<T | null>
}

function fail(status: number, error_code: string, message: string): never {
  throw new TemplateMockError(status, error_code, message)
}

function requireAdmin(): { username: string } {
  const account = findAccountByToken(getAccessToken())
  if (!account) fail(401, 'UNAUTHORIZED', '请先登录')
  if (account.role !== 'admin') fail(403, 'FORBIDDEN', '没有权限访问模板')
  return account
}

function seedVersion(): PromptTemplateVersionRecord {
  return {
    version: 1,
    editor: 'system',
    edited_at: nowIso(),
    change_summary: SEED_SUMMARY,
    body: SEED_BODY,
  }
}

function seedTemplate(
  id: string,
  businessLine: string,
  ticketType: string,
  scene: TemplateScene,
): TemplateEntity {
  return {
    id,
    business_line: businessLine,
    ticket_type: ticketType,
    scene,
    stable_version: 1,
    gray_version: null,
    gray_percent: 0,
    previous_stable_version: null,
    versions: [seedVersion()],
  }
}

function emptyStore(): TemplateStore {
  const digitalReturn = seedTemplate(
    'tpl-digital-return-after',
    'digital_3c',
    'return_exchange',
    'after_sale',
  )
  const apparelReturn = seedTemplate(
    'tpl-apparel-return-after',
    'apparel_beauty',
    'return_exchange',
    'after_sale',
  )
  const inTransit = seedTemplate(
    'tpl-digital-logistics-transit',
    'digital_3c',
    'logistics_exception',
    'in_transit',
  )
  return {
    templates: {
      [digitalReturn.id]: digitalReturn,
      [apparelReturn.id]: apparelReturn,
      [inTransit.id]: inTransit,
    },
    evaluation: null,
    alerts: [
      {
        template_id: digitalReturn.id,
        metric: 'compliance_intercept_rate',
        message: ALERT_MESSAGE,
        created_at: nowIso(),
      },
    ],
    settings: { high_risk_amount_threshold: null },
  }
}

function readStore(): TemplateStore {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (!raw) {
      const seeded = emptyStore()
      writeStore(seeded)
      return seeded
    }
    return JSON.parse(raw) as TemplateStore
  } catch {
    const seeded = emptyStore()
    writeStore(seeded)
    return seeded
  }
}

function writeStore(store: TemplateStore): void {
  sessionStorage.setItem(STORE_KEY, JSON.stringify(store))
}

function getTemplateOrThrow(store: TemplateStore, templateId: string): TemplateEntity {
  const row = store.templates[templateId]
  if (!row) fail(404, 'NOT_FOUND', '模板不存在')
  return row
}

function latestVersion(row: TemplateEntity): PromptTemplateVersionRecord {
  return row.versions.reduce((current, item) => (item.version > current.version ? item : current))
}

function versionByNumber(row: TemplateEntity, version: number): PromptTemplateVersionRecord {
  const found = row.versions.find((item) => item.version === version)
  if (!found) fail(404, 'NOT_FOUND', '版本不存在')
  return found
}

function toListItem(row: TemplateEntity): PromptTemplateListItem {
  return {
    id: row.id,
    business_line: row.business_line,
    ticket_type: row.ticket_type,
    scene: row.scene,
    stable_version: row.stable_version,
    gray_version: row.gray_version,
    gray_percent: row.gray_percent,
  }
}

function toPublic(row: TemplateEntity): PromptTemplatePublic {
  const latest = latestVersion(row)
  return {
    id: row.id,
    business_line: row.business_line,
    ticket_type: row.ticket_type,
    scene: row.scene,
    body: latest.body,
    placeholder_notes: PLACEHOLDER_NOTES,
    stable_version: row.stable_version,
    gray_version: row.gray_version,
    gray_percent: row.gray_percent,
    latest_version: latest.version,
  }
}

function toRelease(row: TemplateEntity): PromptTemplateReleasePublic {
  return {
    template_id: row.id,
    gray_version: row.gray_version,
    stable_version: row.stable_version,
    gray_percent: row.gray_percent,
  }
}

function evaluationCount(store: TemplateStore): number {
  return store.evaluation?.item_count ?? 0
}

export function extractPlaceholders(sampleUtterance: string): { emotion: string; order: string; policy: string } {
  const text = sampleUtterance.trim()
  let emotion = '未识别情绪'
  for (const [pattern, label] of EMOTION_RULES) {
    if (pattern.test(text)) {
      emotion = label
      break
    }
  }
  let order = '未识别订单'
  const orderMatch = ORDER_RE.exec(text)
  if (orderMatch) {
    order = orderMatch[1] || orderMatch[2]
  }
  let policy = '未识别政策'
  const policyMatch = POLICY_RE.exec(text)
  if (policyMatch) {
    policy = policyMatch[0]
  }
  return { emotion, order, policy }
}

export function renderPlaceholders(body: string, sampleUtterance: string): string {
  const values = extractPlaceholders(sampleUtterance)
  let rendered = body
  for (const [key, tokens] of Object.entries(PLACEHOLDER_MAP)) {
    const replacement = values[key as keyof typeof values]
    for (const token of tokens) {
      rendered = rendered.split(token).join(replacement)
    }
  }
  return rendered
}

function diffBodies(left: string, right: string, fromVersion: number, toVersion: number): string {
  const aLines = left.split('\n')
  const bLines = right.split('\n')
  const lines = [`--- v${fromVersion}`, `+++ v${toVersion}`]
  const max = Math.max(aLines.length, bLines.length)
  for (let index = 0; index < max; index += 1) {
    const aLine = aLines[index]
    const bLine = bLines[index]
    if (aLine === bLine) {
      if (aLine !== undefined) lines.push(` ${aLine}`)
    } else {
      if (aLine !== undefined) lines.push(`-${aLine}`)
      if (bLine !== undefined) lines.push(`+${bLine}`)
    }
  }
  return lines.join('\n')
}

function parseEvalMapping(row: Record<string, unknown>): { scene: string; input: string } | 'count' | null {
  const declared = row.item_count
  const scene = String(row.scene ?? row['场景'] ?? '').trim()
  const input = String(row.input ?? row['输入'] ?? '').trim()
  if (!scene && !input && typeof declared === 'number' && Number.isFinite(declared) && declared >= 0) {
    return 'count'
  }
  const expected = row.expected_slots ?? row.expected ?? row.labels ?? row['标签']
  if (!scene || !input || expected == null || expected === '') return null
  return { scene, input }
}

function parseEvaluationText(filename: string, text: string): { count: number } {
  const name = filename.toLowerCase()
  const stripped = text.trim()
  if (!stripped) fail(400, 'VALIDATION_ERROR', EVAL_FILE_INVALID)

  const rows: unknown[] = []
  if (name.endsWith('.csv') || (!name.endsWith('.jsonl') && !name.endsWith('.json') && !stripped.startsWith('{') && !stripped.startsWith('['))) {
    const lines = stripped.split(/\r?\n/)
    const header = lines[0]?.split(',').map((item) => item.trim()) ?? []
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue
      const cells = line.split(',')
      const row: Record<string, unknown> = {}
      header.forEach((key, index) => {
        row[key] = cells[index]?.trim() ?? ''
      })
      rows.push(row)
    }
  } else if (stripped.startsWith('[')) {
    const parsed = JSON.parse(stripped) as unknown
    if (!Array.isArray(parsed)) fail(400, 'VALIDATION_ERROR', EVAL_FILE_INVALID)
    rows.push(...parsed)
  } else {
    for (const line of stripped.split(/\r?\n/)) {
      if (!line.trim()) continue
      rows.push(JSON.parse(line) as unknown)
    }
  }

  let declaredCount: number | null = null
  let valid = 0
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const parsed = parseEvalMapping(row as Record<string, unknown>)
    if (parsed === 'count') {
      const value = Number((row as Record<string, unknown>).item_count)
      declaredCount = value
      continue
    }
    if (parsed) valid += 1
  }
  if (declaredCount != null) return { count: declaredCount }
  if (valid <= 0) fail(400, 'VALIDATION_ERROR', EVAL_FILE_INVALID)
  return { count: valid }
}

function metricsSlice(interceptRate: number): TemplateMetricsSlice {
  return {
    extraction_accuracy: 0.82,
    adoption_rate: 0.71,
    compliance_intercept_rate: interceptRate,
    modification_rate: 0.18,
    complaint_rate: 0.04,
  }
}

function wrapOk<T>(data: T): TemplateMockHandlerResult<T> {
  return { status: 200, envelope: okEnvelope(data) }
}

export function handleListPromptTemplates(): TemplateMockHandlerResult<PromptTemplateListItem[]> {
  requireAdmin()
  const store = readStore()
  const items = Object.values(store.templates).sort((left, right) =>
    left.business_line.localeCompare(right.business_line),
  )
  return wrapOk(items.map(toListItem))
}

export function handleGetPromptTemplate(templateId: string): TemplateMockHandlerResult<PromptTemplatePublic> {
  requireAdmin()
  const store = readStore()
  return wrapOk(toPublic(getTemplateOrThrow(store, templateId)))
}

export function handleSavePromptTemplate(
  templateId: string,
  body: string,
  changeSummary: string,
): TemplateMockHandlerResult<PromptTemplateVersionPublic> {
  const account = requireAdmin()
  const trimmedBody = body.trim()
  const trimmedSummary = changeSummary.trim()
  if (!trimmedBody || !trimmedSummary) fail(400, 'VALIDATION_ERROR', '正文和修改内容不能为空')
  const store = readStore()
  const row = getTemplateOrThrow(store, templateId)
  const nextVersion = latestVersion(row).version + 1
  const record: PromptTemplateVersionRecord = {
    version: nextVersion,
    editor: account.username,
    edited_at: nowIso(),
    change_summary: trimmedSummary,
    body: trimmedBody,
  }
  row.versions = [...row.versions, record]
  writeStore(store)
  return wrapOk({
    version: record.version,
    editor: record.editor,
    edited_at: record.edited_at,
    change_summary: record.change_summary,
  })
}

export function handlePreviewPromptTemplate(
  templateId: string,
  sampleUtterance: string,
): TemplateMockHandlerResult<PromptTemplatePreviewPublic> {
  requireAdmin()
  if (!sampleUtterance.trim()) fail(400, 'VALIDATION_ERROR', '请输入测试说法')
  const store = readStore()
  const row = getTemplateOrThrow(store, templateId)
  return wrapOk({ rendered_body: renderPlaceholders(latestVersion(row).body, sampleUtterance) })
}

export function handleListPromptTemplateVersions(
  templateId: string,
  fromVersion?: number,
  toVersion?: number,
): TemplateMockHandlerResult<PromptTemplateVersionsPublic> {
  requireAdmin()
  const store = readStore()
  const row = getTemplateOrThrow(store, templateId)
  let diff: string | null = null
  if (fromVersion != null && toVersion != null) {
    const left = row.versions.find((item) => item.version === fromVersion)
    const right = row.versions.find((item) => item.version === toVersion)
    if (!left || !right) fail(400, 'VALIDATION_ERROR', '对比版本不存在')
    diff = diffBodies(left.body, right.body, fromVersion, toVersion)
  }
  return wrapOk({ versions: row.versions, diff })
}

export function handleReleasePromptTemplate(
  templateId: string,
  version: number,
  grayPercent?: number | null,
): TemplateMockHandlerResult<PromptTemplateReleasePublic> {
  requireAdmin()
  const store = readStore()
  if (evaluationCount(store) < EVAL_MIN_ITEMS) fail(409, 'CONFLICT', GRAY_BLOCKED_MESSAGE)
  const row = getTemplateOrThrow(store, templateId)
  versionByNumber(row, version)
  row.previous_stable_version = row.stable_version
  row.gray_version = version
  row.gray_percent = grayPercent ?? TEMPLATE_GRAY_PERCENT
  writeStore(store)
  return wrapOk(toRelease(row))
}

export function handleRollbackPromptTemplate(
  templateId: string,
  toVersion?: number | null,
): TemplateMockHandlerResult<PromptTemplateReleasePublic> {
  requireAdmin()
  const store = readStore()
  const row = getTemplateOrThrow(store, templateId)
  const targetVersion = toVersion ?? row.previous_stable_version ?? row.stable_version
  versionByNumber(row, targetVersion)
  row.stable_version = targetVersion
  row.gray_version = null
  row.gray_percent = 0
  writeStore(store)
  return wrapOk(toRelease(row))
}

export function handleGetPromptTemplateMetrics(
  templateId: string,
): TemplateMockHandlerResult<TemplateMetricsPublic> {
  requireAdmin()
  const store = readStore()
  const row = getTemplateOrThrow(store, templateId)
  const overall = metricsSlice(row.id === 'tpl-digital-return-after' ? 0.42 : 0.08)
  const stable = metricsSlice(0.08)
  const gray = row.gray_version != null ? metricsSlice(0.06) : null
  return wrapOk({
    ...overall,
    feedback_summary: '暂无回流问题',
    stable_version: row.stable_version,
    gray_version: row.gray_version,
    stable,
    gray,
  })
}

export function handleImportEvaluationSet(
  filename: string,
  text: string,
): TemplateMockHandlerResult<EvaluationSetPublic> {
  requireAdmin()
  if (!filename) fail(400, 'VALIDATION_ERROR', EVAL_FILE_REQUIRED)
  let parsed: { count: number }
  try {
    parsed = parseEvaluationText(filename, text)
  } catch (error) {
    if (error instanceof TemplateMockError) throw error
    fail(400, 'VALIDATION_ERROR', EVAL_FILE_INVALID)
  }
  const store = readStore()
  store.evaluation = { id: newId(), item_count: parsed.count }
  writeStore(store)
  return wrapOk(store.evaluation)
}

export function handleListPromptTemplateAlerts(): TemplateMockHandlerResult<TemplateAlertsPublic> {
  requireAdmin()
  const store = readStore()
  return wrapOk({ alerts: store.alerts })
}

export function handleGetEvaluationItemCount(): number {
  requireAdmin()
  return evaluationCount(readStore())
}

export function handleGetWorkspaceSettings(): TemplateMockHandlerResult<WorkspaceSettingsPublic> {
  const account = findAccountByToken(getAccessToken())
  if (!account) fail(401, 'UNAUTHORIZED', '请先登录')
  if (account.role !== 'admin' && account.role !== 'supervisor') {
    fail(403, 'FORBIDDEN', '没有权限读取金额线')
  }
  return wrapOk(readStore().settings)
}

export function handlePatchWorkspaceSettings(
  highRiskAmountThreshold: number | null,
): TemplateMockHandlerResult<WorkspaceSettingsPublic> {
  requireAdmin()
  if (highRiskAmountThreshold != null && (!Number.isFinite(highRiskAmountThreshold) || highRiskAmountThreshold < 0)) {
    fail(400, 'VALIDATION_ERROR', '金额线须为不小于 0 的数字，或清空')
  }
  const store = readStore()
  store.settings = { high_risk_amount_threshold: highRiskAmountThreshold }
  writeStore(store)
  return wrapOk(store.settings)
}

export function toTemplateFailEnvelope(error: TemplateMockError): ApiEnvelope<null> {
  return failEnvelope(error.message, error.error_code)
}
