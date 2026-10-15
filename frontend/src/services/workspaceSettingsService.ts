import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import {
  TemplateMockError,
  handleGetWorkspaceSettings,
  handlePatchWorkspaceSettings,
  toTemplateFailEnvelope,
  type TemplateMockHandlerResult,
} from '../mocks/templates.ts'
import type { ApiEnvelope } from '../types/api.ts'
import type { WorkspaceSettingsPublic } from '../types/template.ts'
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
      statusText: status === 404 ? 'Not Found' : 'Bad Request',
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

export async function getWorkspaceSettings(): Promise<WorkspaceSettingsPublic> {
  if (isMockEnabled()) {
    return readMock(() => handleGetWorkspaceSettings(), '无法读取金额线')
  }
  const response = await api.get<ApiEnvelope<WorkspaceSettingsPublic>>('workspace-settings', {
    timeout: REQUEST_TIMEOUT_MS,
  })
  return unwrap(response.data, '无法读取金额线')
}

export async function updateWorkspaceSettings(
  highRiskAmountThreshold: number | null,
): Promise<WorkspaceSettingsPublic> {
  if (isMockEnabled()) {
    return readMock(
      () => handlePatchWorkspaceSettings(highRiskAmountThreshold),
      '无法保存金额线',
    )
  }
  const response = await api.patch<ApiEnvelope<WorkspaceSettingsPublic>>(
    'workspace-settings',
    { high_risk_amount_threshold: highRiskAmountThreshold },
    { timeout: REQUEST_TIMEOUT_MS },
  )
  return unwrap(response.data, '无法保存金额线')
}
