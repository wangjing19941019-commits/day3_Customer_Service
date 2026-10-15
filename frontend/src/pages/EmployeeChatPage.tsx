import { ChatComposer } from '../components/chat/ChatComposer.tsx'
import { ChatStatusBar } from '../components/chat/ChatStatusBar.tsx'
import '../components/chat/EmployeeChat.css'
import { MessageList } from '../components/chat/MessageList.tsx'
import { useConversation } from '../hooks/useConversation.ts'
import { withMockLabel } from '../utils/mockFlag.ts'

export default function EmployeeChatPage() {
  const { conversation, loading, sending, transferring, error, send, transfer } = useConversation()
  const handedOff = conversation?.status === 'handed_off'
  const messages = conversation?.messages ?? []

  return (
    <section className="employee-chat">
      <ChatStatusBar
        handedOff={Boolean(handedOff)}
        transferring={transferring}
        onTransfer={() => void transfer()}
      />
      {loading && !conversation ? (
        <p className="employee-empty" role="status">
          {withMockLabel('正在加载会话…')}
        </p>
      ) : messages.length === 0 ? (
        <div className="employee-messages">
          <p className="employee-empty">{withMockLabel('描述你的购物问题')}</p>
        </div>
      ) : (
        <MessageList messages={messages} />
      )}
      {error ? <p className="error-text employee-composer-error">{withMockLabel(error)}</p> : null}
      <ChatComposer sending={sending} disabled={!conversation} onSend={send} />
    </section>
  )
}
