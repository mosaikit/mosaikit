type SessionExpiredListener = () => void

let sessionExpiredListener: SessionExpiredListener | null = null

/** Registra il callback invocato quando una chiamata riceve 401. */
export function onSessionExpired(fn: SessionExpiredListener): void {
  sessionExpiredListener = fn
}

export function getToken(): string | null {
  return localStorage.getItem('msk_token')
}

export function clearSession(): void {
  localStorage.removeItem('msk_token')
  localStorage.removeItem('msk_user')
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Client fetch per le API di Mosaikit.
 * - same-origin (in dev Vite prossata verso il server Rust)
 * - Bearer token da localStorage
 * - body object → JSON; con raw=true il body viene inviato così com'è (upload .mskp)
 * - qualsiasi non-2xx solleva Error con il body testuale
 * - 401 (tranne su /login) pulisce la sessione e notifica l'app
 */
export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  raw?: boolean,
): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = 'Bearer ' + token

  let payload: BodyInit | undefined
  if (body !== undefined) {
    if (raw) {
      payload = body as BodyInit
    } else {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
  }

  const res = await fetch(path, { method, headers, body: payload })

  if (res.status === 401 && path !== '/login') {
    clearSession()
    sessionExpiredListener?.()
    throw new Error('sessione scaduta')
  }
  if (!res.ok) {
    throw new Error((await res.text()) || 'HTTP ' + res.status)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}
