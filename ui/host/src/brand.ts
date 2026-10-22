import { useSyncExternalStore } from 'react'
import { api, isUnavailable } from './api.ts'
import type { ShellBand } from './types.ts'

/** Brand of the product (`brand.toml` of the distribution), with the theme and the top bar of the
 *  platform: public, so the sign-in page has them before a session exists. */
export interface Brand {
  name: string
  version: string
  kernel_version: string
  tagline: string
  login_message: string
  footer: string
  support_url: string | null
  /** there is a brand logo (otherwise the Mosaikit symbol) */
  logo: boolean
  /** theme of the platform (recent servers) */
  theme?: string
  /** top bar of the platform (recent servers) */
  band?: ShellBand
  /** identity of the platform (System › Identity and texts), recent servers */
  logo_dark?: boolean
  icon?: boolean
  welcome?: string
  privacy_url?: string
  legal_url?: string
  /** languages of the platform and the default one ("auto": the one of the browser) */
  languages?: string[]
  language?: string
  locale?: string
  /** default mode (light, dark, auto) for whoever did not choose one */
  mode?: string
  /** maintenance mode and the planned one (recent servers) */
  maintenance?: { on: boolean; message: string; planned_at: string | null; planned_message: string }
}

export const DEFAULT_BRAND: Brand = {
  name: 'Mosaikit',
  version: '',
  kernel_version: '',
  tagline: '',
  login_message: '',
  footer: '',
  support_url: null,
  logo: false,
}

/** Wait before the next attempt when the server does not answer: 3 s, growing up to 15 s. */
export function retryDelay(attempt: number): number {
  return Math.min(3000 * 1.5 ** attempt, 15000)
}

/** `loading` until the first answer; `unavailable` while the server does not answer (and retrying). */
export type BrandStatus = 'loading' | 'ok' | 'unavailable'

let current: { brand: Brand; status: BrandStatus } = { brand: DEFAULT_BRAND, status: 'loading' }
const listeners = new Set<() => void>()
let started = false

function set(next: typeof current) {
  current = next
  if (next.status === 'ok') document.title = next.brand.name
  listeners.forEach((l) => l())
}

/** Loads the brand once; while the server does not answer it keeps trying. */
function start() {
  if (started) return
  started = true
  const attempt = (n: number) => {
    api<Brand>('GET', '/api/brand')
      .then((b) => set({ brand: { ...DEFAULT_BRAND, ...b }, status: 'ok' }))
      .catch((e) => {
        if (!isUnavailable(e)) return set({ brand: DEFAULT_BRAND, status: 'ok' })
        set({ brand: current.brand, status: 'unavailable' })
        setTimeout(() => attempt(n + 1), retryDelay(n))
      })
  }
  attempt(0)
}

/** Reads the brand again (after a change of the identity of the platform). */
export function reloadBrand() {
  api<Brand>('GET', '/api/brand')
    .then((b) => set({ brand: { ...DEFAULT_BRAND, ...b }, status: 'ok' }))
    .catch(() => undefined)
}

export function useBrandState(): { brand: Brand; status: BrandStatus } {
  start()
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

export function useBrand(): Brand {
  return useBrandState().brand
}
