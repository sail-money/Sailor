/**
 * Same-origin API auth for when SAILOR_API_TOKEN is set (required if the UI
 * binds beyond loopback). Capture `?token=` once, store it in sessionStorage,
 * and attach it to subsequent same-origin /api fetches.
 */

const STORAGE_KEY = 'SAILOR_API_TOKEN'

export function apiToken() {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function captureApiTokenFromUrl() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const token = url.searchParams.get('token')
  if (!token) return
  try {
    sessionStorage.setItem(STORAGE_KEY, token)
  } catch { /* private mode / blocked storage — header just won't be sent */ }
  url.searchParams.delete('token')
  const search = url.searchParams.toString()
  const next = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`
  history.replaceState({}, '', next)
}

export function installApiAuth() {
  if (typeof window === 'undefined' || window.__sailorAuthInstalled) return
  window.__sailorAuthInstalled = true
  const orig = window.fetch.bind(window)
  window.fetch = (input, init = {}) => {
    const token = apiToken()
    if (!token) return orig(input, init)
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
    const isApi = typeof raw === 'string' && (
      raw.startsWith('/api/') || raw.startsWith(`${window.location.origin}/api/`)
    )
    if (!isApi) return orig(input, init)
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
    return orig(input, { ...init, headers })
  }
}
