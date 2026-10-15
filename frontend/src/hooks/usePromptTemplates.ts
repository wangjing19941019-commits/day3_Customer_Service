import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EVAL_FILE_REQUIRED,
  EVAL_MIN_ITEMS,
  GRAY_BLOCKED_MESSAGE,
  ROLLBACK_SUCCESS_TEXT,
  TEMPLATE_GRAY_PERCENT,
} from '../mocks/templates.ts'
import {
  getEvaluationItemCount,
  getPromptTemplate,
  getPromptTemplateMetrics,
  importEvaluationSet,
  listPromptTemplateAlerts,
  listPromptTemplateVersions,
  listPromptTemplates,
  previewPromptTemplate,
  releasePromptTemplate,
  rollbackPromptTemplate,
  savePromptTemplate,
} from '../services/templateService.ts'
import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from '../services/workspaceSettingsService.ts'
import type {
  PromptTemplateListItem,
  PromptTemplatePublic,
  PromptTemplateVersionPublic,
  PromptTemplateVersionRecord,
  TemplateAlertPublic,
  TemplateMetricsPublic,
  WorkspaceSettingsPublic,
} from '../types/template.ts'
import { withMockLabel } from '../utils/mockFlag.ts'
import { readApiError } from '../utils/readApiError.ts'

function labelError(error: unknown, fallback: string): string {
  return withMockLabel(readApiError(error, error instanceof Error ? error.message : fallback))
}

