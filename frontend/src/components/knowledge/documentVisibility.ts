import {
  DOCUMENT_VISIBILITY_OPTIONS,
  type DocumentVisibility,
} from '../../types/document.ts'

export function visibilityLabel(code: DocumentVisibility | null): string {
  if (!code) return ''
  return DOCUMENT_VISIBILITY_OPTIONS.find((item) => item.code === code)?.name ?? code
}

export function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function fromDatetimeLocalValue(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}
