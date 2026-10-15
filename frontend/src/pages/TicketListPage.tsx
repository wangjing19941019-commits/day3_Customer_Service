import type { FormEvent } from 'react'
import { useTicketList } from '../hooks/useTicketList.ts'
import {
  EMPTY_TICKETS_TEXT,
  HOLD_REASON_LABEL,
  TICKET_STATUS_OPTIONS,
  TICKET_TYPE_OPTIONS,
  TICKET_URGENCY_OPTIONS,
} from '../mocks/ticketList.ts'
import { useAuth } from '../stores/useAuth.ts'
import type { TicketType, TicketUrgency } from '../types/ticketList.ts'
import { withMockLabel } from '../utils/mockFlag.ts'

function optionLabel(options: readonly { value: string; label: string }[], value: string): string {
  return options.find((item) => item.value === value)?.label ?? value
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export default function TicketListPage() {
  const { user } = useAuth()
  const {
    filters,
    setFilters,
    items,
    selectedId,
    detail,
    listError,
    actionError,
    loading,
    acting,
    applyFilters,
    commitFilters,
    resetFilters,
    selectTicket,
    claimSelected,
    patchSelected,
    approveSelected,
  } = useTicketList()

  const role = user?.role
  const canClaim =
    Boolean(detail && detail.status === 'pending' && !detail.assigned_user_id) &&
    (role === 'admin' ||
      (role === 'after_sales_specialist' && detail?.queue !== 'high_risk') ||
      (role === 'senior_after_sales' && detail?.queue === 'high_risk'))
  const canHold = detail?.status === 'in_progress'
  const canComplete = detail?.status === 'in_progress' || detail?.status === 'on_hold'
  const canClose = detail?.status === 'completed'
  const canRaiseVip = Boolean(detail && detail.urgency === 'normal')
  const canRaiseHighRisk = Boolean(detail && detail.urgency !== 'high_risk')
  const canApprove = role === 'supervisor' && detail?.urgency === 'high_risk'

  function onFilter(event: FormEvent) {
    event.preventDefault()
    void applyFilters()
  }

  return (
    <div className="tickets-page">
      <style>{TICKET_LIST_STYLES}</style>
      <header className="tickets-head">
        <h1>{withMockLabel('工单列表')}</h1>
        <p className="hint">按类型、状态、紧急程度筛选，按订单号、用户、工单号和时间检索。点一行查看只读进度。</p>
      </header>

      <form className="tickets-filters" onSubmit={onFilter}>
        <label>
          类型
          <select
            value={filters.ticket_type}
            onChange={(event) =>
              setFilters((current) => ({ ...current, ticket_type: event.target.value as TicketType | '' }))
            }
          >
            <option value="">全部</option>
            {TICKET_TYPE_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="tickets-status">
          <legend>状态</legend>
          <button
            type="button"
            className={!filters.status ? 'selected' : undefined}
            aria-pressed={!filters.status}
            onClick={() => void commitFilters({ ...filters, status: '' })}
          >
            全部
          </button>
          {TICKET_STATUS_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={filters.status === item.value ? 'selected' : undefined}
              aria-pressed={filters.status === item.value}
              onClick={() => void commitFilters({ ...filters, status: item.value })}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
        <label>
          紧急程度
          <select
            value={filters.urgency}
            onChange={(event) =>
              setFilters((current) => ({ ...current, urgency: event.target.value as TicketUrgency | '' }))
            }
          >
            <option value="">全部</option>
            {TICKET_URGENCY_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          订单号
          <input
            value={filters.order_no}
            onChange={(event) => setFilters((current) => ({ ...current, order_no: event.target.value }))}
          />
        </label>
        <label>
          用户
          <input
            value={filters.user_query}
            onChange={(event) => setFilters((current) => ({ ...current, user_query: event.target.value }))}
          />
        </label>
        <label>
          工单号
          <input
            value={filters.ticket_no}
            onChange={(event) => setFilters((current) => ({ ...current, ticket_no: event.target.value }))}
          />
        </label>
        <label>
          开始时间
          <input
            type="datetime-local"
            value={filters.time_from}
            onChange={(event) => setFilters((current) => ({ ...current, time_from: event.target.value }))}
          />
        </label>
        <label>
          结束时间
          <input
            type="datetime-local"
            value={filters.time_to}
            onChange={(event) => setFilters((current) => ({ ...current, time_to: event.target.value }))}
          />
        </label>
        <div className="tickets-filter-actions">
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? '筛选中…' : '筛选'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => void resetFilters()} disabled={loading}>
            重置
          </button>
        </div>
      </form>

      {listError ? <p className="error-text">{listError}</p> : null}

      <div className="tickets-table-wrap">
        {items.length === 0 && !loading ? (
          <p className="tickets-empty">{EMPTY_TICKETS_TEXT}</p>
        ) : (
          <table className="tickets-table">
            <thead>
              <tr>
                <th colSpan={6}>
                  <div className="tickets-row tickets-head-row">
                    <span>工单号</span>
                    <span>类型</span>
                    <span>紧急程度</span>
                    <span>状态</span>
                    <span>处理人</span>
                    <span>更新时间</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const selected = item.id === selectedId
                const vip = item.urgency === 'vip'
                const highRisk = item.urgency === 'high_risk'
                return (
                  <tr key={item.id}>
                    <td colSpan={6} className="tickets-row-cell">
                      <button
                        type="button"
                        className={[
                          'tickets-row',
                          vip ? 'vip' : '',
                          highRisk ? 'high-risk' : '',
                          selected ? 'selected' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-pressed={selected}
                        onClick={() => selectTicket(item.id)}
                      >
                        <span>{item.ticket_no}</span>
                        <span>{optionLabel(TICKET_TYPE_OPTIONS, item.ticket_type)}</span>
                        <span className={highRisk ? 'danger-text' : undefined}>
                          {optionLabel(TICKET_URGENCY_OPTIONS, item.urgency)}
                        </span>
                        <span>{optionLabel(TICKET_STATUS_OPTIONS, item.status)}</span>
                        <span>
                          {item.assigned_display}
                          {item.upgrade_undelivered ? '（升级未送达）' : ''}
                        </span>
                        <span>{item.updated_at ? formatTime(item.updated_at) : ''}</span>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {detail ? (
        <section className="tickets-detail" aria-label="工单进度">
          <h2>只读进度</h2>
          <p>
            {detail.ticket_no} · {optionLabel(TICKET_TYPE_OPTIONS, detail.ticket_type)} ·{' '}
            <span className={detail.urgency === 'high_risk' ? 'danger-text' : undefined}>
              {optionLabel(TICKET_URGENCY_OPTIONS, detail.urgency)}
            </span>
            {' · '}
            {optionLabel(TICKET_STATUS_OPTIONS, detail.status)}
            {detail.hold_reason ? `（${HOLD_REASON_LABEL[detail.hold_reason]}）` : ''}
          </p>
          <p className="hint">
            处理人 {detail.assigned_display}
            {detail.upgrade_undelivered ? '（升级未送达）' : ''}
            {detail.order_no ? ` · 订单 ${detail.order_no}` : ''}
            {detail.user_name ? ` · 用户 ${detail.user_name}` : ''}
          </p>
          {detail.progress.length === 0 ? (
            <p className="hint">目前没有可查询的工单进度。</p>
          ) : (
            <ol className="tickets-progress">
              {detail.progress.map((item, index) => (
                <li key={item.id ?? `${item.at ?? item.created_at ?? 'progress'}-${index}`}>
                  <time>{formatTime(item.created_at || item.at || '')}</time>
                  <span>{item.summary || item.detail}</span>
                </li>
              ))}
            </ol>
          )}
          {actionError ? <p className="error-text">{actionError}</p> : null}
          <div className="tickets-actions">
            {canClaim ? (
              <button className="btn btn-primary" type="button" disabled={acting} onClick={() => void claimSelected()}>
                认领
              </button>
            ) : null}
            {canHold ? (
              <>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={acting}
                  onClick={() => void patchSelected({ status: 'on_hold', hold_reason: 'wait_user' })}
                >
                  挂起（等用户补充）
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={acting}
                  onClick={() => void patchSelected({ status: 'on_hold', hold_reason: 'wait_warehouse' })}
                >
                  挂起（等仓储确认）
                </button>
              </>
            ) : null}
            {canComplete ? (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={acting}
                onClick={() => void patchSelected({ status: 'completed' })}
              >
                标记已完成
              </button>
            ) : null}
            {canClose ? (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={acting}
                onClick={() => void patchSelected({ status: 'closed' })}
              >
                用户已解决
              </button>
            ) : null}
            {canRaiseVip ? (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={acting}
                onClick={() => void patchSelected({ urgency: 'vip' })}
              >
                上调为 VIP
              </button>
            ) : null}
            {canRaiseHighRisk ? (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={acting}
                onClick={() => void patchSelected({ urgency: 'high_risk' })}
              >
                上调为高风险
              </button>
            ) : null}
            {canApprove ? (
              <>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={acting}
                  onClick={() => void approveSelected({ approved: true, target_urgency: 'normal' })}
                >
                  同意降为普通
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={acting}
                  onClick={() => void approveSelected({ approved: false, target_urgency: 'normal' })}
                >
                  驳回降级
                </button>
              </>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}

const TICKET_LIST_STYLES = `
.tickets-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  padding: 24px;
  gap: 16px;
}
.tickets-head h1 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
}
.tickets-head .hint,
.tickets-detail .hint,
.tickets-empty {
  margin: 0;
  color: #5c6b7a;
  font-size: 12px;
  line-height: 18px;
}
.tickets-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  padding: 12px;
  background: #ffffff;
  border: 1px solid #d9e2ec;
  border-radius: 8px;
}
.tickets-filters label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  line-height: 18px;
  color: #5c6b7a;
}
.tickets-filters input,
.tickets-filters select {
  height: 40px;
  min-width: 160px;
  border: 1px solid #d9e2ec;
  border-radius: 6px;
  padding: 0 12px;
  background: #ffffff;
  color: #1f2933;
}
.tickets-filters input:hover:not(:disabled),
.tickets-filters select:hover:not(:disabled) {
  border-color: #1d4e89;
}
.tickets-filters input:active:not(:disabled),
.tickets-filters select:active:not(:disabled) {
  border-color: #163a66;
}
.tickets-filters input:focus-visible,
.tickets-filters select:focus-visible {
  outline: 2px solid #1d4e89;
  outline-offset: 2px;
}
.tickets-filters input:disabled,
.tickets-filters select:disabled {
  background: #e4e7eb;
  color: #5c6b7a;
  cursor: not-allowed;
}
.tickets-status {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.tickets-status legend {
  font-size: 12px;
  line-height: 18px;
  color: #5c6b7a;
  padding: 0;
  margin: 0 8px 0 0;
}
.tickets-status button {
  height: 32px;
  padding: 0 10px;
  border: 1px solid #d9e2ec;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2933;
  font-size: 12px;
  line-height: 18px;
  font-weight: 400;
}
.tickets-status button:hover:not(:disabled) {
  border-color: #1d4e89;
}
.tickets-status button:active:not(:disabled) {
  background: #e8f1fa;
  border-color: #163a66;
}
.tickets-status button:focus-visible {
  outline: 2px solid #1d4e89;
  outline-offset: 2px;
}
.tickets-status button:disabled {
  background: #e4e7eb;
  color: #5c6b7a;
  cursor: not-allowed;
}
.tickets-status button.selected {
  background: #e8f1fa;
  color: #1d4e89;
  border-color: #1d4e89;
}
.tickets-filter-actions {
  display: flex;
  gap: 8px;
}
.tickets-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: #ffffff;
  border: 1px solid #d9e2ec;
  border-radius: 8px;
}
.tickets-empty {
  padding: 48px 24px;
  text-align: center;
  font-size: 14px;
  line-height: 22px;
}
.tickets-table {
  width: 100%;
  border-collapse: collapse;
}
.tickets-table th {
  padding: 0;
  border-bottom: 1px solid #d9e2ec;
  background: #ffffff;
  position: sticky;
  top: 0;
  z-index: 1;
}
.tickets-head-row {
  min-height: 44px;
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  color: #5c6b7a;
  cursor: default;
}
.tickets-head-row:hover:not(:disabled),
.tickets-head-row:active:not(:disabled) {
  background: #ffffff;
}
.tickets-row-cell {
  padding: 0;
  border-bottom: 1px solid #d9e2ec;
}
.tickets-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr 0.8fr 0.8fr 1.2fr 1.2fr;
  width: 100%;
  min-height: 56px;
  padding: 12px 16px;
  border: 0;
  background: #ffffff;
  color: #1f2933;
  text-align: left;
  font-weight: 400;
  border-radius: 0;
}
.tickets-row:hover:not(:disabled) {
  background: #f4f6f8;
}
.tickets-row:active:not(:disabled) {
  background: #e4e7eb;
}
.tickets-row:focus-visible {
  outline: 2px solid #1d4e89;
  outline-offset: -2px;
}
.tickets-row:disabled {
  background: #e4e7eb;
  color: #5c6b7a;
  cursor: not-allowed;
}
.tickets-row.vip,
.tickets-row.vip:hover:not(:disabled) {
  background: rgba(180, 83, 9, 0.12);
}
.tickets-row.vip:active:not(:disabled) {
  background: rgba(180, 83, 9, 0.2);
}
.tickets-row.selected {
  background: #e8f1fa;
}
.tickets-row.vip.selected {
  background: rgba(180, 83, 9, 0.18);
  box-shadow: inset 3px 0 0 #1d4e89;
}
.danger-text {
  color: #b42318;
}
.tickets-detail {
  flex-shrink: 0;
  max-height: 36%;
  overflow: auto;
  padding: 16px;
  background: #ffffff;
  border: 1px solid #d9e2ec;
  border-radius: 8px;
}
.tickets-detail h2 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}
.tickets-detail p {
  margin: 0 0 8px;
}
.tickets-progress {
  margin: 0 0 12px;
  padding-left: 20px;
}
.tickets-progress li {
  margin-bottom: 8px;
}
.tickets-progress time {
  display: block;
  font-size: 12px;
  line-height: 18px;
  color: #5c6b7a;
}
.tickets-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
@media (max-width: 1023px) {
  .tickets-head h1 {
    font-size: 18px;
    line-height: 26px;
  }
  .tickets-row {
    grid-template-columns: 1fr 1fr;
    gap: 4px 12px;
  }
  .tickets-detail {
    max-height: none;
  }
}
`
