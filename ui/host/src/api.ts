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
/** Code of the refusals during the maintenance of the platform. */
export const MAINTENANCE = 'maintenance'
/** Code of an error without a message of the server: never show a bare HTTP status. */
export const UNEXPECTED = 'unexpected'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** stable code of the server (`wrong_credentials`, `forbidden`…), or one of the client */
    readonly code?: string,
    /** code the logic of a plugin gave to its own error (`Error::coded` of the SDK); only with `code` `plugin_error` */
    readonly pluginCode?: string,
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

/** Language of the interface, sent with every request: the server answers with the texts of the
 *  plugins (names, labels, choices, KPIs) in that language. */
let language = ''

export function setRequestLanguage(l: string) {
  language = l
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
  if (language) headers['Accept-Language'] = language
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
    let j: { error?: unknown; code?: unknown; plugin_code?: unknown } | null = null
    try {
      j = await r.json()
    } catch {
      // not the JSON of Mosaikit: whoever answered is not the server
      throw unavailable()
    }
    const msg = j && typeof j.error === 'string' ? j.error : 'Something went wrong. Try again.'
    const code = j && typeof j.code === 'string' ? j.code : j && typeof j.error === 'string' ? undefined : UNEXPECTED
    // maintenance: only the Administrators work, the others go back to the sign-in page with the notice
    if (code === MAINTENANCE && onUnauthorized && !path.startsWith('/api/auth/')) onUnauthorized()
    throw new ApiError(msg, r.status, code, j && typeof j.plugin_code === 'string' ? j.plugin_code : undefined)
  }
  if (opts.blob) return (await r.blob()) as T
  const text = await r.text()
  return (text ? JSON.parse(text) : null) as T
}

/**
 * A POST whose answer is a stream of server-sent events (`event:` and `data:` lines, JSON data): `onEvent` gets each one as it
 * arrives, the `done` event ends the call and is returned, an `error` event or a refusal throws an `ApiError`.
 */
export async function apiStream<T = unknown>(path: string, body: unknown, onEvent: (type: string, data: unknown) => void): Promise<T> {
  const headers: Record<string, string> = { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  if (language) headers['Accept-Language'] = language
  let r: Response
  try {
    r = await fetch(appUrl(path), { method: 'POST', headers, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' })
  } catch {
    throw unavailable()
  }
  if (!r.ok || !r.body) {
    if (r.status === 502 || r.status === 503 || r.status === 504) throw unavailable()
    let j: { error?: unknown; code?: unknown } | null = null
    try {
      j = await r.json()
    } catch {
      throw unavailable()
    }
    throw new ApiError(j && typeof j.error === 'string' ? j.error : 'Something went wrong. Try again.', r.status, j && typeof j.code === 'string' ? j.code : undefined)
  }
  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let done: T | undefined
  const block = (raw: string) => {
    let type = 'message'
    let data = ''
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (!data) return
    let v: unknown
    try {
      v = JSON.parse(data)
    } catch {
      return
    }
    if (type === 'done') done = v as T
    else if (type === 'error') {
      const e = v as { code?: string; message?: string }
      throw new ApiError(e.message ?? 'Something went wrong. Try again.', 500, e.code)
    } else onEvent(type, v)
  }
  for (;;) {
    const { value, done: end } = await reader.read()
    if (value) buf += decoder.decode(value, { stream: true })
    let i = buf.indexOf('\n\n')
    while (i >= 0) {
      block(buf.slice(0, i))
      buf = buf.slice(i + 2)
      i = buf.indexOf('\n\n')
    }
    if (end) break
  }
  if (buf.trim()) block(buf)
  if (done === undefined) throw unavailable()
  return done
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
