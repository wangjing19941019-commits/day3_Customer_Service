export function isMockEnabled(): boolean {
  const value = import.meta.env.VITE_USE_MOCK
  if (value === 'false' || value === '0') return false
  return true
}

export function withMockLabel(text: string): string {
  if (!isMockEnabled()) return text
  if (text.includes('[Mock]')) return text
  return `[Mock] ${text}`
}
