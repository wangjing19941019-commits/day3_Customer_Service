import type { DocumentListItem, IngestStatus } from '../../services/documentService.ts'
import { withMockLabel } from '../../utils/mockFlag.ts'
import { formatUpdatedAt } from './formatUpdatedAt.ts'
import './knowledgeList.css'

type DocumentListRowProps = {
  item: DocumentListItem
  selected: boolean
  onSelect: (documentId: string) => void
}

function statusLabel(status: IngestStatus): string {
  if (status === 'ready') return '已完成'
  if (status === 'ingesting') return '入库中'
  return '请重新上传'
}

function statusClass(status: IngestStatus): string {
  if (status === 'ready') return 'ok'
  if (status === 'ingesting') return 'warn'
  return 'bad'
}

export function DocumentListRow({ item, selected, onSelect }: DocumentListRowProps) {
  const time = formatUpdatedAt(item.updated_at)
  return (
    <button
      type="button"
      className={`kb-row${selected ? ' selected' : ''}`}
      title={item.filename}
      onClick={() => onSelect(item.id)}
    >
      <div className="kb-row-title">{withMockLabel(item.filename)}</div>
      <div className="hint">
        <span className={`kb-dot ${statusClass(item.ingest_status)}`} />
        <span className={`kb-status ${statusClass(item.ingest_status)}`}>
          {statusLabel(item.ingest_status)}
        </span>
        {item.ingest_status === 'ready' && item.chunk_count > 0 ? ` · ${item.chunk_count} 块` : ''}
        {time ? (
          <span className="kb-row-time">{` · ${withMockLabel(time)}`}</span>
        ) : null}
      </div>
    </button>
  )
}
