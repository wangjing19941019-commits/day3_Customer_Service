import { useRef, type FormEvent } from 'react'
import { usePromptTemplates } from '../hooks/usePromptTemplates.ts'
import { BUSINESS_LINES, TICKET_TYPES } from '../mocks/tickets.ts'
import {
  EVAL_MIN_ITEMS,
  SAMPLE_UTTERANCE_HINT,
} from '../mocks/templates.ts'
import type { TemplateMetricsSlice, TemplateScene } from '../types/template.ts'
import { isMockEnabled, withMockLabel } from '../utils/mockFlag.ts'

const SCENE_LABELS: Record<TemplateScene, string> = {
  pre_sale: '售前',
  after_sale: '售后',
  in_transit: '行程中',
}

function optionLabel(options: readonly { value: string; label: string }[], value: string): string {
  return options.find((item) => item.value === value)?.label ?? value
}

function sceneLabel(scene: string): string {
  return SCENE_LABELS[scene as TemplateScene] ?? scene
}

function templateTitle(businessLine: string, ticketType: string, scene: string): string {
  return `${optionLabel(BUSINESS_LINES, businessLine)} · ${optionLabel(TICKET_TYPES, ticketType)} · ${sceneLabel(scene)}`
}

function formatTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('zh-CN')
}

function formatRate(value: number | null): string {
  return value == null ? '暂无数据' : `${(value * 100).toFixed(1)}%`
}

function sliceText(slice: TemplateMetricsSlice): string {
  return `抽取准确率 ${formatRate(slice.extraction_accuracy)} · 采纳率 ${formatRate(slice.adoption_rate)} · 合规拦截率 ${formatRate(slice.compliance_intercept_rate)} · 修改率 ${formatRate(slice.modification_rate)}`
}

function evalHint(count: number): string {
  if (count >= EVAL_MIN_ITEMS) return `当前 ${count} 条，可灰度。`
  const base = `当前 ${count} 条，不足 ${EVAL_MIN_ITEMS} 条不能灰度。`
  return isMockEnabled() ? `${base}Mock 可用一行 {"item_count":5000} 声明条数，{"item_count":0} 清空。` : base
}

