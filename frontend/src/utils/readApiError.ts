import axios from 'axios'
import type { ApiEnvelope } from '../types/api.ts'

export function readApiError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as ApiEnvelope<null> | undefined
    if (payload && typeof payload.error === 'string' && payload.error.length > 0) {
      return payload.error
    }
  }
  return fallback
}