export function usePromptTemplates() {
  const [items, setItems] = useState<PromptTemplateListItem[]>([])
  const [alerts, setAlerts] = useState<TemplateAlertPublic[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PromptTemplatePublic | null>(null)
  const [versions, setVersions] = useState<PromptTemplateVersionRecord[]>([])
  const [diff, setDiff] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<TemplateMetricsPublic | null>(null)
  const [savedVersion, setSavedVersion] = useState<PromptTemplateVersionPublic | null>(null)
  const [previewBody, setPreviewBody] = useState('')
  const [rollbackMessage, setRollbackMessage] = useState('')
  const [body, setBody] = useState('')
  const [changeSummary, setChangeSummary] = useState('')
  const [sampleUtterance, setSampleUtterance] = useState('')
  const [fromVersion, setFromVersion] = useState<number | ''>('')
  const [toVersion, setToVersion] = useState<number | ''>('')
  const [evaluationItemCount, setEvaluationItemCount] = useState(0)
  const [settings, setSettings] = useState<WorkspaceSettingsPublic | null>(null)
  const [amountDraft, setAmountDraft] = useState('')
  const [listError, setListError] = useState('')
  const [alertError, setAlertError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [releaseError, setReleaseError] = useState('')
  const [evalError, setEvalError] = useState('')
  const [amountError, setAmountError] = useState('')
  const [amountMessage, setAmountMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [importing, setImporting] = useState(false)
  const [savingAmount, setSavingAmount] = useState(false)
  const selectedRef = useRef<string | null>(null)
  const requestRef = useRef(0)

  selectedRef.current = selectedId
  const grayBlocked = evaluationItemCount < EVAL_MIN_ITEMS
  const grayBlockedReason = grayBlocked ? GRAY_BLOCKED_MESSAGE : ''

  const refreshList = useCallback(async () => {
    const itemsNext = await listPromptTemplates()
    setItems(itemsNext)
    setListError('')
    return itemsNext
  }, [])

  const refreshAlerts = useCallback(async () => {
    try {
      const result = await listPromptTemplateAlerts()
      setAlerts(result.alerts)
      setAlertError('')
    } catch (error) {
      setAlerts([])
      setAlertError(labelError(error, '无法读取告警'))
    }
  }, [])

  const loadDetail = useCallback(async (templateId: string) => {
    const seq = ++requestRef.current
    try {
      const [next, versionResult, metricsNext] = await Promise.all([
        getPromptTemplate(templateId),
        listPromptTemplateVersions(templateId),
        getPromptTemplateMetrics(templateId),
      ])
      if (selectedRef.current !== templateId || seq !== requestRef.current) return
      setDetail(next)
      setBody(next.body)
      setChangeSummary('')
      setVersions(versionResult.versions)
      setDiff(null)
      setMetrics(metricsNext)
      setSavedVersion(null)
      setPreviewBody('')
      setPreviewError('')
      setRollbackMessage('')
      setReleaseError('')
      setSaveError('')
      setDetailError('')
      const latest = next.latest_version
      const previous = latest > 1 ? latest - 1 : latest
      setFromVersion(previous)
      setToVersion(latest)
    } catch (error) {
      if (selectedRef.current !== templateId || seq !== requestRef.current) return
      setDetail(null)
      setDetailError(labelError(error, '模板不存在'))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [listItems, count, workspace] = await Promise.all([
          refreshList(),
          getEvaluationItemCount(),
          getWorkspaceSettings(),
        ])
        if (cancelled) return
        setEvaluationItemCount(count)
        setSettings(workspace)
        setAmountDraft(
          workspace.high_risk_amount_threshold == null ? '' : String(workspace.high_risk_amount_threshold),
        )
        setSelectedId((current) => current ?? listItems[0]?.id ?? null)
      } catch (error) {
        if (!cancelled) setListError(labelError(error, '无法加载模板列表'))
      }
    })()
    void refreshAlerts()
    return () => {
      cancelled = true
    }
  }, [refreshAlerts, refreshList])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    void loadDetail(selectedId)
  }, [loadDetail, selectedId])

  const selectTemplate = useCallback((templateId: string) => {
    setSelectedId(templateId)
  }, [])

  const save = useCallback(async () => {
    if (!selectedId) return
    setSaving(true)
    setSaveError('')
    try {
      const saved = await savePromptTemplate(selectedId, { body, change_summary: changeSummary })
      setSavedVersion(saved)
      const [listItems, versionResult, next] = await Promise.all([
        refreshList(),
        listPromptTemplateVersions(selectedId, saved.version > 1 ? saved.version - 1 : saved.version, saved.version),
        getPromptTemplate(selectedId),
      ])
      if (selectedRef.current !== selectedId) return
      setItems(listItems)
      setDetail(next)
      setBody(next.body)
      setVersions(versionResult.versions)
      setDiff(versionResult.diff)
      setFromVersion(saved.version > 1 ? saved.version - 1 : saved.version)
      setToVersion(saved.version)
    } catch (error) {
      setSaveError(labelError(error, '无法保存模板'))
    } finally {
      setSaving(false)
    }
  }, [body, changeSummary, refreshList, selectedId])

  const preview = useCallback(async () => {
    if (!selectedId) return
    setPreviewing(true)
    setPreviewError('')
    try {
      const result = await previewPromptTemplate(selectedId, sampleUtterance)
      if (selectedRef.current !== selectedId) return
      setPreviewBody(result.rendered_body)
    } catch (error) {
      setPreviewBody('')
      setPreviewError(labelError(error, '无法预览模板'))
    } finally {
      setPreviewing(false)
    }
  }, [sampleUtterance, selectedId])

  const compare = useCallback(async () => {
    if (!selectedId || fromVersion === '' || toVersion === '') return
    try {
      const result = await listPromptTemplateVersions(selectedId, Number(fromVersion), Number(toVersion))
      if (selectedRef.current !== selectedId) return
      setVersions(result.versions)
      setDiff(result.diff)
      setSaveError('')
    } catch (error) {
      setDiff(null)
      setSaveError(labelError(error, '无法对比版本'))
    }
  }, [fromVersion, selectedId, toVersion])

  const release = useCallback(async () => {
    if (!selectedId || !detail || grayBlocked) return
    setReleasing(true)
    setReleaseError('')
    setRollbackMessage('')
    try {
      await releasePromptTemplate(selectedId, detail.latest_version, TEMPLATE_GRAY_PERCENT)
      const [listItems] = await Promise.all([refreshList(), loadDetail(selectedId)])
      setItems(listItems)
    } catch (error) {
      setReleaseError(labelError(error, GRAY_BLOCKED_MESSAGE))
    } finally {
      setReleasing(false)
    }
  }, [detail, grayBlocked, loadDetail, refreshList, selectedId])

  const rollback = useCallback(async () => {
    if (!selectedId) return
    setRollingBack(true)
    setReleaseError('')
    try {
      await rollbackPromptTemplate(selectedId)
      const listItems = await refreshList()
      setItems(listItems)
      await loadDetail(selectedId)
      setRollbackMessage(withMockLabel(ROLLBACK_SUCCESS_TEXT))
    } catch (error) {
      setRollbackMessage('')
      setReleaseError(labelError(error, '无法回滚'))
    } finally {
      setRollingBack(false)
    }
  }, [loadDetail, refreshList, selectedId])

  const importEval = useCallback(async (file: File | null) => {
    if (!file) {
      setEvalError(withMockLabel(EVAL_FILE_REQUIRED))
      return
    }
    setImporting(true)
    setEvalError('')
    try {
      const result = await importEvaluationSet(file)
      setEvaluationItemCount(result.item_count)
    } catch (error) {
      setEvalError(labelError(error, '评测集格式无效'))
    } finally {
      setImporting(false)
    }
  }, [])

  const saveAmount = useCallback(async () => {
    const raw = amountDraft.trim()
    if (!raw) {
      setAmountError(withMockLabel('请输入金额线，或点清空'))
      return
    }
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) {
      setAmountError(withMockLabel('金额线须为不小于 0 的数字'))
      return
    }
    setSavingAmount(true)
    setAmountError('')
    setAmountMessage('')
    try {
      const next = await updateWorkspaceSettings(value)
      setSettings(next)
      setAmountDraft(String(next.high_risk_amount_threshold ?? ''))
      setAmountMessage(withMockLabel('金额线已保存'))
    } catch (error) {
      setAmountError(labelError(error, '无法保存金额线'))
    } finally {
      setSavingAmount(false)
    }
  }, [amountDraft])

  const clearAmount = useCallback(async () => {
    setSavingAmount(true)
    setAmountError('')
    setAmountMessage('')
    try {
      const next = await updateWorkspaceSettings(null)
      setSettings(next)
      setAmountDraft('')
      setAmountMessage(withMockLabel('金额线已清空'))
    } catch (error) {
      setAmountError(labelError(error, '无法清空金额线'))
    } finally {
      setSavingAmount(false)
    }
  }, [])

  return {
    items,
    alerts,
    selectedId,
    detail,
    versions,
    diff,
    metrics,
    savedVersion,
    previewBody,
    rollbackMessage,
    body,
    changeSummary,
    sampleUtterance,
    fromVersion,
    toVersion,
    evaluationItemCount,
    grayBlocked,
    grayBlockedReason,
    settings,
    amountDraft,
    listError,
    alertError,
    detailError,
    saveError,
    previewError,
    releaseError,
    evalError,
    amountError,
    amountMessage,
    saving,
    previewing,
    releasing,
    rollingBack,
    importing,
    savingAmount,
    selectTemplate,
    setBody,
    setChangeSummary,
    setSampleUtterance,
    setFromVersion,
    setToVersion,
    setAmountDraft,
    save,
    preview,
    compare,
    release,
    rollback,
    importEval,
    saveAmount,
    clearAmount,
  }
}
