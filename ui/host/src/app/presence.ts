// Platform-wide presence: while the shell of a tenant is open the person is seen as online by every member, in every page
// and plugin (not only on the page of a plugin that opened a channel). One EventSource to `/api/t/{t}/presence/stream`
// carries the whole list; the state of this tab (`available` or `away`) goes back with a POST. The server turns a lost
// connection into `offline` (nobody on the list), and a person with several tabs is available if any tab is.
// Plugins read the list through `msk.presence` (see ui/plugin-api, `PresenceApi`).

import { api, appUrl } from '../api.ts'

export type PresenceStatus = 'available' | 'away'

/** Without input for this long the person is away. */
export const AWAY_AFTER = 5 * 60_000
/** A tab that stayed hidden for this long counts as away (the person is not looking at it). */
export const HIDDEN_AFTER = 2 * 60_000

/** What the host tells a plugin page: `live` is false while the connection is down (the list is then not known). */
export interface PresenceSnapshot {
  live: boolean
  users: Record<string, PresenceStatus>
}

/** Input and visibility of this tab; the pure part of the presence (tested without a browser). */
export class ActivityClock {
  private last: number
  private hiddenSince: number | null = null

  constructor(now: number, hidden = false) {
    this.last = now
    if (hidden) this.hiddenSince = now
  }

  /** Any input of the person, in the shell or inside a plugin page. */
  input(now: number) {
    this.last = now
  }

  /** The tab was hidden or shown: showing it is itself an act of the person. */
  visibility(now: number, hidden: boolean) {
    if (hidden) {
      this.hiddenSince ??= now
    } else {
      this.hiddenSince = null
      this.last = now
    }
  }

  status(now: number): PresenceStatus {
    if (this.hiddenSince !== null && now - this.hiddenSince >= HIDDEN_AFTER) return 'away'
    return now - this.last >= AWAY_AFTER ? 'away' : 'available'
  }

  /** Milliseconds until the status may change (a timer for the caller), or null when it is away already. */
  next(now: number): number | null {
    if (this.status(now) === 'away') return null
    const idle = AWAY_AFTER - (now - this.last)
    const hid = this.hiddenSince === null ? Infinity : HIDDEN_AFTER - (now - this.hiddenSince)
    return Math.max(1, Math.min(idle, hid))
  }
}

/** The list after an event of the stream (`presence` replaces it, `join` and `state` set one person, `leave` removes one). */
export function applyEvent(users: Record<string, PresenceStatus>, type: string, data: unknown): Record<string, PresenceStatus> {
  const d = (data ?? {}) as { people?: { id: string; state?: { status?: string } }[]; from?: { id: string; state?: { status?: string } } }
  const st = (p?: { state?: { status?: string } }): PresenceStatus => (p?.state?.status === 'away' ? 'away' : 'available')
  switch (type) {
    case 'presence':
      return Object.fromEntries((d.people ?? []).map((p) => [p.id, st(p)]))
    case 'join':
    case 'state':
      return d.from ? { ...users, [d.from.id]: st(d.from) } : users
    case 'leave': {
      if (!d.from) return users
      const { [d.from.id]: _gone, ...rest } = users
      return rest
    }
    default:
      return users
  }
}

let snapshot: PresenceSnapshot = { live: false, users: {} }
const watchers = new Set<(s: PresenceSnapshot) => void>()
let clock: ActivityClock | null = null
let kick: (() => void) | null = null

function publish(next: PresenceSnapshot) {
  snapshot = next
  for (const w of watchers) w(snapshot)
}

export function presenceSnapshot(): PresenceSnapshot {
  return snapshot
}

/** A plugin page (or the shell) wants the list now and at every change. Returns the function that stops. */
export function watchPresence(fn: (s: PresenceSnapshot) => void): () => void {
  watchers.add(fn)
  fn(snapshot)
  return () => void watchers.delete(fn)
}

/** Input seen inside a plugin page (its events do not reach the shell). */
export function pluginInput() {
  if (!clock) return
  clock.input(Date.now())
  kick?.()
}

/** Opens the presence of the tenant; the returned function closes it (the person leaves the tenant or the shell). */
export function startPresence(tenant: string): () => void {
  if (typeof EventSource === 'undefined') return () => undefined
  const tab = crypto.randomUUID()
  const c = new ActivityClock(Date.now(), document.visibilityState === 'hidden')
  clock = c
  let sent: PresenceStatus = c.status(Date.now())
  let timer: ReturnType<typeof setTimeout> | undefined
  let users: Record<string, PresenceStatus> = {}
  const base = `/api/t/${encodeURIComponent(tenant)}/presence`
  const es = new EventSource(appUrl(`${base}/stream?tab=${tab}&status=${sent}`))

  const sync = () => {
    const now = Date.now()
    const s = c.status(now)
    if (s !== sent) {
      sent = s
      void api('POST', `${base}/state`, { tab, status: s }).catch(() => undefined)
    }
    clearTimeout(timer)
    const n = c.next(now)
    if (n !== null) timer = setTimeout(sync, n)
  }
  kick = sync

  es.onopen = () => publish({ live: true, users })
  // the browser retries by itself and the first event of the new stream brings the whole list again; until then the list is unknown
  es.onerror = () => {
    users = {}
    publish({ live: false, users })
  }
  for (const type of ['presence', 'join', 'state', 'leave'] as const)
    es.addEventListener(type, (e) => {
      try {
        users = applyEvent(users, type, JSON.parse((e as MessageEvent<string>).data))
        publish({ live: true, users })
      } catch {
        /* a frame that is not JSON is dropped */
      }
    })
  // logged out elsewhere, or too slow: the stream ends and nobody sees the person as online
  es.addEventListener('closed', () => {
    es.close()
    users = {}
    publish({ live: false, users })
  })
  // after a reconnection the server counts this tab as available again: say the real status
  es.addEventListener('presence', () => {
    sent = 'available'
    sync()
  })

  const input = () => {
    c.input(Date.now())
    sync()
  }
  const visibility = () => {
    c.visibility(Date.now(), document.visibilityState === 'hidden')
    sync()
  }
  const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
  let lastMove = 0
  const throttled = () => {
    const now = Date.now()
    if (now - lastMove < 5000) return
    lastMove = now
    input()
  }
  for (const ev of events) window.addEventListener(ev, throttled, { passive: true })
  document.addEventListener('visibilitychange', visibility)
  sync()
  return () => {
    for (const ev of events) window.removeEventListener(ev, throttled)
    document.removeEventListener('visibilitychange', visibility)
    clearTimeout(timer)
    es.close()
    if (clock === c) {
      clock = null
      kick = null
    }
    publish({ live: false, users: {} })
  }
}
