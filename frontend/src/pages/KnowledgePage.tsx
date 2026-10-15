import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { DocumentListRow } from '../components/knowledge/DocumentListRow.tsx'
import { DocumentVisibilityEditor } from '../components/knowledge/DocumentVisibilityEditor.tsx'
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from '../components/knowledge/documentVisibility.ts'
import { IngestStatusFilter } from '../components/knowledge/IngestStatusFilter.tsx'
import '../components/knowledge/knowledgeList.css'
import { useDocuments } from '../hooks/useDocuments.ts'
import type { DocumentVisibility } from '../types/document.ts'
import {
  CHUNK_STRATEGY_TEXT,
  EMPTY_ALL_DOCUMENTS_TEXT,
  ENTITY_TYPE_OPTIONS,
  OBJECT_TYPE_OPTIONS,
  REQUEST_TYPE_OPTIONS,
  UPLOAD_HINT_TEXT,
  type EntityTagType,
} from '../mocks/documents.ts'
import { DOCUMENT_UPLOAD_ACCEPT } from '../types/api.ts'
import { withMockLabel } from '../utils/mockFlag.ts'

type FaqDraft = { key: string; id?: string; question: string; answer: string }
type EntityDraft = { key: string; name: string; type: EntityTagType }

function optionName(options: readonly { code: string; name: string }[], code: string): string {
  return options.find((item) => item.code === code)?.name ?? code
}

function newKey(): string {
  return crypto.randomUUID()
}

