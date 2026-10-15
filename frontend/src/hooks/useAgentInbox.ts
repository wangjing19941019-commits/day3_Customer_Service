import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchConversation,
  fetchHandedOffConversations,
  getAgentInboxPollIntervalMs,
  sendAgentReply,
  type ConversationListItem,
  type ConversationPublic,
} from '../services/agentInboxService.ts'
import { previewPolish, submitResultFeedback } from '../services/polishService.ts'
import type { AgentPolishPublic } from '../types/ticket.ts'
import { readApiError } from '../utils/readApiError.ts'
import { withMockLabel } from '../utils/mockFlag.ts'

function readInboxError(error: unknown, fallback: string): string {
  return readApiError(error, error instanceof Error ? error.message : fallback)
}

export function useAgentInbox() {
  const pollMs = getAgentInboxPollIntervalMs()
  const [items, setItems] = useState<ConversationListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [conversation, setConversation] = useState<ConversationPublic | null>(null)
  const [draft, setDraft] = useState('')
  const [listError, setListError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [sendError, setSendError] = useState('')
  const [sending, setSending] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [polishResult, setPolishResult] = useState<AgentPolishPublic | null>(null)
  const [feedbackDone, setFeedbackDone] = useState(false)
  const [feedbackError, setFeedbackError] = useState('')
  const [feedbackSending, setFeedbackSending] = useState(false)
  const sendingRef = useRef(false)
  const polishingRef = useRef(false)
  const selectedIdRef = useRef<string | null>(null)
  const originalDraftRef = useRef('')

  selectedIdRef.current = selectedId

  const refreshList = useCallback(async () => {
    try {
      const result = await fetchHandedOffConversations(1, 20)
      setItems(result.items)
      setListError('')
      setSelectedId((current) => {
        if (result.items.length === 0) return null
        if (current && result.items.some((item) => item.id === current)) return current
        return result.items[0].id
      })
    } catch (error) {
      setListError(withMockLabel(readInboxError(error, '无法加载已转人工会话')))
    }
  }, [])

  const refreshDetail = useCallback(async (conversationId: string) => {
    if (sendingRef.current) return
    try {
      const detail = await fetchConversation(conversationId)
      if (selectedIdRef.current !== conversationId) return
      setConversation(detail)
      setDetailError('')
    } catch (error) {
      if (selectedIdRef.current !== conversationId) return
      setConversation(null)
      setDetailError(withMockLabel(readInboxError(error, '无法打开会话')))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function tick() {
      if (cancelled) return
      await refreshList()
    }
    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, pollMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [pollMs, refreshList])

  useEffect(() => {
    if (!selectedId) {
      setConversation(null)
      setDetailError('')
      setPolishResult(null)
      setFeedbackDone(false)
      setFeedbackError('')
      originalDraftRef.current = ''
      return
    }
    let cancelled = false
    async function tick() {
      if (cancelled || !selectedId) return
      await refreshDetail(selectedId)
    }
    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, pollMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [pollMs, refreshDetail, selectedId])

  function selectConversation(id: string) {
    setSelectedId(id)
    setPolishResult(null)
    setFeedbackDone(false)
    setFeedbackError('')
    originalDraftRef.current = ''
  }

  async function sendReply() {
    if (!selectedId || sending || polishing) return
    const content = draft.trim()
    if (!content) {
      setSendError(withMockLabel('请输入回复内容'))
      return
    }
    sendingRef.current = true
    setSending(true)
    setSendError('')
    try {
      const result = await sendAgentReply(selectedId, { content })
      setConversation(result.conversation)
      setDraft('')
      setPolishResult(null)
      setFeedbackDone(false)
      originalDraftRef.current = ''
      setItems((current) =>
        current.map((item) =>
          item.id === result.conversation.id
            ? {
                ...item,
                updated_at: result.conversation.updated_at,
                waiting_for_agent: result.conversation.waiting_for_agent,
                preview: item.preview,
              }
            : item,
        ),
      )
    } catch (error) {
      setSendError(withMockLabel(readInboxError(error, '无法发送回复')))
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  async function polishDraft() {
    if (!selectedId || sending || polishing) return
    const content = draft.trim()
    if (!content) {
      setSendError(withMockLabel('请输入回复内容'))
      return
    }
    polishingRef.current = true
    setPolishing(true)
    setSendError('')
    try {
      originalDraftRef.current = content
      const result = await previewPolish(selectedId, { content })
      setPolishResult(result)
      setFeedbackDone(false)
      setFeedbackError('')
    } catch (error) {
      setSendError(withMockLabel(readInboxError(error, '无法润色')))
    } finally {
      polishingRef.current = false
      setPolishing(false)
    }
  }

  function adoptPolish() {
    if (!polishResult?.can_adopt) return
    setDraft(polishResult.polished_content.replace(/^\[Mock\]\s*/, ''))
  }

  function editPolish() {
    if (!polishResult?.can_adopt) return
    setDraft(polishResult.polished_content.replace(/^\[Mock\]\s*/, ''))
  }

  function discardPolish() {
    setDraft(originalDraftRef.current)
    setPolishResult(null)
    setFeedbackDone(false)
    setFeedbackError('')
  }

  async function sendPolishFeedback(rating: 'useful' | 'useless', comment: string) {
    if (!selectedId || feedbackSending) return
    setFeedbackSending(true)
    setFeedbackError('')
    try {
      await submitResultFeedback(selectedId, { rating, comment, target: 'polish' })
      setFeedbackDone(true)
    } catch (error) {
      setFeedbackError(withMockLabel(readInboxError(error, '无法提交反馈')))
    } finally {
      setFeedbackSending(false)
    }
  }

  const lastMessageId = conversation?.messages[conversation.messages.length - 1]?.id ?? null

  return {
    items,
    selectedId,
    conversation,
    lastMessageId,
    draft,
    setDraft,
    listError,
    detailError,
    sendError,
    sending,
    polishing,
    polishResult,
    feedbackDone,
    feedbackError,
    feedbackSending,
    canReply: Boolean(selectedId) && !sending && !polishing,
    selectConversation,
    sendReply,
    polishDraft,
    adoptPolish,
    editPolish,
    discardPolish,
    sendPolishFeedback,
  }
}
