import { useCallback, useEffect, useRef, useState } from 'react'
import {
  approveTicketUrgency,
  claimTicket,
  getTicket,
  listTickets,
  patchTicket,
} from '../services/ticketListService.ts'
import type {
  TicketListItem,
  TicketListQuery,
  TicketListStatus,
  TicketPublic,
  TicketStatusPatch,
  TicketType,
  TicketUrgency,
  UrgencyApprovalCreate,
} from '../types/ticketList.ts'
import { withMockLabel } from '../utils/mockFlag.ts'
import { readApiError } from '../utils/readApiError.ts'

export type TicketListFilters = {
  ticket_type: TicketType | ''
  status: TicketListStatus | ''
  urgency: TicketUrgency | ''
  order_no: string
  user_query: string
  ticket_no: string
  time_from: string
  time_to: string
}

export const EMPTY_TICKET_FILTERS: TicketListFilters = {
  ticket_type: '',
  status: '',
  urgency: '',
  order_no: '',
  user_query: '',
  ticket_no: '',
  time_from: '',
  time_to: '',
}

function toQuery(filters: TicketListFilters): TicketListQuery {
  const query: TicketListQuery = { page: 1, page_size: 20 }
  if (filters.ticket_type) query.ticket_type = filters.ticket_type
  if (filters.status) query.status = filters.status
  if (filters.urgency) query.urgency = filters.urgency
  if (filters.order_no.trim()) query.order_no = filters.order_no.trim()
  if (filters.user_query.trim()) query.user_query = filters.user_query.trim()
  if (filters.ticket_no.trim()) query.ticket_no = filters.ticket_no.trim()
  if (filters.time_from) query.time_from = filters.time_from
  if (filters.time_to) query.time_to = filters.time_to
  return query
}

export function useTicketList() {
  const [filters, setFilters] = useState<TicketListFilters>(EMPTY_TICKET_FILTERS)
  const appliedRef = useRef<TicketListFilters>(EMPTY_TICKET_FILTERS)
  const [items, setItems] = useState<TicketListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TicketPublic | null>(null)
  const [listError, setListError] = useState('')
  const [actionError, setActionError] = useState('')
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState(false)
  const requestSeq = useRef(0)

  const refreshList = useCallback(async (nextFilters: TicketListFilters = appliedRef.current) => {
    const seq = ++requestSeq.current
    setLoading(true)
    try {
      const result = await listTickets(toQuery(nextFilters))
      if (seq !== requestSeq.current) return result.items
      setItems(result.items)
      setListError('')
      setSelectedId((current) => {
        if (current && result.items.some((item) => item.id === current)) return current
        return result.items[0]?.id ?? null
      })
      return result.items
    } catch (error) {
      if (seq === requestSeq.current) {
        setItems([])
        setSelectedId(null)
        setDetail(null)
        setListError(withMockLabel(readApiError(error, '无法加载工单列表')))
      }
      return []
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [])

  const loadDetail = useCallback(async (ticketId: string) => {
    try {
      const ticket = await getTicket(ticketId)
      setDetail(ticket)
      setActionError('')
      return ticket
    } catch (error) {
      setDetail(null)
      setActionError(withMockLabel(readApiError(error, '工单不存在')))
      return null
    }
  }, [])

  useEffect(() => {
    void refreshList(EMPTY_TICKET_FILTERS)
  }, [refreshList])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    void loadDetail(selectedId)
  }, [loadDetail, selectedId])

  const commitFilters = useCallback(
    async (next: TicketListFilters) => {
      setFilters(next)
      appliedRef.current = next
      await refreshList(next)
    },
    [refreshList],
  )

  const applyFilters = useCallback(async () => {
    await commitFilters(filters)
  }, [commitFilters, filters])

  const resetFilters = useCallback(async () => {
    await commitFilters(EMPTY_TICKET_FILTERS)
  }, [commitFilters])

  const selectTicket = useCallback((ticketId: string) => {
    setSelectedId(ticketId)
  }, [])

  const runAction = useCallback(
    async (run: () => Promise<TicketPublic>) => {
      setActing(true)
      try {
        const ticket = await run()
        setDetail(ticket)
        setActionError('')
        await refreshList(appliedRef.current)
        setSelectedId(ticket.id)
        return ticket
      } catch (error) {
        setActionError(withMockLabel(readApiError(error, '处理失败')))
        return null
      } finally {
        setActing(false)
      }
    },
    [refreshList],
  )

  const claimSelected = useCallback(async () => {
    if (!selectedId) return null
    return runAction(() => claimTicket(selectedId))
  }, [runAction, selectedId])

  const patchSelected = useCallback(
    async (payload: TicketStatusPatch) => {
      if (!selectedId) return null
      return runAction(() => patchTicket(selectedId, payload))
    },
    [runAction, selectedId],
  )

  const approveSelected = useCallback(
    async (payload: UrgencyApprovalCreate) => {
      if (!selectedId) return null
      return runAction(() => approveTicketUrgency(selectedId, payload))
    },
    [runAction, selectedId],
  )

  return {
    filters,
    setFilters,
    items,
    selectedId,
    detail,
    listError,
    actionError,
    loading,
    acting,
    applyFilters,
    commitFilters,
    resetFilters,
    selectTicket,
    claimSelected,
    patchSelected,
    approveSelected,
  }
}
