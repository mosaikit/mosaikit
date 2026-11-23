// Platform-wide presence (`msk.presence`): who of the tenant has the shell open right now, in any page, not only on the page
// of a plugin that opened a real-time channel. The host owns the connection; the page reads a list of user ids and their
// status. Needs no permission: it names only people of the tenant, by the ids the plugin already sees in its own data.

import type { Bridge } from './bridge.ts'
import type { PresenceSnapshot, PresenceStatus } from './protocol.ts'

export interface PresenceApi {
  /** the host speaks the presence protocol (the shell of this version or later); when false the list stays empty and the
   *  plugin keeps its own logic (a real-time channel) */
  readonly supported: boolean
  /** false while the connection of the shell is down: the list is then unknown, not empty */
  readonly live: boolean
  /** who is online now: user id to `available` or `away`; a person that is not in the list is offline */
  get(): Record<string, PresenceStatus>
  /** the status of one person (`offline` when they are not in the list) */
  status(userId: string): PresenceStatus | 'offline'
  /** called at every change of the list (also of `live`); returns the function that stops listening */
  onChange(fn: (list: Record<string, PresenceStatus>) => void): () => void
}

/** Presence of a page. The first use asks the host to start sending the list. */
export function makePresence(b: Bridge, supported: boolean): PresenceApi {
  let snap: PresenceSnapshot = { live: false, users: {} }
  const subs = new Set<(l: Record<string, PresenceStatus>) => void>()
  let started = false
  const start = () => {
    if (started || !supported) return
    started = true
    b.onEvent((event, data) => {
      if (event !== 'presence') return
      const d = data as Partial<PresenceSnapshot> | null
      snap = { live: d?.live === true, users: d && typeof d.users === 'object' && d.users ? d.users : {} }
      for (const f of [...subs]) f(snap.users)
    })
    void b.call('presence.watch').catch(() => {
      started = false
    })
  }
  return {
    supported,
    get live() {
      start()
      return snap.live
    },
    get: () => {
      start()
      return snap.users
    },
    status: (id) => {
      start()
      return snap.users[id] ?? 'offline'
    },
    onChange: (fn) => {
      start()
      subs.add(fn)
      return () => void subs.delete(fn)
    },
  }
}

/** Tells the host that the person is working in this page: input inside an iframe does not reach the shell, and the person
 *  must not turn `away` while they type in a plugin. At most one message every `every` ms. */
export function forwardActivity(b: Bridge, target: Window = window, every = 15_000, now: () => number = Date.now): () => void {
  let last = -Infinity
  const on = () => {
    const t = now()
    if (t - last < every) return
    last = t
    void b.call('presence.activity').catch(() => undefined)
  }
  const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']
  for (const e of events) target.addEventListener(e, on, { passive: true })
  return () => {
    for (const e of events) target.removeEventListener(e, on)
  }
}
