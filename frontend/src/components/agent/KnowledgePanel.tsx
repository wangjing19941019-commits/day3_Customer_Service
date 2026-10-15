import { useEffect, useRef, useState, type FormEvent } from 'react'
import { TICKET_EMPTY_KNOWLEDGE, TICKET_NO_LINE_HINT } from '../../mocks/tickets.ts'
import type { KnowledgeSuggestionPublic } from '../../types/ticket.ts'
import { withMockLabel } from '../../utils/mockFlag.ts'

type KnowledgePanelProps = {
  knowledge: KnowledgeSuggestionPublic | null
  error: string
  onSearch: (query: string) => Promise<void>
}

function formatRange(from: string, to: string): string {
  const start = new Date(from)
  const end = new Date(to)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${from} ~ ${to}`
  const fmt = (date: Date) =>
    date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
  return `${fmt(start)} ~ ${fmt(end)}`
}

export function KnowledgePanel({ knowledge, error, onSearch }: KnowledgePanelProps) {
  const [query, setQuery] = useState('')
  const conversationId = knowledge?.conversation_id
  const seenConversationRef = useRef<string | undefined>(undefined)
  const unlocked = knowledge != null && !knowledge.business_line
  const suggestions = knowledge?.suggestions ?? []
  const emptyText = knowledge?.empty_message || TICKET_EMPTY_KNOWLEDGE

  useEffect(() => {
    if (!conversationId) return
    if (seenConversationRef.current && seenConversationRef.current !== conversationId) {
      setQuery('')
    }
    seenConversationRef.current = conversationId
  }, [conversationId])

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onSearch(query.trim())
  }

  return (
    <div className="work-block">
      <h2>{withMockLabel('知识推送')}</h2>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {unlocked ? <p className="hint">{withMockLabel(TICKET_NO_LINE_HINT)}</p> : null}
      <form className="knowledge-search" onSubmit={onSubmit}>
        <label htmlFor="agent-knowledge-search">搜索</label>
        <div className="knowledge-search-row">
          <input
            id="agent-knowledge-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如：退货流程"
          />
          <button className="btn btn-secondary" type="submit">
            搜索
          </button>
        </div>
      </form>
      {!knowledge && !error ? null : suggestions.length === 0 ? (
        <p className="hint">{withMockLabel(emptyText)}</p>
      ) : (
        suggestions.map((item) => (
          <article
            className="knowledge-card"
            key={`${item.document_id}-${item.heading_path}`}
            data-filename={item.filename}
            data-visibility={item.visibility}
          >
            <div className="tag">{item.source}</div>
            <div className="knowledge-main">{item.main_answer}</div>
            <p className="hint">{item.summary}</p>
            <p className="hint">生效：{formatRange(item.effective_from, item.effective_to)}</p>
            <p className="hint">适用品类：{item.applicable_category}</p>
          </article>
        ))
      )}
      <p className="hint">{withMockLabel('仅坐席可见，不会发给用户。')}</p>
    </div>
  )
}