export default function TemplateAdminPage() {
  const evalInputRef = useRef<HTMLInputElement>(null)
  const {
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
  } = usePromptTemplates()

  function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void save()
  }

  function onPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void preview()
  }

  function onCompare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void compare()
  }

  function onImportEval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void importEval(evalInputRef.current?.files?.[0] ?? null)
  }

  const canSave = Boolean(body.trim() && changeSummary.trim() && !saving && detail)
  const selectedAlert = alerts.find((item) => item.template_id === selectedId)

  return (
    <div className="tpl-page">
      <style>{TPL_STYLES}</style>
      <section className="tpl-toolbar" aria-label="工作区设置">
        <div className="tpl-toolbar-block">
          <h2>大额订单金额线</h2>
          <div className="tpl-toolbar-row">
            <label className="field">
              <span>金额（元）</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={amountDraft}
                disabled={savingAmount}
                placeholder="未配置"
                onChange={(event) => setAmountDraft(event.target.value)}
              />
            </label>
            <button className="btn btn-secondary" type="button" disabled={savingAmount} onClick={() => void saveAmount()}>
              {savingAmount ? '保存中…' : '保存金额线'}
            </button>
            <button className="btn btn-secondary" type="button" disabled={savingAmount} onClick={() => void clearAmount()}>
              清空
            </button>
          </div>
          <p className="hint">
            {withMockLabel(
              settings?.high_risk_amount_threshold == null
                ? '未配置金额线，不因金额单独升为高风险。'
                : `当前金额线 ${settings.high_risk_amount_threshold} 元。`,
            )}
          </p>
          {amountError ? <p className="error-text" role="alert">{amountError}</p> : null}
          {amountMessage ? <p className="hint">{amountMessage}</p> : null}
        </div>
        <form className="tpl-toolbar-block" onSubmit={onImportEval}>
          <h2>评测集</h2>
          <div className="tpl-toolbar-row">
            <input ref={evalInputRef} type="file" accept=".jsonl,.json,.csv" disabled={importing} />
            <button className="btn btn-secondary" type="submit" disabled={importing}>
              {importing ? '导入中…' : '导入评测集'}
            </button>
          </div>
          <p className="hint">{withMockLabel(evalHint(evaluationItemCount))}</p>
          {evalError ? <p className="error-text" role="alert">{evalError}</p> : null}
        </form>
      </section>

      <div className="tpl-split">
        <aside className="tpl-list" aria-label="模板列表">
          {listError ? <p className="error-text tpl-pad">{listError}</p> : null}
          {alertError ? <p className="error-text tpl-pad" role="alert">{alertError}</p> : null}
          {items.length === 0 && !listError ? (
            <p className="tpl-empty">{withMockLabel('还没有提示模板。')}</p>
          ) : (
            items.map((item) => {
              const alert = alerts.find((entry) => entry.template_id === item.id)
              const selected = item.id === selectedId
              return (
                <button
                  key={item.id}
                  type="button"
                  className={selected ? 'tpl-row selected' : 'tpl-row'}
                  onClick={() => selectTemplate(item.id)}
                >
                  <span className="tpl-row-main">
                    <span className="tpl-row-title">
                      {withMockLabel(templateTitle(item.business_line, item.ticket_type, item.scene))}
                    </span>
                    <span className="hint">
                      {withMockLabel(
                        `稳定 v${item.stable_version}${item.gray_version != null ? ` · 灰度 v${item.gray_version} ${item.gray_percent}%` : ''}`,
                      )}
                    </span>
                  </span>
                  {alert ? (
                    <span className="tpl-alert">{withMockLabel(alert.message)}</span>
                  ) : null}
                </button>
              )
            })
          )}
        </aside>

        <section className="tpl-editor" aria-label="模板编辑">
          <h1>{withMockLabel('模板配置')}</h1>
          {!detail && detailError ? <p className="error-text" role="alert">{detailError}</p> : null}
          {!detail && !detailError ? (
            <p className="hint">{withMockLabel('请选择左侧模板。')}</p>
          ) : null}
          {detail ? (
            <>
              <p className="hint">
                {withMockLabel(
                  `${templateTitle(detail.business_line, detail.ticket_type, detail.scene)} · 最新 v${detail.latest_version}`,
                )}
              </p>
              {selectedAlert ? (
                <p className="tpl-alert-inline" role="status">
                  {withMockLabel(selectedAlert.message)}
                </p>
              ) : null}

              <form className="tpl-edit" onSubmit={onSave}>
                <div className="field">
                  <label htmlFor="tpl-body">模板正文</label>
                  <textarea
                    id="tpl-body"
                    value={body}
                    disabled={saving}
                    rows={8}
                    onChange={(event) => setBody(event.target.value)}
                  />
                </div>
                <p className="hint">{withMockLabel(detail.placeholder_notes)}</p>
                <div className="field">
                  <label htmlFor="tpl-summary">修改内容</label>
                  <input
                    id="tpl-summary"
                    value={changeSummary}
                    disabled={saving}
                    onChange={(event) => setChangeSummary(event.target.value)}
                  />
                </div>
                {savedVersion ? (
                  <p className="hint">
                    {withMockLabel(
                      `新版本 v${savedVersion.version} · ${savedVersion.editor} · ${formatTime(savedVersion.edited_at)} · ${savedVersion.change_summary}`,
                    )}
                  </p>
                ) : null}
                {saveError ? <p className="error-text" role="alert">{saveError}</p> : null}
                <div className="tpl-primary-row">
                  <button className="btn btn-primary" type="submit" disabled={!canSave}>
                    {saving ? '保存中…' : '保存新版本'}
                  </button>
                </div>
              </form>

              <form className="tpl-block" onSubmit={onPreview}>
                <h2>预览代入</h2>
                <div className="field">
                  <label htmlFor="tpl-sample">测试说法</label>
                  <input
                    id="tpl-sample"
                    value={sampleUtterance}
                    placeholder={SAMPLE_UTTERANCE_HINT}
                    disabled={previewing}
                    onChange={(event) => setSampleUtterance(event.target.value)}
                  />
                </div>
                <button className="btn btn-secondary" type="submit" disabled={previewing || !sampleUtterance.trim()}>
                  {previewing ? '预览中…' : '预览'}
                </button>
                <p className="hint">{withMockLabel('预览只替换占位，不会发出坐席回复。')}</p>
                {previewError ? <p className="error-text" role="alert">{previewError}</p> : null}
                {previewBody ? <pre className="tpl-preview">{withMockLabel(previewBody)}</pre> : null}
              </form>

              <form className="tpl-block" onSubmit={onCompare}>
                <h2>版本对比</h2>
                <div className="tpl-compare-row">
                  <label className="field">
                    <span>从</span>
                    <select
                      value={fromVersion}
                      onChange={(event) => setFromVersion(event.target.value ? Number(event.target.value) : '')}
                    >
                      {versions.map((item) => (
                        <option key={`from-${item.version}`} value={item.version}>
                          v{item.version} · {item.editor}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>到</span>
                    <select
                      value={toVersion}
                      onChange={(event) => setToVersion(event.target.value ? Number(event.target.value) : '')}
                    >
                      {versions.map((item) => (
                        <option key={`to-${item.version}`} value={item.version}>
                          v{item.version} · {item.editor}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn btn-secondary" type="submit" disabled={fromVersion === '' || toVersion === ''}>
                    对比
                  </button>
                </div>
                <ul className="tpl-versions">
                  {versions.map((item) => (
                    <li key={item.version}>
                      {withMockLabel(
                        `v${item.version} · ${item.editor} · ${formatTime(item.edited_at)} · ${item.change_summary}`,
                      )}
                    </li>
                  ))}
                </ul>
                {diff ? <pre className="tpl-preview">{withMockLabel(diff)}</pre> : null}
              </form>

              <div className="tpl-block">
                <h2>灰度与回滚</h2>
                <div className="tpl-toolbar-row">
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={grayBlocked || releasing || !detail}
                    onClick={() => void release()}
                  >
                    {releasing ? '发布中…' : '灰度约 5%'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={rollingBack || !detail}
                    onClick={() => void rollback()}
                  >
                    {rollingBack ? '回滚中…' : '回滚'}
                  </button>
                </div>
                {grayBlocked ? (
                  <p className="hint" role="status">
                    {withMockLabel(grayBlockedReason)}
                  </p>
                ) : (
                  <p className="hint">{withMockLabel('新版本先给约 5% 会话使用。')}</p>
                )}
                {releaseError ? <p className="error-text" role="alert">{releaseError}</p> : null}
                {rollbackMessage ? <p className="hint" role="status">{rollbackMessage}</p> : null}
              </div>

              {metrics ? (
                <div className="tpl-block">
                  <h2>评测指标</h2>
                  <p className="hint">
                    {withMockLabel(
                      `抽取准确率 ${formatRate(metrics.extraction_accuracy)} · 采纳率 ${formatRate(metrics.adoption_rate)} · 合规拦截率 ${formatRate(metrics.compliance_intercept_rate)} · 修改率 ${formatRate(metrics.modification_rate)} · 投诉率 ${formatRate(metrics.complaint_rate)}`,
                    )}
                  </p>
                  {metrics.stable && metrics.gray ? (
                    <ul className="tpl-versions" aria-label="新旧版本对照">
                      <li data-slice="stable">
                        {withMockLabel(`旧版 v${metrics.stable_version}（稳定）：${sliceText(metrics.stable)}`)}
                      </li>
                      <li data-slice="gray">
                        {withMockLabel(`新版 v${metrics.gray_version}（灰度）：${sliceText(metrics.gray)}`)}
                      </li>
                    </ul>
                  ) : null}
                  <p className="hint">{withMockLabel(metrics.feedback_summary)}</p>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </div>
  )
}

const TPL_STYLES = `
.tpl-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #f4f6f8;
}
.tpl-page h1 {
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
  margin: 0 0 8px;
}
.tpl-page h2 {
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  margin: 0 0 8px;
}
.tpl-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 12px 24px;
  background: #ffffff;
  border-bottom: 1px solid #d9e2ec;
  flex-shrink: 0;
}
.tpl-toolbar-block {
  flex: 1;
  min-width: 280px;
}
.tpl-toolbar-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-end;
}
.tpl-toolbar .field {
  margin-bottom: 0;
  min-width: 160px;
}
.tpl-toolbar input[type="file"],
.tpl-toolbar input[type="number"],
.tpl-edit input,
.tpl-edit textarea,
.tpl-block input,
.tpl-block select {
  height: 40px;
  border: 1px solid #d9e2ec;
  border-radius: 6px;
  padding: 0 12px;
  background: #ffffff;
  color: #1f2933;
  width: 100%;
}
.tpl-toolbar input[type="file"] {
  height: 40px;
  max-width: 280px;
  padding: 8px;
  width: auto;
}
.tpl-edit textarea {
  height: auto;
  min-height: 160px;
  padding: 8px 12px;
  resize: vertical;
}
.tpl-toolbar input:hover:not(:disabled),
.tpl-edit input:hover:not(:disabled),
.tpl-edit textarea:hover:not(:disabled),
.tpl-block input:hover:not(:disabled),
.tpl-block select:hover:not(:disabled) { border-color: #b8c4d0; }
.tpl-toolbar input:active:not(:disabled),
.tpl-edit input:active:not(:disabled),
.tpl-edit textarea:active:not(:disabled),
.tpl-block input:active:not(:disabled),
.tpl-block select:active:not(:disabled) { border-color: #1d4e89; }
.tpl-toolbar input:focus-visible,
.tpl-edit input:focus-visible,
.tpl-edit textarea:focus-visible,
.tpl-block input:focus-visible,
.tpl-block select:focus-visible {
  outline: 2px solid #1d4e89;
  outline-offset: 2px;
  border-color: #1d4e89;
}
.tpl-toolbar input:disabled,
.tpl-edit input:disabled,
.tpl-edit textarea:disabled,
.tpl-block input:disabled,
.tpl-block select:disabled {
  background: #e4e7eb;
  color: #5c6b7a;
  cursor: not-allowed;
}
.tpl-split {
  display: flex;
  flex: 1;
  min-height: 0;
}
.tpl-list {
  width: 320px;
  border-right: 1px solid #d9e2ec;
  background: #ffffff;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
}
.tpl-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 12px 16px;
  border: 0;
  border-bottom: 1px solid #d9e2ec;
  background: #ffffff;
  color: #1f2933;
  min-height: 56px;
  border-radius: 0;
  font-weight: 400;
}
.tpl-row:hover:not(:disabled) { background: #f4f6f8; }
.tpl-row:active:not(:disabled) { background: #e4e7eb; }
.tpl-row:focus-visible {
  outline: 2px solid #1d4e89;
  outline-offset: -2px;
}
.tpl-row:disabled {
  background: #e4e7eb;
  color: #5c6b7a;
  cursor: not-allowed;
}
.tpl-row.selected { background: #e8f1fa; }
.tpl-row-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tpl-row-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tpl-row .hint { margin: 0; }
.tpl-alert,
.tpl-alert-inline {
  color: #b42318;
  font-size: 12px;
  line-height: 18px;
  flex-shrink: 0;
  max-width: 96px;
}
.tpl-alert-inline {
  max-width: none;
  margin: 0 0 12px;
}
.tpl-empty,
.tpl-pad {
  padding: 24px 16px;
  color: #5c6b7a;
}
.tpl-editor {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 16px 24px 24px;
  background: #ffffff;
}
.tpl-block {
  margin: 24px 0 0;
  padding-top: 16px;
  border-top: 1px solid #d9e2ec;
}
.tpl-primary-row {
  display: flex;
  justify-content: flex-start;
  margin-top: 8px;
}
.tpl-compare-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-end;
}
.tpl-compare-row .field {
  margin-bottom: 0;
  min-width: 160px;
}
.tpl-versions {
  margin: 12px 0 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 18px;
  color: #5c6b7a;
}
.tpl-preview {
  margin: 12px 0 0;
  padding: 12px;
  background: #f4f6f8;
  border: 1px solid #d9e2ec;
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
}
@media (max-width: 1023px) {
  .tpl-page h1 { font-size: 18px; line-height: 26px; }
  .tpl-split { flex-direction: column; }
  .tpl-list {
    width: 100%;
    max-height: 40vh;
    border-right: 0;
    border-bottom: 1px solid #d9e2ec;
  }
}
`
