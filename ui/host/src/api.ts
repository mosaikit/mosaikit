// REST client of the host: HttpOnly session cookie (handled by the browser)
// + X-CSRF-Token header on the requests that change data.

/**
 * Base path of the app (e.g. "/mosaikit", "" at the root), taken from the page:
 * the UI is served from `<base>/` and navigates with the hash only.
 */
export const BASE = window.location.pathname.replace(/\/[^/]*$/, '')

/** URL of an absolute path of the app (`/api/...`) under the base path. */
export function appUrl(path: string): string {
  return path.startsWith('/') ? BASE + path : path
}

let csrf = ''
let onUnauthorized: (() => void) | null = null

export function setCsrf(token: string) {
  csrf = token
}

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

/** Code of the errors raised when the server does not answer (restarting, unreachable, proxy error). */
export const UNAVAILABLE = 'server_unavailable'
/** Code of an error without a message of the server: never show a bare HTTP status. */
export const UNEXPECTED = 'unexpected'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** stable code of the server (`wrong_credentials`, `forbidden`…), or one of the client */
    readonly code?: string,
  ) {
    super(message)
  }
}

/** The server is not answering: whoever shows the error retries instead of giving up. */
export function isUnavailable(e: unknown): boolean {
  return e instanceof ApiError && e.code === UNAVAILABLE
}

/** Translates an error from its code (the shell sets it with the chosen language); otherwise the message. */
let translate: (code: string | undefined, message: string) => string = (_c, m) => m

export function setErrorTranslator(fn: (code: string | undefined, message: string) => string) {
  translate = fn
}

export interface CallOptions {
  /** binary body (upload) */
  raw?: Blob
  /** response as a Blob instead of JSON */
  blob?: boolean
}

function unavailable(): ApiError {
  return new ApiError('The server is not responding. Trying again…', 0, UNAVAILABLE)
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrf
  let payload: BodyInit | undefined
  if (opts.raw) {
    headers['Content-Type'] = 'application/octet-stream'
    payload = opts.raw
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let r: Response
  try {
    r = await fetch(appUrl(path), { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' })
  } catch {
    // network error: the server is down or restarting
    throw unavailable()
  }
  // 401 of the sign-in pages (wrong credentials or code): no session to close
  if (r.status === 401 && onUnauthorized && !path.startsWith('/api/auth/')) onUnauthorized()
  if (!r.ok) {
    // a gateway between browser and server (Vite, a reverse proxy) answers for a server that is not there
    if (r.status === 502 || r.status === 503 || r.status === 504) throw unavailable()
    let j: { error?: unknown; code?: unknown } | null = null
    try {
      j = await r.json()
    } catch {
      // not the JSON of Mosaikit: whoever answered is not the server
      throw unavailable()
    }
    const msg = j && typeof j.error === 'string' ? j.error : 'Something went wrong. Try again.'
    const code = j && typeof j.code === 'string' ? j.code : j && typeof j.error === 'string' ? undefined : UNEXPECTED
    throw new ApiError(msg, r.status, code)
  }
  if (opts.blob) return (await r.blob()) as T
  const text = await r.text()
  return (text ? JSON.parse(text) : null) as T
}

export function errText(e: unknown): string {
  if (e instanceof ApiError) return translate(e.code, e.message)
  return e instanceof Error ? e.message : String(e)
}

export const enc = encodeURIComponent

export function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString(document.documentElement.lang || 'en', { dateStyle: 'short', timeStyle: 'short' })
}
