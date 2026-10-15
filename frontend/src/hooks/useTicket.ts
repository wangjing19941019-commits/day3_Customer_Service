import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchKnowledgeSuggestions } from '../services/agentKnowledgeService.ts'
import { getAgentInboxPollIntervalMs } from '../services/agentInboxService.ts'
import { confirmTicket, fetchTicket, updateTicket, uploadTicketAttachment } from '../services/ticketService.ts'
import type { KnowledgeSuggestionPublic, TicketField, TicketPublic, TicketUpdate } from '../types/ticket.ts'
import { readApiError } from '../utils/readApiError.ts'
import { withMockLabel } from '../utils/mockFlag.ts'

function readTicketError(error: unknown, fallback: string): string {
  return readApiError(error, error instanceof Error ? error.message : fallback)
}

type UseTicketOptions = {
  enabled: boolean
  lastMessageId: string | null
}

function editedField(value: string | null): TicketField {
  if (value == null || value === '') {
    return { value: null, status: 'missing', candidates: [], conflict_value: null }
  }
  return { value, status: 'agent_edited', candidates: [], conflict_value: null }
}

export function useTicket(conversationId: string | null, options: UseTicketOptions) {
  const pollMs = getAgentInboxPollIntervalMs()
  const [ticket, setTicket] = useState<TicketPublic | null>(null)
  const [knowledge, setKnowledge] = useState<KnowledgeSuggestionPublic | null>(null)
  const [error, setError] = useState('')
  const [knowledgeError, setKnowledgeError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const dirtyRef = useRef<Record<string, TicketField>>({})
  const requestRef = useRef(0)
  const knowledgeRequestRef = useRef(0)
  const knowledgeQueryRef = useRef('')
  const conversationRef = useRef(conversationId)

  conversationRef.current = conversationId

  const applyTicket = useCallback((next: TicketPublic) => {
    const dirty = dirtyRef.current
    const fields = { ...next.fields }
    for (const [key, field] of Object.entries(dirty)) {
      fields[key] = field
    }
    setTicket({ ...next, fields })
  }, [])

  const refreshTicket = useCallback(async (id: string) => {
    const seq = ++requestRef.current
    try {
      const next = await fetchTicket(id)
      if (conversationRef.current !== id || seq !== requestRef.current) return
      setUnavailable(false)
      applyTicket(next)
      setError('')
    } catch (caught) {
      if (conversationRef.current !== id || seq !== requestRef.current) return
      const message = readTicketError(caught, '无法读取工单')
      if (message.includes('尚未转人工')) {
        setUnavailable(true)
        setTicket(null)
        setKnowledge(null)
        setError('')
        return
      }
      setError(withMockLabel(message))
    }
  }, [applyTicket])

  const refreshKnowledge = useCallback(async (id: string, q?: string) => {
    if (q !== undefined) {
      knowledgeQueryRef.current = q.trim()
    }
    const query = knowledgeQueryRef.current
    const seq = ++knowledgeRequestRef.current
    try {
      const next = await fetchKnowledgeSuggestions(id, query || undefined)
      if (conversationRef.current !== id || seq !== knowledgeRequestRef.current) return
      setKnowledge(next)
      setKnowledgeError('')
    } catch (caught) {
      if (conversationRef.current !== id || seq !== knowledgeRequestRef.current) return
      setKnowledge(null)
      setKnowledgeError(withMockLabel(readTicketError(caught, '无法加载知识推送')))
    }
  }, [])

  useEffect(() => {
    dirtyRef.current = {}
    knowledgeQueryRef.current = ''
    knowledgeRequestRef.current += 1
    setTicket(null)
    setKnowledge(null)
    setError('')
    setKnowledgeError('')
    setUnavailable(false)
  }, [conversationId, options.enabled])

  useEffect(() => {
    if (!conversationId || !options.enabled) return
    void refreshTicket(conversationId)
  }, [conversationId, options.enabled, options.lastMessageId, refreshTicket])

  useEffect(() => {
    if (!conversationId || !options.enabled || unavailable) return
    void refreshKnowledge(conversationId)
  }, [
    conversationId,
    options.enabled,
    options.lastMessageId,
    ticket?.ticket_type,
    ticket?.business_line,
    unavailable,
    refreshKnowledge,
  ])

  useEffect(() => {
    if (!conversationId || !options.enabled || ticket?.extract_status !== 'extracting') return
    const timer = window.setInterval(() => {
      void refreshTicket(conversationId)
    }, pollMs)
    return () => window.clearInterval(timer)
  }, [conversationId, options.enabled, pollMs, refreshTicket, ticket?.extract_status])

  async function patchTicket(payload: TicketUpdate) {
    if (!conversationId || unavailable) return
    try {
      const next = await updateTicket(conversationId, payload)
      if (payload.fields) {
        for (const key of Object.keys(payload.fields)) {
          delete dirtyRef.current[key]
        }
      }
      applyTicket(next)
      setError('')
    } catch (caught) {
      setError(withMockLabel(readTicketError(caught, '无法保存工单')))
    }
  }

  function updateLocalField(key: string, value: string) {
    const field = editedField(value === '' ? null : value)
    dirtyRef.current[key] = field
    setTicket((current) => {
      if (!current) return current
      return { ...current, fields: { ...current.fields, [key]: field } }
    })
  }

  async function submitField(key: string, value: string) {
    if (!dirtyRef.current[key]) return
    await patchTicket({ fields: { [key]: value === '' ? null : value } })
  }

  async function chooseCandidate(key: string, value: string) {
    dirtyRef.current[key] = editedField(value)
    await patchTicket({ fields: { [key]: value } })
  }

  async function resolveConflict(key: string, value: string) {
    dirtyRef.current[key] = editedField(value)
    await patchTicket({ fields: { [key]: value } })
  }

  async function confirm() {
    if (!conversationId || confirming) return
    setConfirming(true)
    try {
      const next = await confirmTicket(conversationId)
      dirtyRef.current = {}
      setTicket(next)
      setError('')
    } catch (caught) {
      setError(withMockLabel(readTicketError(caught, '无法确认工单')))
    } finally {
      setConfirming(false)
    }
  }

  async function uploadEvidence(file: File) {
    if (!conversationId || uploading) return
    setUploading(true)
    try {
      const next = await uploadTicketAttachment(conversationId, file)
      applyTicket(next)
      setError('')
    } catch (caught) {
      setError(withMockLabel(readTicketError(caught, '请重新上传')))
    } finally {
      setUploading(false)
    }
  }

  async function searchKnowledge(query: string) {
    if (!conversationId || unavailable) return
    await refreshKnowledge(conversationId, query)
  }

  return {
    ticket,
    knowledge,
    error,
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
  }
}
