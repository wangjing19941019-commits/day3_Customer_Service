import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentListFilter } from '../components/knowledge/IngestStatusFilter.tsx'
import {
  DOCUMENT_POLL_INTERVAL_MS,
  getDocument,
  listDocuments,
  updateDocument,
  uploadDocument,
  type DocumentListItem,
  type DocumentPublic,
  type DocumentUpdate,
} from '../services/documentService.ts'
import type { DocumentListQuery } from '../types/api.ts'
import { withMockLabel } from '../utils/mockFlag.ts'
import { readApiError } from '../utils/readApiError.ts'

function toListQuery(filter: DocumentListFilter): DocumentListQuery {
  const query: DocumentListQuery = { page: 1, page_size: 20 }
  if (filter !== 'all') {
    query.ingest_status = filter
  }
  return query
}

export function useDocuments() {
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [ingestFilter, setIngestFilterState] = useState<DocumentListFilter>('all')
  const ingestFilterRef = useRef<DocumentListFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DocumentPublic | null>(null)
  const detailRef = useRef<DocumentPublic | null>(null)
  const listRequestSeq = useRef(0)
  const [listError, setListError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)

  const refreshList = useCallback(async (filter: DocumentListFilter = ingestFilterRef.current) => {
    const seq = ++listRequestSeq.current
    const result = await listDocuments(toListQuery(filter))
    if (seq !== listRequestSeq.current) {
      return result.items
    }
    setDocuments(result.items)
    setListError('')
    return result.items
  }, [])

  const loadDetail = useCallback(async (documentId: string) => {
    setDetailLoading(true)
    try {
      const doc = await getDocument(documentId)
      setDetail(doc)
      detailRef.current = doc
      setSaveError('')
      return doc
    } catch (error) {
      setDetail(null)
      detailRef.current = null
      setSaveError(withMockLabel(readApiError(error, '文档不存在')))
      return null
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const items = await refreshList('all')
        if (cancelled || ingestFilterRef.current !== 'all') return
        setSelectedId((current) => current ?? items[0]?.id ?? null)
      } catch (error) {
        if (!cancelled) {
          setListError(withMockLabel(readApiError(error, '无法加载文档列表')))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshList])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      detailRef.current = null
      return
    }
    let cancelled = false
    void (async () => {
      const doc = await getDocument(selectedId).catch((error: unknown) => {
        if (!cancelled) {
          setDetail(null)
          detailRef.current = null
          setSaveError(withMockLabel(readApiError(error, '文档不存在')))
        }
        return null
      })
      if (!cancelled && doc) {
        setDetail(doc)
        detailRef.current = doc
        setSaveError('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const shouldPoll =
    ingestFilter === 'ready' || ingestFilter === 'failed'
      ? false
      : ingestFilter === 'ingesting'
        ? documents.length > 0
        : documents.some((item) => item.ingest_status === 'ingesting')

  useEffect(() => {
    if (!shouldPoll) return
    const timer = window.setInterval(() => {
      void (async () => {
        const filterAtStart = ingestFilterRef.current
        try {
          const items = await refreshList(filterAtStart)
          if (ingestFilterRef.current !== filterAtStart) return
          if (!selectedId) return
          const current = items.find((item) => item.id === selectedId)
          if (!current) return
          const currentDetail = detailRef.current
          const keepReadyEditor =
            current.ingest_status === 'ready' &&
            currentDetail?.id === selectedId &&
            currentDetail.ingest_status === 'ready'
          if (!keepReadyEditor) {
            await loadDetail(selectedId)
          }
        } catch (error) {
          if (ingestFilterRef.current !== filterAtStart) return
          setListError(withMockLabel(readApiError(error, '无法刷新文档状态')))
        }
      })()
    }, DOCUMENT_POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [shouldPoll, selectedId, refreshList, loadDetail])

  const selectDocument = useCallback((documentId: string) => {
    setSaveMessage('')
    setSaveError('')
    setSelectedId(documentId)
  }, [])

  const setIngestFilter = useCallback(
    async (next: DocumentListFilter) => {
      const previous = ingestFilterRef.current
      ingestFilterRef.current = next
      setIngestFilterState(next)
      try {
        const items = await refreshList(next)
        if (ingestFilterRef.current !== next) return
        setSelectedId((current) => {
          if (current && items.some((item) => item.id === current)) return current
          return null
        })
      } catch (error) {
        if (ingestFilterRef.current !== next) return
        ingestFilterRef.current = previous
        setIngestFilterState(previous)
        setListError(withMockLabel(readApiError(error, '无法加载文档列表')))
      }
    },
    [refreshList],
  )

  const uploadFile = useCallback(
    async (file: File | undefined) => {
      setUploadError('')
      setSaveMessage('')
      if (!file) {
        setUploadError(withMockLabel('请选择文件'))
        return null
      }
      setUploading(true)
      try {
        const created = await uploadDocument(file)
        const currentFilter = ingestFilterRef.current
        const nextFilter: DocumentListFilter =
          currentFilter === 'ready' || currentFilter === 'failed' ? 'all' : currentFilter
        ingestFilterRef.current = nextFilter
        setIngestFilterState(nextFilter)
        await refreshList(nextFilter)
        if (ingestFilterRef.current === nextFilter) {
          setSelectedId(created.id)
        }
        return created
      } catch (error) {
        setUploadError(withMockLabel(readApiError(error, '请重新上传')))
        return null
      } finally {
        setUploading(false)
      }
    },
    [refreshList],
  )

  const saveDocument = useCallback(
    async (payload: DocumentUpdate) => {
      if (!selectedId || !detail || detail.ingest_status !== 'ready') {
        setSaveError(withMockLabel('文档仍在入库中，完成后才能修改标签或 FAQ。'))
        return null
      }
      setSaving(true)
      setSaveError('')
      setSaveMessage('')
      try {
        const updated = await updateDocument(selectedId, payload)
        setDetail(updated)
        detailRef.current = updated
        await refreshList()
        setSaveMessage(withMockLabel('已保存，将立即用于后续提问。'))
        return updated
      } catch (error) {
        setSaveError(withMockLabel(readApiError(error, '保存失败')))
        return null
      } finally {
        setSaving(false)
      }
    },
    [detail, refreshList, selectedId],
  )

  return {
    documents,
    ingestFilter,
    selectedId,
    detail,
    listError,
    uploadError,
    saveError,
    saveMessage,
    uploading,
    saving,
    detailLoading,
    selectDocument,
    setIngestFilter,
    uploadFile,
    saveDocument,
  }
}
