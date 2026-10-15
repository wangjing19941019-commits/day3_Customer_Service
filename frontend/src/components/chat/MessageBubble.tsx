import type { MessageKind, MessagePublic } from '../../types/conversation.ts'
import { withMockLabel } from '../../utils/mockFlag.ts'

const KIND_LABEL: Partial<Record<MessageKind, string>> = {
  clarification: '反问',
  faq: 'FAQ',
  small_talk: '闲聊',
  knowledge: '知识问答',
  fallback: '兜底',
  agent: '客服',
  ticket_progress: '进度说明',
}

export function MessageBubble({ message }: { message: MessagePublic }) {
  const isEmployee = message.role === 'employee'
  const tag = !isEmployee ? KIND_LABEL[message.kind] : undefined
  const rewrite =
    isEmployee && message.rewritten_content
      ? withMockLabel(`改写为：${message.rewritten_content}`)
      : null

  return (
    <article className={isEmployee ? 'chat-msg employee' : 'chat-msg other'}>
      {tag ? <div className="chat-msg-tag">{tag}</div> : null}
      <div className="chat-bubble">{withMockLabel(message.content)}</div>
      {rewrite ? <div className="chat-rewrite">{rewrite}</div> : null}
    </article>
  )
}
