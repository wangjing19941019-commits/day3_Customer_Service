import type { IngestStatus } from '../../types/api.ts'
import './knowledgeList.css'

export type DocumentListFilter = 'all' | IngestStatus

const FILTER_OPTIONS: ReadonlyArray<{ value: DocumentListFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'ingesting', label: '入库中' },
  { value: 'ready', label: '已完成' },
  { value: 'failed', label: '请重新上传' },
]

type IngestStatusFilterProps = {
  value: DocumentListFilter
  onChange: (next: DocumentListFilter) => void
}

export function IngestStatusFilter({ value, onChange }: IngestStatusFilterProps) {
  return (
    <div className="kb-filter" role="radiogroup" aria-label="入库状态筛选">
      {FILTER_OPTIONS.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            className={`kb-filter-btn${selected ? ' selected' : ''}`}
            data-filter={option.value}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
