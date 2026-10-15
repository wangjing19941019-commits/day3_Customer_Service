import { DOCUMENT_VISIBILITY_OPTIONS, type DocumentVisibility } from '../../types/document.ts'
import { withMockLabel } from '../../utils/mockFlag.ts'
import { visibilityLabel } from './documentVisibility.ts'
import './knowledgeList.css'

type DocumentVisibilityEditorProps = {
  visibility: DocumentVisibility
  effectiveFrom: string
  effectiveTo: string
  saving: boolean
  onVisibilityChange: (next: DocumentVisibility) => void
  onEffectiveFromChange: (next: string) => void
  onEffectiveToChange: (next: string) => void
  onSave: () => void
}

export function DocumentVisibilityEditor({
  visibility,
  effectiveFrom,
  effectiveTo,
  saving,
  onVisibilityChange,
  onEffectiveFromChange,
  onEffectiveToChange,
  onSave,
}: DocumentVisibilityEditorProps) {
  const currentLabel = visibilityLabel(visibility)
  return (
    <fieldset className="kb-fieldset">
      <legend>可见范围与政策生效时间</legend>
      {currentLabel ? (
        <p className="hint">{withMockLabel(`当前可见范围：${currentLabel}`)}</p>
      ) : null}
      <div className="kb-visibility" role="radiogroup" aria-label="可见范围">
        {DOCUMENT_VISIBILITY_OPTIONS.map((item) => (
          <label key={item.code} className="kb-check">
            <input
              type="radio"
              name="kb-visibility"
              value={item.code}
              checked={visibility === item.code}
              disabled={saving}
              onChange={() => onVisibilityChange(item.code)}
            />
            {item.name}
          </label>
        ))}
      </div>
      <div className="kb-effective">
        <label>
          生效开始时间
          <input
            type="datetime-local"
            aria-label="生效开始时间"
            value={effectiveFrom}
            disabled={saving}
            onChange={(event) => onEffectiveFromChange(event.target.value)}
          />
        </label>
        <label>
          生效结束时间
          <input
            type="datetime-local"
            aria-label="生效结束时间"
            value={effectiveTo}
            disabled={saving}
            onChange={(event) => onEffectiveToChange(event.target.value)}
          />
        </label>
      </div>
      <button
        className="btn btn-secondary"
        type="button"
        disabled={saving}
        onClick={onSave}
      >
        {saving ? '保存中…' : '保存可见范围和生效时间'}
      </button>
    </fieldset>
  )
}
