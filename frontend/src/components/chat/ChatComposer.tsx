import { useState, type FormEvent, type KeyboardEvent } from 'react'

type ChatComposerProps = {
  sending: boolean
  disabled: boolean
  onSend: (content: string) => Promise<boolean | void>
}

export function ChatComposer({ sending, disabled, onSend }: ChatComposerProps) {
  const [draft, setDraft] = useState('')

  async function submit() {
    const content = draft.trim()
    if (!content || sending || disabled) return
    const ok = await onSend(content)
    if (ok !== false) setDraft('')
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <form className="employee-composer" onSubmit={onSubmit}>
      <textarea
        rows={2}
        placeholder="输入问题"
        value={draft}
        disabled={sending || disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="submit" className="btn btn-primary" disabled={sending || disabled || !draft.trim()}>
        {sending ? '发送中…' : '发送'}
      </button>
    </form>
  )
}
