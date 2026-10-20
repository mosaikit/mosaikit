import { useEffect, useRef, useState } from 'react'
import { getToken } from '../api.ts'

// Loader delle UI dei plugin (modello GeoLibre): scarica /plugins/{id}/ui.js
// e lo esegue con la "api" dell'host. Il codice e' TRUSTED (pieni privilegi
// della sessione) — come i plugin JS di GeoLibre. Il plugin puo' restituire
// una funzione di cleanup.
//
// api disponibile per il plugin:
//   api.container  HTMLElement assegnato
//   api.user       utente loggato
//   api.get(path) / api.post(path, body) / api.put(path, body) / api.del(path)
//                                                           REST autenticato
//   api.upload(url, file)                                   upload raw

interface PluginApi {
  container: HTMLElement
  user: string
  get: (path: string) => Promise<unknown>
  post: (path: string, body?: unknown) => Promise<unknown>
  put: (path: string, body?: unknown) => Promise<unknown>
  del: (path: string) => Promise<unknown>
  upload: (url: string, file: File) => Promise<unknown>
}

export default function PluginView({ pluginId, user }: { pluginId: string; user: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let disposed = false
    let cleanup: void | (() => void)
    setState('loading')
    setErr('')

    const req = async (method: string, path: string, body?: unknown) => {
      const r = await fetch(path, {
        method,
        headers: {
          Authorization: 'Bearer ' + (getToken() ?? ''),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!r.ok) throw new Error(await r.text())
      const t = await r.text()
      return t ? JSON.parse(t) : {}
    }
    const api: PluginApi = {
      container: el,
      user,
      get: (path) => req('GET', path),
      post: (path, body) => req('POST', path, body),
      put: (path, body) => req('PUT', path, body),
      del: (path) => req('DELETE', path),
      upload: async (url, file) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + (getToken() ?? '') },
          body: file,
        })
        if (!r.ok) throw new Error(await r.text())
        return r.json()
      },
    }

    fetch('/plugins/' + encodeURIComponent(pluginId) + '/ui.js')
      .then((r) => {
        if (!r.ok) throw new Error('ui.js: HTTP ' + r.status + ' per ' + pluginId)
        return r.text()
      })
      .then((js) => {
        if (disposed) return
        if (!js.trim()) throw new Error('ui.js vuoto')
        let fn: (a: PluginApi) => void | (() => void)
        try {
          fn = new Function('api', js) as (a: PluginApi) => void | (() => void)
        } catch (e) {
          throw new Error('ui.js non compilabile: ' + (e instanceof Error ? e.message : String(e)))
        }
        const res = fn(api)
        if (typeof res === 'function') cleanup = res
        if (disposed) return
        setState(el.children.length > 0 ? 'ready' : 'error')
        if (el.children.length === 0) {
          setErr('ui.js eseguito ma non ha disegnato nulla nel container')
        }
      })
      .catch((e) => {
        if (disposed) return
        setState('error')
        setErr(e instanceof Error ? e.message : String(e))
      })

    return () => {
      disposed = true
      if (cleanup) {
        try { cleanup() } catch { /* ignore */ }
      }
      el.innerHTML = ''
    }
  }, [pluginId, user])

  return (
    <section className="crud">
      <div ref={ref} className="plugin-host" />
      {state === 'loading' && <div className="install-msg">caricamento UI plugin…</div>}
      {state === 'error' && (
        <div className="install-msg" style={{ color: 'var(--err)' }}>
          UI plugin non disponibile: {err}
        </div>
      )}
    </section>
  )
}
