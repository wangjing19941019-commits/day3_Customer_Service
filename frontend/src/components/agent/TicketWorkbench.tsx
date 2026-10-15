import {
  BUSINESS_LINES,
  DISPUTE_TYPE_OPTIONS,
  EXCEPTION_TYPE_OPTIONS,
  FIELD_LABELS,
  FIELD_STATUS_LABEL,
  INVOICE_KIND_OPTIONS,
  NEED_ESCALATE_OPTIONS,
  RESPONSIBLE_PARTY_OPTIONS,
  RETURN_METHOD_OPTIONS,
  TICKET_TYPES,
} from '../../mocks/tickets.ts'
import type {
  BusinessLine,
  FieldStatus,
  OrderOrValueCandidate,
  TicketField,
  TicketPublic,
  TicketType,
  TicketUpdate,
} from '../../types/ticket.ts'
import { withMockLabel } from '../../utils/mockFlag.ts'

type TicketWorkbenchProps = {
  ticket: TicketPublic | null
  error: string
  confirming: boolean
  uploading: boolean
  onPatch: (payload: TicketUpdate) => Promise<void>
  onFieldChange: (key: string, value: string) => void
  onFieldSubmit: (key: string, value: string) => Promise<void>
  onChooseCandidate: (key: string, value: string) => Promise<void>
  onResolveConflict: (key: string, value: string) => Promise<void>
  onUploadEvidence: (file: File) => Promise<void>
  onConfirm: () => Promise<void>
}

const TEXT_AREAS = new Set([
  'intent_summary',
  'incident_summary',
  'user_expectation',
  'diff_reason',
  'user_request',
  'compensation_plan',
])

const LOGISTICS_LOCKED = new Set(['responsible_party', 'compensation_plan'])

function optionsFor(key: string) {
  if (key === 'return_method') return RETURN_METHOD_OPTIONS
  if (key === 'invoice_kind') return INVOICE_KIND_OPTIONS
  if (key === 'need_escalate') return NEED_ESCALATE_OPTIONS
  if (key === 'dispute_type') return DISPUTE_TYPE_OPTIONS
  if (key === 'exception_type') return EXCEPTION_TYPE_OPTIONS
  if (key === 'responsible_party') return RESPONSIBLE_PARTY_OPTIONS
  return null
}

function statusTone(status: FieldStatus): string {
  if (status === 'filled' || status === 'agent_edited') return 'slot-filled'
  if (status === 'candidate') return 'slot-candidate'
  return 'slot-danger'
}

function candidateValue(item: OrderOrValueCandidate): string {
  return item.order_no ?? item.value ?? ''
}

function candidateLabel(item: OrderOrValueCandidate): string {
  if (item.label) return item.label
  if (item.order_no && item.title) return `${item.order_no} · ${item.title}`
  return item.order_no ?? item.value ?? ''
}

function progressEntries(progress: unknown[]): { key: string; at: string; text: string }[] {
  if (!Array.isArray(progress)) return []
  const rows: { key: string; at: string; text: string }[] = []
  progress.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const record = item as Record<string, unknown>
    const text =
      (typeof record.detail === 'string' && record.detail.trim()) ||
      (typeof record.summary === 'string' && record.summary.trim()) ||
      ''
    if (!text) return
    const at =
      (typeof record.at === 'string' && record.at) ||
      (typeof record.created_at === 'string' && record.created_at) ||
      ''
    const key = (typeof record.id === 'string' && record.id) || `${index}-${text}`
    rows.push({ key, at, text })
  })
  return rows
}

function FieldStatusMark({ status }: { status: FieldStatus }) {
  return (
    <div className={`field-status ${statusTone(status)}`}>
      <span className="field-status-dot" aria-hidden="true" />
      <span>{FIELD_STATUS_LABEL[status]}</span>
    </div>
  )
}

