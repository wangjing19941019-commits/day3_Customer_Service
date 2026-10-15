import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createConversation,
  fetchConversation,
  isConversationNotFound,
  sendEmployeeMessage,
  transferConversation,
  type ConversationPublic,
} from '../services/conversationService.ts'
import { readApiError } from '../utils/readApiError.ts'

const CONVERSATION_ID_KEY = 'conversation_id'

function pollIntervalMs(): number {
  const raw = Number(import.meta.env.VITE_POLL_INTERVAL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 3000
}

function readStoredId(): string | null {
  const value = sessionStorage.getItem(CONVERSATION_ID_KEY)
  return value && value.length > 0 ? value : null
}

function storeId(id: string): void {
  sessionStorage.setItem(CONVERSATION_ID_KEY, id)
}

export function useConversation() {
  const [conversation, setConversation] = useState<ConversationPublic | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [error, setError] = useState('')
  const sendingRef = useRef(false)
  const conversationIdRef = useRef<string | null>(null)

  const loadOrCreate = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const existingId = readStoredId()
      if (existingId) {
        try {
          const current = await fetchConversation(existingId)
          storeId(current.id)
          conversationIdRef.current = current.id
          setConversation(current)
          return
        } catch (error) {
          if (!isConversationNotFound(error)) {
            throw error
          }
        }
      }
      const created = await createConversation()
      storeId(created.id)
      conversationIdRef.current = created.id
      setConversation(created)
    } catch (error) {
      setError(readApiError(error, '无法加载会话'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOrCreate()
  }, [loadOrCreate])

  const conversationId = conversation?.id
  const handedOff = conversation?.status === 'handed_off'

  useEffect(() => {
    if (!conversationId || !handedOff) return
    const timer = window.setInterval(() => {
      if (sendingRef.current) return
      void fetchConversation(conversationId)
        .then((next) => {
          if (!sendingRef.current) setConversation(next)
        })
        .catch(() => {
          /* keep current snapshot; next poll retries */
        })
    }, pollIntervalMs())
    return () => window.clearInterval(timer)
  }, [conversationId, handedOff])

  const send = useCallback(async (raw: string) => {
    const content = raw.trim()
    if (!content || !conversationIdRef.current || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    setError('')
    try {
      const result = await sendEmployeeMessage(conversationIdRef.current, content)
      setConversation(result.conversation)
      return true
    } catch (error) {
      setError(readApiError(error, '发送失败'))
      return false
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [])

  const transfer = useCallback(async () => {
    if (!conversationIdRef.current || transferring) return
    setTransferring(true)
    setError('')
    try {
      const next = await transferConversation(conversationIdRef.current)
      setConversation(next)
    } catch (error) {
      setError(readApiError(error, '转人工失败'))
    } finally {
      setTransferring(false)
    }
  }, [transferring])

  return {
    conversation,
    loading,
    sending,
    transferring,
    error,
    send,
    transfer,
  }
}
