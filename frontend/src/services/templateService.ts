import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import {
  EVAL_FILE_REQUIRED,
  TemplateMockError,
  handleGetEvaluationItemCount,
  handleGetPromptTemplate,
  handleGetPromptTemplateMetrics,
  handleImportEvaluationSet,
  handleListPromptTemplateAlerts,
  handleListPromptTemplateVersions,
  handleListPromptTemplates,
  handlePreviewPromptTemplate,
  handleReleasePromptTemplate,
  handleRollbackPromptTemplate,
  handleSavePromptTemplate,
  toTemplateFailEnvelope,
  type TemplateMockHandlerResult,
} from '../mocks/templates.ts'
import type { ApiEnvelope } from '../types/api.ts'
import type {
  EvaluationSetCurrentPublic,
  EvaluationSetPublic,
  PromptTemplateListItem,
  PromptTemplatePreviewPublic,
  PromptTemplatePublic,
  PromptTemplateReleasePublic,
  PromptTemplateUpdate,
  PromptTemplateVersionPublic,
  PromptTemplateVersionsPublic,
  TemplateAlertsPublic,
  TemplateMetricsPublic,
} from '../types/template.ts'
import { isMockEnabled } from '../utils/mockFlag.ts'
import api from './api.ts'

const REQUEST_TIMEOUT_MS = 15000

function unwrap<T>(envelope: ApiEnvelope<T>, fallback: string): T {
  if (!envelope.success || envelope.data == null) {
    throw new Error(envelope.error ?? fallback)
  }
  return envelope.data
}