export function TicketWorkbench({
  ticket,
  error,
  confirming,
  uploading,
  onPatch,
  onFieldChange,
  onFieldSubmit,
  onChooseCandidate,
  onResolveConflict,
  onUploadEvidence,
  onConfirm,
}: TicketWorkbenchProps) {
  if (!ticket) {
    return (
      <div className="work-block">
        <h2>{withMockLabel('工单')}</h2>
        <p className="hint">{withMockLabel('正在读取工单…')}</p>
      </div>
    )
  }

  const confirmed = ticket.status !== 'draft'
  const confirmDisabled = !ticket.can_confirm || confirming
  const extracting = ticket.extract_status === 'extracting'
  const logisticsLocked = ticket.logistics_snapshot?.query_status !== 'ok'
  const progressRows = progressEntries(ticket.progress)

  return (
    <div className="work-block">
      <h2>{withMockLabel('工单')}</h2>
      {confirmed ? (
        <p className="hint">{withMockLabel('已确认，不再自动预填；可手改字段和业务线，不能改类型。')}</p>
      ) : null}
      {extracting ? (
        <p className="extract-banner" role="status">
          {withMockLabel('正在根据对话补全…')}
        </p>
      ) : null}
      {ticket.extract_status === 'failed' && ticket.extract_error ? (
        <p className="error-text">{withMockLabel(ticket.extract_error)}</p>
      ) : null}
      {ticket.order_match?.status === 'query_failed' || ticket.order_match?.query_message ? (
        <p className="hint">{withMockLabel(ticket.order_match.query_message ?? '暂未查到')}</p>
      ) : null}
      {ticket.logistics_snapshot?.note ? (
        <p className="hint">{withMockLabel(ticket.logistics_snapshot.note)}</p>
      ) : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="agent-business-line">业务线</label>
        <select
          id="agent-business-line"
          value={ticket.business_line ?? ''}
          onChange={(event) => {
            const value = event.target.value
            void onPatch({ business_line: value === '' ? null : (value as BusinessLine) })
          }}
        >
          <option value="">请选择</option>
          {BUSINESS_LINES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="agent-ticket-type">工单类型</label>
        <select
          id="agent-ticket-type"
          value={ticket.ticket_type ?? ''}
          disabled={confirmed}
          onChange={(event) => {
            const value = event.target.value
            void onPatch({ ticket_type: value === '' ? null : (value as TicketType) })
          }}
        >
          <option value="">售前咨询（不建单）</option>
          {TICKET_TYPES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {Object.entries(ticket.fields).map(([key, field]) => (
        <TicketFieldRow
          key={key}
          fieldKey={key}
          field={field}
          locked={LOGISTICS_LOCKED.has(key) && logisticsLocked}
          onFieldChange={onFieldChange}
          onFieldSubmit={onFieldSubmit}
          onChooseCandidate={onChooseCandidate}
          onResolveConflict={onResolveConflict}
        />
      ))}

      {ticket.ticket_type === 'fee_dispute' ? (
        <div className="field">
          <label htmlFor="ticket-evidence">证据截图</label>
          <input
            id="ticket-evidence"
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void onUploadEvidence(file)
            }}
          />
          {ticket.attachments.length === 0 ? (
            <FieldStatusMark status="missing" />
          ) : (
            <ul className="attach-list">
              {ticket.attachments.map((item) => (
                <li key={item.id}>{item.filename}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {progressRows.length > 0 ? (
        <div className="field" aria-label="工单进度">
          <label>进度</label>
          <ol className="attach-list">
            {progressRows.map((item) => (
              <li key={item.key}>
                {item.at ? <time dateTime={item.at}>{item.at}</time> : null}
                {item.at ? ' ' : null}
                <span>{withMockLabel(item.text)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {!confirmed && ticket.confirm_blockers.length > 0 ? (
        <p className="hint">
          {withMockLabel(
            `确认被挡住：${ticket.confirm_blockers.map((key) => FIELD_LABELS[key] ?? key).join('、')}`,
          )}
        </p>
      ) : null}

      <button
        className="btn btn-primary confirm-ticket"
        type="button"
        disabled={confirmDisabled}
        onClick={() => void onConfirm()}
      >
        {confirmed ? '已确认' : confirming ? '确认中…' : '确认工单'}
      </button>
    </div>
  )
}

type TicketFieldRowProps = {
  fieldKey: string
  field: TicketField
  locked: boolean
  onFieldChange: (key: string, value: string) => void
  onFieldSubmit: (key: string, value: string) => Promise<void>
  onChooseCandidate: (key: string, value: string) => Promise<void>
  onResolveConflict: (key: string, value: string) => Promise<void>
}

function TicketFieldRow({
  fieldKey,
  field,
  locked,
  onFieldChange,
  onFieldSubmit,
  onChooseCandidate,
  onResolveConflict,
}: TicketFieldRowProps) {
  const label = FIELD_LABELS[fieldKey] ?? fieldKey
  const choices = optionsFor(fieldKey)
  const value = field.value ?? ''
  const id = `ticket-field-${fieldKey}`
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {choices ? (
        <select
          id={id}
          value={value}
          disabled={locked}
          onChange={(event) => {
            onFieldChange(fieldKey, event.target.value)
            void onFieldSubmit(fieldKey, event.target.value)
          }}
        >
          <option value="">请选择</option>
          {choices.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      ) : TEXT_AREAS.has(fieldKey) ? (
        <textarea
          id={id}
          rows={2}
          value={value}
          disabled={locked}
          onChange={(event) => onFieldChange(fieldKey, event.target.value)}
          onBlur={(event) => void onFieldSubmit(fieldKey, event.target.value)}
        />
      ) : (
        <input
          id={id}
          value={value}
          disabled={locked}
          onChange={(event) => onFieldChange(fieldKey, event.target.value)}
          onBlur={(event) => void onFieldSubmit(fieldKey, event.target.value)}
        />
      )}
      <FieldStatusMark status={field.status} />
      {field.status === 'candidate' && field.candidates.length > 0 ? (
        <div className="candidate-list" role="group" aria-label={`${label}候选`}>
          {field.candidates.map((item) => {
            const next = candidateValue(item)
            return (
              <button
                key={`${fieldKey}-${next}`}
                className="btn btn-secondary candidate-btn"
                type="button"
                aria-pressed="false"
                onClick={() => void onChooseCandidate(fieldKey, next)}
              >
                {withMockLabel(candidateLabel(item))}
              </button>
            )
          })}
        </div>
      ) : null}
      {field.status === 'conflict' ? (
        <div className="conflict-row">
          <p className="hint">
            {withMockLabel(`原值 ${field.value ?? '空'}，新值 ${field.conflict_value ?? '空'}`)}
          </p>
          {field.value ? (
            <button
              className="btn btn-secondary candidate-btn"
              type="button"
              onClick={() => void onResolveConflict(fieldKey, field.value ?? '')}
            >
              保留原值
            </button>
          ) : null}
          {field.conflict_value ? (
            <button
              className="btn btn-secondary candidate-btn"
              type="button"
              onClick={() => void onResolveConflict(fieldKey, field.conflict_value ?? '')}
            >
              改用新值
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
