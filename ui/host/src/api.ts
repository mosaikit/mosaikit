// Client REST dell'host: cookie di sessione HttpOnly (gestito dal browser)
// + header X-CSRF-Token sulle richieste che modificano dati.

/**
 * Percorso base dell'app (es. "/mosaikit", "" alla radice), ricavato dalla pagina:
 * la UI e' servita da `<base>/` e naviga solo con l'hash.
 */
export const BASE = window.location.pathname.replace(/\/[^/]*$/, '')

/** URL di un percorso assoluto dell'app (`/api/...`) sotto il percorso base. */
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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** codice stabile del server (`wrong_credentials`, `forbidden`…), se c'e' */
    readonly code?: string,
  ) {
    super(message)
  }
}

/** Traduce un errore dal suo codice (lo imposta la shell con la lingua scelta); senza, il messaggio. */
let translate: (code: string | undefined, message: string) => string = (_c, m) => m

export function setErrorTranslator(fn: (code: string | undefined, message: string) => string) {
  translate = fn
}

export interface CallOptions {
  /** corpo binario (upload) */
  raw?: Blob
  /** risposta come Blob invece che JSON */
  blob?: boolean
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
  const r = await fetch(appUrl(path), { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' })
  // 401 delle pagine di accesso (credenziali o codice errati): nessuna sessione da chiudere
  if (r.status === 401 && onUnauthorized && !path.startsWith('/api/auth/')) onUnauthorized()
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    let code: string | undefined
    try {
      const j = await r.json()
      if (j && typeof j.error === 'string') msg = j.error
      if (j && typeof j.code === 'string') code = j.code
    } catch {
      /* corpo non JSON */
    }
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
  return isNaN(d.getTime()) ? '—' : d.toLocaleString(document.documentElement.lang || 'it', { dateStyle: 'short', timeStyle: 'short' })
}
