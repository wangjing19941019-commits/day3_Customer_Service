import { useEffect, useRef, type FormEvent } from 'react'
import { KnowledgePanel } from '../components/agent/KnowledgePanel.tsx'
import { PolishCompare } from '../components/agent/PolishCompare.tsx'
import { TicketWorkbench } from '../components/agent/TicketWorkbench.tsx'
import '../components/agent/agentWorkbench.css'
import { useAgentInbox } from '../hooks/useAgentInbox.ts'
import { useTicket } from '../hooks/useTicket.ts'
import type { MessageKind, MessagePublic } from '../services/agentInboxService.ts'

const KIND_LABEL: Record<MessageKind, string | null> = {
  employee_turn: null,
  clarification: '反问',
  faq: 'FAQ',
  small_talk: '闲聊',
  knowledge: '知识',
  fallback: '兜底',
  waiting_for_agent: '等待客服',
  agent: '客服',
}

function formatLocalTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', { hour12: false })
}

function messageClassName(message: MessagePublic): string {
  return message.role === 'employee' ? 'agent-msg agent-msg-user' : 'agent-msg agent-msg-peer'
}

export default function AgentInboxPage() {
  const {
    items,
    selectedId,
    conversation,
    draft,
    setDraft,
    listError,
    detailError,
    lastMessageId,
    sendError,
    sending,
    polishing,
    canReply,
    polishResult,
    feedbackDone,
    feedbackError,
    feedbackSending,
    selectConversation,
    sendReply,
    polishDraft,
    adoptPolish,
    editPolish,
    discardPolish,
    sendPolishFeedback,
  } = useAgentInbox()
  const {
    ticket,
    knowledge,
    error: ticketError,
    knowledgeError,
    confirming,
    uploading,
    unavailable,
    updateLocalField,
    submitField,
    chooseCandidate,
    resolveConflict,
    patchTicket,
    confirm,
    uploadEvidence,
    searchKnowledge,
  } = useTicket(selectedId, {
    enabled: Boolean(selectedId),
    lastMessageId,
  })
  const messagesRef = useRef<HTMLDivElement>(null)
  const empty = items.length === 0
  const showWorkbench = Boolean(selectedId) && !unavailable

  useEffect(() => {
    const box = messagesRef.current
    if (!box) return
    box.scrollTop = box.scrollHeight
  }, [conversation?.id, conversation?.messages.length, conversation?.updated_at])

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sendReply()
  }

  return (
    <div className="agent-inbox">
      <style>{AGENT_INBOX_CSS}</style>
      <aside className="agent-list" aria-label="已转人工会话">
        {listError ? (
          <p className="agent-error" role="alert">
            {listError}
          </p>
        ) : null}
        {empty ? (
          <p className="agent-empty" role="status">
            还没有需要人工处理的对话
          </p>
        ) : (
          items.map((item) => {
            const selected = item.id === selectedId
            return (
              <button
                key={item.id}
                type="button"
                className={selected ? 'agent-row selected' : 'agent-row'}
                aria-current={selected ? 'true' : undefined}
                onClick={() => selectConversation(item.id)}
              >
                <span className="agent-row-title">{item.preview}</span>
                <span className="agent-row-meta">
                  {formatLocalTime(item.updated_at)} · 已转人工
                </span>
              </button>
            )
          })
        )}
      </aside>
      <section className="agent-thread">
        <div className="agent-messages" ref={messagesRef}>
          {detailError ? (
            <p className="agent-error" role="alert">
              {detailError}
            </p>
          ) : null}
          {empty || !conversation ? (
            <p className="agent-empty" role="status">
              {empty ? '还没有需要人工处理的对话' : '从左侧选择已转人工的会话'}
            </p>
          ) : (
            conversation.messages.map((message) => {
              const tag = KIND_LABEL[message.kind]
              return (
                <article key={message.id} className={messageClassName(message)}>
                  {tag ? <div className="agent-tag">{tag}</div> : null}
                  <div className="agent-bubble">{message.content}</div>
                  {message.role === 'employee' && message.rewritten_content ? (
                    <div className="agent-rewrite">改写为：{message.rewritten_content}</div>
                  ) : null}
                </article>
              )
            })
          )}
        </div>
        <PolishCompare
          result={polishResult}
          feedbackDone={feedbackDone}
          feedbackError={feedbackError}
          feedbackSending={feedbackSending}
          onAdopt={adoptPolish}
          onEdit={editPolish}
          onDiscard={discardPolish}
          onFeedback={sendPolishFeedback}
        />
        <form className="agent-composer" onSubmit={onSubmit}>
          <textarea
            id="agent-reply"
            rows={2}
            placeholder="回复员工"
            value={draft}
            disabled={!canReply}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!canReply || !draft.trim()}
            onClick={() => void polishDraft()}
          >
            {polishing ? '润色中…' : '润色'}
          </button>
          <button className="btn btn-primary" type="submit" disabled={!canReply || !draft.trim()}>
            {sending ? '发送中…' : '发送'}
          </button>
        </form>
        {sendError ? (
          <p className="agent-send-error" role="alert">
            {sendError}
          </p>
        ) : null}
      </section>
      <aside className="agent-work" aria-label="坐席工作台">
        {empty || !showWorkbench ? (
          <p className="agent-empty" role="status">
            {empty ? '还没有需要人工处理的对话' : '从左侧选择已转人工的会话'}
          </p>
        ) : (
          <>
            <TicketWorkbench
              ticket={ticket}
              error={ticketError}
              confirming={confirming}
              uploading={uploading}
              onPatch={patchTicket}
              onFieldChange={updateLocalField}
              onFieldSubmit={submitField}
              onChooseCandidate={chooseCandidate}
              onResolveConflict={resolveConflict}
              onUploadEvidence={uploadEvidence}
              onConfirm={confirm}
            />
            <KnowledgePanel knowledge={knowledge} error={knowledgeError} onSearch={searchKnowledge} />
          </>
        )}
      </aside>
    </div>
  )
}

