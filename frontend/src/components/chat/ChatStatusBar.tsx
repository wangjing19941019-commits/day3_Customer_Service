import { withMockLabel } from '../../utils/mockFlag.ts'

type ChatStatusBarProps = {
  handedOff: boolean
  transferring: boolean
  onTransfer: () => void
}

export function ChatStatusBar({ handedOff, transferring, onTransfer }: ChatStatusBarProps) {
  const statusText = handedOff ? '已转人工，等待客服' : 'AI 接待中'
  return (
    <div className="employee-status">
      <span className="employee-status-text">{withMockLabel(statusText)}</span>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={handedOff || transferring}
        onClick={onTransfer}
      >
        {handedOff ? '已转人工' : transferring ? '转人工中…' : '转人工'}
      </button>
    </div>
  )
}