export default function KnowledgePage() {
  const {
    documents,
    ingestFilter,
    selectedId,
    detail,
    listError,
    uploadError,
    saveError,
    saveMessage,
    uploading,
    saving,
    selectDocument,
    setIngestFilter,
    uploadFile,
    saveDocument,
  } = useDocuments()

  const [file, setFile] = useState<File | null>(null)
  const [objectTypes, setObjectTypes] = useState<string[]>([])
  const [requestTypes, setRequestTypes] = useState<string[]>([])
  const [entities, setEntities] = useState<EntityDraft[]>([])
  const [faqs, setFaqs] = useState<FaqDraft[]>([])
  const [visibility, setVisibility] = useState<DocumentVisibility>('user_visible')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [effectiveTo, setEffectiveTo] = useState('')

  const ready = detail?.ingest_status === 'ready'

  useEffect(() => {
    if (!detail || detail.ingest_status !== 'ready') {
      setObjectTypes([])
      setRequestTypes([])
      setEntities([])
      setFaqs([])
      setVisibility('user_visible')
      setEffectiveFrom('')
      setEffectiveTo('')
      return
    }
    setObjectTypes([...detail.object_types])
    setRequestTypes([...detail.request_types])
    setEntities(
      detail.entities.map((item) => ({
        key: newKey(),
        name: item.name,
        type: item.type,
      })),
    )
    setFaqs(
      detail.faqs.map((item) => ({
        key: item.id,
        id: item.id,
        question: item.question,
        answer: item.answer,
      })),
    )
    setVisibility(detail.visibility ?? 'user_visible')
    setEffectiveFrom(toDatetimeLocalValue(detail.effective_from))
    setEffectiveTo(toDatetimeLocalValue(detail.effective_to))
  }, [detail])

  const displayedTags = useMemo(() => {
    if (!ready) return []
    return [
      ...objectTypes.map((code) => optionName(OBJECT_TYPE_OPTIONS, code)),
      ...requestTypes.map((code) => optionName(REQUEST_TYPE_OPTIONS, code)),
    ]
  }, [objectTypes, ready, requestTypes])

  async function onUpload(event: FormEvent) {
    event.preventDefault()
    await uploadFile(file ?? undefined)
  }

  function toggleCode(list: string[], code: string, setter: (next: string[]) => void) {
    setter(list.includes(code) ? list.filter((item) => item !== code) : [...list, code])
  }

  async function onSave(event: FormEvent) {
    event.preventDefault()
    await saveDocument({
      object_types: objectTypes,
      request_types: requestTypes,
      entities: entities
        .filter((item) => item.name.trim())
        .map((item) => ({ name: item.name.trim(), type: item.type })),
      faqs: faqs.map((item) => ({
        id: item.id,
        question: item.question,
        answer: item.answer,
      })),
    })
  }

  async function onSaveVisibility() {
    await saveDocument({
      visibility,
      effective_from: fromDatetimeLocalValue(effectiveFrom),
      effective_to: fromDatetimeLocalValue(effectiveTo),
    })
  }

  return (
    <div className="kb-page">
      <style>{KB_STYLES}</style>
      <form className="kb-upload" onSubmit={(event) => void onUpload(event)}>
        <input
          id="kb-file"
          type="file"
          accept={DOCUMENT_UPLOAD_ACCEPT}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          disabled={uploading}
        />
        <button className="btn btn-primary" type="submit" disabled={uploading}>
          {uploading ? '上传中…' : '上传'}
        </button>
        <p className="hint kb-upload-hint">{withMockLabel(UPLOAD_HINT_TEXT)}</p>
        <p className="error-text" role="alert">
          {uploadError}
        </p>
      </form>

      <div className="kb-split">
        <div className="kb-list">
          <IngestStatusFilter
            value={ingestFilter}
            onChange={(next) => {
              void setIngestFilter(next)
            }}
          />
          <div className="kb-list-scroll" aria-label="文档列表">
            {listError ? (
              <p className="error-text kb-pad">{listError}</p>
            ) : null}
            {documents.length === 0 && !listError ? (
              <p className="kb-empty">
                {withMockLabel(
                  ingestFilter === 'all'
                    ? EMPTY_ALL_DOCUMENTS_TEXT
                    : '当前没有该状态的文档',
                )}
              </p>
            ) : (
              documents.map((item) => (
                <DocumentListRow
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onSelect={selectDocument}
                />
              ))
            )}
          </div>
        </div>

        <aside className="kb-detail" aria-label="文档详情">
          {!detail ? (
            <p className="hint">{withMockLabel('选择一篇已完成的文档以查看分块并编辑标签。')}</p>
          ) : detail.ingest_status === 'ingesting' ? (
            <p className="hint">
              {withMockLabel('这篇文档正在入库中，完成后才能查看分块并修改标签、FAQ、可见范围或生效时间。')}
            </p>
          ) : detail.ingest_status === 'failed' ? (
            <p className="error-text">{withMockLabel(detail.ingest_error || '请重新上传')}</p>
          ) : (
            <>
              <p className="hint">
                {withMockLabel(`${CHUNK_STRATEGY_TEXT} 本篇共 ${detail.chunks.length} 块（只读）。`)}
              </p>
              <div className="kb-chunks">
                {detail.chunks.map((chunk) => (
                  <article key={chunk.position} className="kb-chunk">
                    <div className="kb-chunk-meta">
                      分块 {chunk.position}
                      {chunk.heading_path ? ` · ${withMockLabel(chunk.heading_path)}` : ''}
                    </div>
                    <div className="kb-chunk-body">{withMockLabel(chunk.content)}</div>
                  </article>
                ))}
              </div>

              <form className="kb-edit" onSubmit={(event) => void onSave(event)}>
                <h2>标签与 FAQ</h2>
                {displayedTags.length > 0 ? (
                  <p className="hint">{withMockLabel(`当前标签：${displayedTags.join(' · ')}`)}</p>
                ) : null}

                <fieldset className="kb-fieldset">
                  <legend>对象标签</legend>
                  {OBJECT_TYPE_OPTIONS.map((item) => (
                    <label key={item.code} className="kb-check">
                      <input
                        type="checkbox"
                        checked={objectTypes.includes(item.code)}
                        onChange={() => toggleCode(objectTypes, item.code, setObjectTypes)}
                        disabled={saving}
                      />
                      {item.name}
                    </label>
                  ))}
                </fieldset>

                <fieldset className="kb-fieldset">
                  <legend>诉求标签</legend>
                  {REQUEST_TYPE_OPTIONS.map((item) => (
                    <label key={item.code} className="kb-check">
                      <input
                        type="checkbox"
                        checked={requestTypes.includes(item.code)}
                        onChange={() => toggleCode(requestTypes, item.code, setRequestTypes)}
                        disabled={saving}
                      />
                      {item.name}
                    </label>
                  ))}
                </fieldset>

                <fieldset className="kb-fieldset">
                  <legend>实体</legend>
                  {entities.map((item, index) => (
                    <div key={item.key} className="kb-entity">
                      <input
                        aria-label={`实体名称 ${index + 1}`}
                        value={item.name}
                        disabled={saving}
                        onChange={(event) => {
                          const next = [...entities]
                          next[index] = { ...item, name: event.target.value }
                          setEntities(next)
                        }}
                      />
                      <select
                        aria-label={`实体类型 ${index + 1}`}
                        value={item.type}
                        disabled={saving}
                        onChange={(event) => {
                          const next = [...entities]
                          next[index] = { ...item, type: event.target.value as EntityTagType }
                          setEntities(next)
                        }}
                      >
                        {ENTITY_TYPE_OPTIONS.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={saving}
                        onClick={() => setEntities(entities.filter((_, i) => i !== index))}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      setEntities([...entities, { key: newKey(), name: '', type: 'product' }])
                    }
                  >
                    添加实体
                  </button>
                  </fieldset>

                <DocumentVisibilityEditor
                  visibility={visibility}
                  effectiveFrom={effectiveFrom}
                  effectiveTo={effectiveTo}
                  saving={saving}
                  onVisibilityChange={setVisibility}
                  onEffectiveFromChange={setEffectiveFrom}
                  onEffectiveToChange={setEffectiveTo}
                  onSave={() => {
                    void onSaveVisibility()
                  }}
                />

                <fieldset className="kb-fieldset">
                  <legend>FAQ</legend>
                  {faqs.map((item, index) => (
                    <div key={item.key} className="kb-faq">
                      <label>
                        问法 {index + 1}
                        <input
                          value={item.question}
                          disabled={saving}
                          onChange={(event) => {
                            const next = [...faqs]
                            next[index] = { ...item, question: event.target.value }
                            setFaqs(next)
                          }}
                        />
                      </label>
                      <label>
                        答案 {index + 1}
                        <textarea
                          value={item.answer}
                          disabled={saving}
                          rows={3}
                          onChange={(event) => {
                            const next = [...faqs]
                            next[index] = { ...item, answer: event.target.value }
                            setFaqs(next)
                          }}
                        />
                      </label>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={saving}
                        onClick={() => setFaqs(faqs.filter((_, i) => i !== index))}
                      >
                        删除 FAQ
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      setFaqs([...faqs, { key: newKey(), question: '', answer: '' }])
                    }
                  >
                    添加 FAQ
                  </button>
                </fieldset>

                <button className="btn btn-primary" type="submit" disabled={saving}>
                  {saving ? '保存中…' : '保存'}
                </button>
                {saveError ? (
                  <p className="error-text" role="alert">
                    {saveError}
                  </p>
                ) : (
                  <p className="hint">{saveMessage}</p>
                )}
              </form>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

const KB_STYLES = `
.kb-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #f4f6f8;
}
.kb-upload {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 12px 24px;
  background: #ffffff;
  border-bottom: 1px solid #d9e2ec;
  min-height: 64px;
  flex-shrink: 0;
}
.kb-upload-hint { margin: 0; }
.kb-upload .error-text { margin: 0; min-height: 0; }
.kb-upload input[type="file"] {
  height: 40px;
  max-width: 280px;
  border: 1px solid #d9e2ec;
  border-radius: 6px;
  padding: 8px;
  background: #ffffff;
  color: #1f2933;
}
.kb-upload input[type="file"]:hover:not(:disabled) { border-color: #b8c4d0; }
.kb-upload input[type="file"]:active:not(:disabled) { border-color: #1d4e89; }
.kb-upload input[type="file"]:focus-visible {
  outline: 2px solid #1d4e89;
  outline-offset: 2px;
}
.kb-upload input[type="file"]:disabled {
  background: #e4e7eb;
  color: #5c6b7a;
  cursor: not-allowed;
}
.kb-split {
  display: flex;
  flex: 1;
  min-height: 0;
}
.kb-detail {
  width: 560px;
  min-width: 520px;
  flex: 1;
  border-left: 1px solid #d9e2ec;
  background: #ffffff;
  overflow: auto;
  padding: 16px;
  min-height: 0;
}
.kb-detail h2 {
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  margin: 16px 0 8px;
}
.kb-chunks { display: flex; flex-direction: column; gap: 8px; }
.kb-chunk {
  border: 1px solid #d9e2ec;
  border-radius: 8px;
  padding: 12px;
  background: #f4f6f8;
}
.kb-chunk-meta {
  font-size: 12px;
  line-height: 18px;
  color: #5c6b7a;
  margin-bottom: 8px;
}
.kb-chunk-body {
  font-size: 14px;
  line-height: 22px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
}
.kb-fieldset {
  border: 1px solid #d9e2ec;
  border-radius: 8px;
  padding: 12px;
  margin: 0 0 16px;
}
.kb-fieldset legend {
  font-size: 12px;
  color: #5c6b7a;
  padding: 0 4px;
}
.kb-check {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}
.kb-check input {
  width: 16px;
  height: 16px;
}
.kb-check input:hover:not(:disabled) { outline: 1px solid #1d4e89; }
.kb-check input:active:not(:disabled) { outline: 2px solid #163a66; }
.kb-check input:focus-visible {
  outline: 2px solid #1d4e89;
  outline-offset: 2px;
}
.kb-check input:disabled { cursor: not-allowed; }
.kb-entity, .kb-faq {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.kb-entity {
  display: grid;
  grid-template-columns: 1fr 120px auto;
  gap: 8px;
  align-items: center;
}
.kb-edit input, .kb-edit select, .kb-edit textarea {
  height: 40px;
  border: 1px solid #d9e2ec;
  border-radius: 6px;
  padding: 0 12px;
  background: #ffffff;
  color: #1f2933;
  width: 100%;
}
.kb-edit textarea {
  height: auto;
  min-height: 48px;
  padding: 8px 12px;
  resize: vertical;
}
.kb-edit input:hover:not(:disabled),
.kb-edit select:hover:not(:disabled),
.kb-edit textarea:hover:not(:disabled) { border-color: #b8c4d0; }
.kb-edit input:active:not(:disabled),
.kb-edit select:active:not(:disabled),
.kb-edit textarea:active:not(:disabled) { border-color: #1d4e89; }
.kb-edit input:focus-visible,
.kb-edit select:focus-visible,
.kb-edit textarea:focus-visible {
  outline: 2px solid #1d4e89;
  outline-offset: 2px;
  border-color: #1d4e89;
}
.kb-edit input:disabled,
.kb-edit select:disabled,
.kb-edit textarea:disabled {
  background: #e4e7eb;
  color: #5c6b7a;
  cursor: not-allowed;
}
.kb-faq label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-weight: 600;
}
@media (max-width: 1023px) {
  .kb-split { flex-direction: column; }
  .kb-detail {
    width: 100%;
    min-width: 0;
    border-left: 0;
    border-top: 1px solid #d9e2ec;
  }
  .kb-entity { grid-template-columns: 1fr; }
}
`
