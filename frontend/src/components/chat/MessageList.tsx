import { useEffect, useRef } from 'react'
import type { MessagePublic } from '../../services/conversationService.ts'
import { withMockLabel } from '../../utils/mockFlag.ts'
import { MessageBubble } from './MessageBubble.tsx'

function visibleMessages(messages: MessagePublic[]): MessagePublic[] {
  return messages.filter((message) => message.kind !== 'waiting_for_agent')
}

export function MessageList({ messages }: { messages: MessagePublic[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const visible = visibleMessages(messages)
  const lastVisibleId = visible[visible.length - 1]?.id

  useEffect(() => {
    const node = scrollerRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [visible.length, lastVisibleId])

  return (
    <div className="employee-messages" ref={scrollerRef}>
      {visible.length === 0 ? (
        <p className="employee-empty">{withMockLabel('描述你的 IT 问题')}</p>
      ) : (
        visible.map((message) => <MessageBubble key={message.id} message={message} />)
      )}
    </div>
  )
}