const AGENT_INBOX_CSS = `
.agent-inbox {
  display: flex;
  flex: 1;
  min-height: 0;
  height: 100%;
  background: var(--surface);
}
.agent-list {
  width: 320px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--surface);
  overflow: auto;
  min-height: 0;
  align-self: stretch;
}
.agent-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  width: 100%;
  min-height: 56px;
  padding: 12px 16px;
  border: 0;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: var(--surface);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.agent-row:hover:not(:disabled) {
  background: var(--canvas);
}
.agent-row:active:not(:disabled) {
  background: var(--primary-subtle);
}
.agent-row:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.agent-row:disabled {
  background: var(--disabled);
  color: var(--muted);
  cursor: not-allowed;
}
.agent-row.selected {
  background: var(--primary-subtle);
}
.agent-row-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-row-meta {
  font-size: 12px;
  line-height: 18px;
  color: var(--muted);
}
.agent-thread {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--canvas);
}
.agent-messages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.agent-msg {
  max-width: 640px;
}
.agent-msg-user {
  align-self: flex-end;
}
.agent-msg-peer {
  align-self: flex-start;
}
.agent-bubble {
  border-radius: 12px;
  padding: 10px 12px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 22px;
}
.agent-msg-user .agent-bubble {
  background: var(--primary);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.agent-msg-peer .agent-bubble {
  background: var(--primary-subtle);
  color: var(--text);
  border-bottom-left-radius: 4px;
}
.agent-tag {
  font-size: 12px;
  line-height: 18px;
  color: var(--muted);
  margin-bottom: 4px;
}
.agent-rewrite {
  font-size: 12px;
  line-height: 18px;
  color: var(--muted);
  margin-top: 4px;
}
.agent-composer {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  background: var(--surface);
  padding: 12px 24px 16px;
  display: flex;
  gap: 8px;
  align-items: flex-end;
  min-height: 88px;
}
.agent-composer textarea {
  flex: 1;
  min-height: 48px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 12px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
}
.agent-composer textarea:hover:not(:disabled) {
  border-color: #b8c4d0;
}
.agent-composer textarea:active:not(:disabled) {
  border-color: var(--primary);
}
.agent-composer textarea:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-color: var(--primary);
}
.agent-composer textarea:disabled {
  background: var(--disabled);
  color: var(--muted);
  cursor: not-allowed;
}
.agent-empty {
  color: var(--muted);
  padding: 48px 24px;
  text-align: center;
  margin: 0;
  font-size: 14px;
  line-height: 22px;
}
.agent-error,
.agent-send-error {
  font-size: 12px;
  line-height: 18px;
  color: var(--danger);
  margin: 0;
  padding: 12px 16px;
}
.agent-send-error {
  padding: 0 24px 12px;
  background: var(--surface);
}
.agent-composer .btn-secondary {
  flex-shrink: 0;
}
@media (max-width: 1023px) {
  .agent-inbox {
    flex-direction: column;
    overflow: auto;
  }
  .agent-list {
    width: 100%;
    height: 40vh;
    max-height: 40vh;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .agent-thread {
    min-height: 40vh;
  }
}
`
