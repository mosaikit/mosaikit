// The page of a plugin that is shown inside a frame of the page of another plugin (`[[embeds]]` in its manifest). It has no
// session and no bridge to the shell: the address it was opened with carries a **ticket** limited to one resource and to the
// commands the embed declares, and it calls its own plugin with that ticket. What it tells the page that embeds it is a
// matter of `window.parent.postMessage` under the contract of the embed (for example `geo-embed/1`).

/** What an embedded page learns from its address. */
export interface EmbedSession {
  /** the plugin that owns the page (the one whose commands the ticket calls) */
  plugin: string
  /** the resource the page shows */
  resource: string
  /** Calls a command of the plugin with the ticket: the rights are those of the person who looks, limited to the resource. */
  call<T = unknown>(command: string, args?: unknown): Promise<T>
}

const COMMAND = /^[A-Za-z0-9_.-]{1,64}$/

/**
 * The session of an embedded page, or `null` when the page was not opened by `msk.embeds.url` (then use `connect()`).
 * The address carries `embed` (the ticket), `plugin`, `resource` and `api` (the origin of the platform).
 */
export function embedSession(href: string = typeof location === 'undefined' ? '' : location.href): EmbedSession | null {
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return null
  }
  const ticket = u.searchParams.get('embed')
  const plugin = u.searchParams.get('plugin')
  const resource = u.searchParams.get('resource')
  const api = u.searchParams.get('api')
  if (!ticket || !plugin || !resource || !api || !/^[0-9a-f]{48}$/.test(ticket)) return null
  let origin: string
  try {
    const a = new URL(api)
    if (a.protocol !== 'https:' && a.protocol !== 'http:') return null
    origin = a.origin
  } catch {
    return null
  }
  return {
    plugin,
    resource,
    call: async <T = unknown>(command: string, args?: unknown): Promise<T> => {
      if (!COMMAND.test(command)) throw new Error('invalid command name')
      const r = await fetch(`${origin}/api/run/${ticket}/call/${encodeURIComponent(plugin)}/${command}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args ?? null),
        cache: 'no-store',
      })
      const j = (await r.json().catch(() => null)) as { ok?: T; error?: string; code?: string } | null
      if (!r.ok || !j) {
        const e = new Error(j?.error ?? `request failed (${r.status})`) as Error & { code?: string }
        e.code = j?.code
        throw e
      }
      return j.ok as T
    },
  }
}