function rejectMock<T>(result: TemplateMockHandlerResult<T>): never {
  const envelope = result.envelope as ApiEnvelope<null>
  const status = result.status
  const error = new AxiosError(
    envelope.error ?? 'Request failed',
    status === 401 ? AxiosError.ERR_BAD_REQUEST : AxiosError.ERR_BAD_RESPONSE,
    { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
    undefined,
    {
      data: envelope,
      status,
      statusText: status === 404 ? 'Not Found' : status === 409 ? 'Conflict' : 'Bad Request',
      headers: {},
      config: { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
    },
  )
  throw error
}

function readMock<T>(run: () => TemplateMockHandlerResult<T>, fallback: string): T {
  try {
    const result = run()
    if (result.status >= 400 || !result.envelope.success || result.envelope.data == null) {
      rejectMock(result)
    }
    return unwrap(result.envelope as ApiEnvelope<T>, fallback)
  } catch (error) {
    if (error instanceof TemplateMockError) {
      rejectMock({ status: error.status, envelope: toTemplateFailEnvelope(error) })
    }
    throw error
  }
}

export async function listPromptTemplates(): Promise<PromptTemplateListItem[]> {
  if (isMockEnabled()) {
    return readMock(() => handleListPromptTemplates(), '无法加载模板列表')
  }
  const response = await api.get<ApiEnvelope<PromptTemplateListItem[]>>('prompt-templates', {
    timeout: REQUEST_TIMEOUT_MS,
  })
  return unwrap(response.data, '无法加载模板列表')
}

export async function getPromptTemplate(templateId: string): Promise<PromptTemplatePublic> {
  if (isMockEnabled()) {
    return readMock(() => handleGetPromptTemplate(templateId), '模板不存在')
  }
  const response = await api.get<ApiEnvelope<PromptTemplatePublic>>(`prompt-templates/${templateId}`, {
    timeout: REQUEST_TIMEOUT_MS,
  })
  return unwrap(response.data, '模板不存在')
}

export async function savePromptTemplate(
  templateId: string,
  payload: PromptTemplateUpdate,
): Promise<PromptTemplateVersionPublic> {
  if (isMockEnabled()) {
    return readMock(
      () => handleSavePromptTemplate(templateId, payload.body, payload.change_summary),
      '无法保存模板',
    )
  }
  const response = await api.patch<ApiEnvelope<PromptTemplateVersionPublic>>(
    `prompt-templates/${templateId}`,
    payload,
    { timeout: REQUEST_TIMEOUT_MS },
  )
  return unwrap(response.data, '无法保存模板')
}

export async function previewPromptTemplate(
  templateId: string,
  sampleUtterance: string,
): Promise<PromptTemplatePreviewPublic> {
  if (isMockEnabled()) {
    return readMock(
      () => handlePreviewPromptTemplate(templateId, sampleUtterance),
      '无法预览模板',
    )
  }
  const response = await api.post<ApiEnvelope<PromptTemplatePreviewPublic>>(
    `prompt-templates/${templateId}/preview`,
    { sample_utterance: sampleUtterance },
    { timeout: REQUEST_TIMEOUT_MS },
  )
  return unwrap(response.data, '无法预览模板')
}

export async function listPromptTemplateVersions(
  templateId: string,
  fromVersion?: number,
  toVersion?: number,
): Promise<PromptTemplateVersionsPublic> {
  if (isMockEnabled()) {
    return readMock(
      () => handleListPromptTemplateVersions(templateId, fromVersion, toVersion),
      '无法读取版本',
    )
  }
  const response = await api.get<ApiEnvelope<PromptTemplateVersionsPublic>>(
    `prompt-templates/${templateId}/versions`,
    {
      timeout: REQUEST_TIMEOUT_MS,
      params: {
        ...(fromVersion != null ? { from: fromVersion } : {}),
        ...(toVersion != null ? { to: toVersion } : {}),
      },
    },
  )
  return unwrap(response.data, '无法读取版本')
}

export async function releasePromptTemplate(
  templateId: string,
  version: number,
  grayPercent: number,
): Promise<PromptTemplateReleasePublic> {
  if (isMockEnabled()) {
    return readMock(
      () => handleReleasePromptTemplate(templateId, version, grayPercent),
      '无法灰度发布',
    )
  }
  const response = await api.post<ApiEnvelope<PromptTemplateReleasePublic>>(
    `prompt-templates/${templateId}/releases`,
    { version, gray_percent: grayPercent },
    { timeout: REQUEST_TIMEOUT_MS },
  )
  return unwrap(response.data, '无法灰度发布')
}

export async function rollbackPromptTemplate(
  templateId: string,
  toVersion?: number | null,
): Promise<PromptTemplateReleasePublic> {
  if (isMockEnabled()) {
    return readMock(() => handleRollbackPromptTemplate(templateId, toVersion), '无法回滚')
  }
  const response = await api.post<ApiEnvelope<PromptTemplateReleasePublic>>(
    `prompt-templates/${templateId}/rollback`,
    toVersion != null ? { to_version: toVersion } : {},
    { timeout: REQUEST_TIMEOUT_MS },
  )
  return unwrap(response.data, '无法回滚')
}

export async function getPromptTemplateMetrics(templateId: string): Promise<TemplateMetricsPublic> {
  if (isMockEnabled()) {
    return readMock(() => handleGetPromptTemplateMetrics(templateId), '无法读取指标')
  }
  const response = await api.get<ApiEnvelope<TemplateMetricsPublic>>(
    `prompt-templates/${templateId}/metrics`,
    { timeout: REQUEST_TIMEOUT_MS },
  )
  return unwrap(response.data, '无法读取指标')
}

export async function importEvaluationSet(file: File): Promise<EvaluationSetPublic> {
  if (isMockEnabled()) {
    const text = await file.text()
    return readMock(() => handleImportEvaluationSet(file.name, text), EVAL_FILE_REQUIRED)
  }
  const body = new FormData()
  body.append('file', file)
  const response = await api.post<ApiEnvelope<EvaluationSetPublic>>('evaluation-sets', body, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { 'Content-Type': undefined as unknown as string },
  })
  return unwrap(response.data, EVAL_FILE_REQUIRED)
}

export async function listPromptTemplateAlerts(): Promise<TemplateAlertsPublic> {
  if (isMockEnabled()) {
    return readMock(() => handleListPromptTemplateAlerts(), '无法读取告警')
  }
  const response = await api.get<ApiEnvelope<TemplateAlertsPublic>>('prompt-template-alerts', {
    timeout: REQUEST_TIMEOUT_MS,
  })
  return unwrap(response.data, '无法读取告警')
}

export async function getEvaluationItemCount(): Promise<number> {
  if (isMockEnabled()) {
    try {
      return handleGetEvaluationItemCount()
    } catch (error) {
      if (error instanceof TemplateMockError) {
        rejectMock({ status: error.status, envelope: toTemplateFailEnvelope(error) })
      }
      throw error
    }
  }
  const response = await api.get<ApiEnvelope<EvaluationSetCurrentPublic>>('evaluation-sets/current', {
    timeout: REQUEST_TIMEOUT_MS,
  })
  return unwrap(response.data, '无法读取评测集').item_count
}
