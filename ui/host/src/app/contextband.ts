// The contextual top band: while a plugin shows a resource on the full page (a map, a dashboard, a process)
// it declares what the band shows with `msk.band.set` (docs/architecture.md, plugin UI bridge). Everything
// that comes from the iframe is untrusted: `sanitizeBand` checks the types and the lengths and keeps plain
// text only; the shell draws it with React text nodes (never HTML). The state belongs to the frame that set
// it (`owner`): another frame cannot clear it, and the shell clears it when the page closes or the route changes.

import { useSyncExternalStore } from 'react'
import { OpError } from '../bridge.ts'

export const BAND_MAX_PEOPLE = 50
export const BAND_MAX_NAME = 80
export const BAND_MAX_INITIALS = 3
export const BAND_MAX_COUNT = 9999
const BAND_MAX_ID = 64

export interface BandPersonView {
  id: string
  name: string
  initials: string
}

export interface BandView {
  /** false: the search bar is hidden (true never appears: the plugin cannot add what the shell hides) */
  hideSearch: boolean
  mode: { value: 'view' | 'edit'; canEdit: boolean } | null
  presence: BandPersonView[]
  comments: { open: boolean; count: number | null } | null
}

type Args = Record<string, unknown>

function plain(v: unknown): Args {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new OpError('invalid band')
  return v as Args
}

/** Plain text: control characters and bidi overrides out, spaces collapsed, cut to `max` characters. */
export function cleanText(v: unknown, max: number, what: string): string {
  if (typeof v !== 'string') throw new OpError(`invalid band ${what}`)
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(s).slice(0, max).join('')
}

/** The first letters of the first and last word, capital, at most 3. */
export function initialsOf(name: string): string {
  const w = name.split(' ').filter(Boolean)
  const pick = (s: string) => Array.from(s)[0] ?? ''
  const raw = w.length > 1 ? pick(w[0]) + pick(w[w.length - 1]) : pick(w[0] ?? '')
  return raw.toLocaleUpperCase()
}

/** Validates the arguments of `band.set`. A wrong type refuses the call; a text that is too long is cut; a list
 *  that is too long is cut to the first 50 people; a count above 9999 is shown as 9999. */
export function sanitizeBand(raw: unknown): BandView {
  const a = plain(raw ?? {})
  const view: BandView = { hideSearch: false, mode: null, presence: [], comments: null }
  if (a.search !== undefined) {
    if (typeof a.search !== 'boolean') throw new OpError('invalid band search')
    view.hideSearch = a.search === false
  }
  if (a.mode !== undefined && a.mode !== null) {
    const m = plain(a.mode)
    if ((m.value !== 'view' && m.value !== 'edit') || typeof m.canEdit !== 'boolean') throw new OpError('invalid band mode')
    // a person who cannot edit is never shown the edit mode
    view.mode = { value: m.canEdit ? m.value : 'view', canEdit: m.canEdit }
  }
  if (a.presence !== undefined && a.presence !== null) {
    if (!Array.isArray(a.presence)) throw new OpError('invalid band presence')
    const seen = new Set<string>()
    for (const x of a.presence.slice(0, BAND_MAX_PEOPLE)) {
      const p = plain(x)
      const id = cleanText(p.id, BAND_MAX_ID, 'person')
      const name = cleanText(p.name, BAND_MAX_NAME, 'name')
      if (!id || !name || seen.has(id)) continue
      seen.add(id)
      const given = p.initials === undefined || p.initials === null ? '' : cleanText(p.initials, BAND_MAX_INITIALS, 'initials')
      view.presence.push({ id, name, initials: given || initialsOf(name) })
    }
  }
  if (a.comments !== undefined && a.comments !== null) {
    const c = plain(a.comments)
    if (typeof c.open !== 'boolean') throw new OpError('invalid band comments')
    let count: number | null = null
    if (c.count !== undefined && c.count !== null) {
      if (typeof c.count !== 'number' || !Number.isInteger(c.count) || c.count < 0) throw new OpError('invalid band comments count')
      count = Math.min(c.count, BAND_MAX_COUNT)
    }
    view.comments = { open: c.open, count }
  }
  return view
}

// --- the state of the band (one at a time: only one plugin page is open) ---

interface State {
  owner: string | null
  view: BandView | null
  /** sends an event back to the plugin that owns the band */
  emit: ((event: string, data: unknown) => void) | null
}

let state: State = { owner: null, view: null, emit: null }
const listeners = new Set<() => void>()
const publish = (s: State) => {
  state = s
  listeners.forEach((l) => l())
}

export function setBand(owner: string, view: BandView, emit: (event: string, data: unknown) => void) {
  publish({ owner, view, emit })
}

/** Clears the band. With `owner`, only if that frame owns it; without, always (a route change). */
export function resetBand(owner?: string) {
  if (state.view === null && state.owner === null) return
  if (owner !== undefined && state.owner !== owner) return
  publish({ owner: null, view: null, emit: null })
}

export function currentBand(): BandView | null {
  return state.view
}

/** The plugin's callbacks: the shell tells it what the person did. */
export function bandEmit(event: 'band.mode' | 'band.comments', data: unknown) {
  state.emit?.(event, data)
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useBand(): BandView | null {
  return useSyncExternalStore(subscribe, currentBand, currentBand)
}
