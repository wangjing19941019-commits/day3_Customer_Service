export const AUTH_UNAUTHORIZED_EVENT = 'auth:unauthorized'

export function emitAuthUnauthorized(): void {
  window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT))
}
