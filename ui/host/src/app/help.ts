// Help of the shell (docs/refactoring-ui.md §2), the logic: the guided tours of the pages (Home, Manage,
// Plugins, System) pointing at elements marked with `data-tour`, the items of the help menu, the release
// notes of this version from the changelog shipped with the build. A tour seen to the end or skipped is
// remembered with the person (`/api/me/prefs`). The dialogs and the tour itself are in HelpLayer.tsx.

import { useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleHelp, CirclePlay, Keyboard, Sparkles } from 'lucide-react'
import { api } from '../api.ts'
import { useBrand } from '../brand.ts'
import type { PersonPrefs, Session } from '../types.ts'
import { useTenantCtx } from './core.ts'
import { t } from './i18n.ts'
import type { Route } from './router.ts'

// ------------------------------------------------------------------ state

type Open = 'guide' | 'whatsnew' | 'shortcuts' | null
interface HelpState {
  open: Open
  tour: { id: string; step: number } | null
}
let state: HelpState = { open: null, tour: null }
const listeners = new Set<() => void>()
export function set(s: Partial<HelpState>) {
  state = { ...state, ...s }
  listeners.forEach((l) => l())
}
export function useHelpState(): HelpState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
export function openHelp(open: Open) {
  set({ open })
}
export function startTour(id: string) {
  set({ tour: { id, step: 0 }, open: null })
}

// ------------------------------------------------------------------ tours

export interface Step {
  /** value of the `data-tour` attribute of the element */
  target: string
  title: string
  text: string
}

/** The steps of the tours; a step whose element is not on the page is skipped. */
export const TOURS: Record<string, Step[]> = {
  home: [
    { target: 'sidebar', title: 'Your apps and pages', text: 'The apps of the tenant and the pages you may open. The button at the top opens or closes the sidebar.' },
    { target: 'search', title: 'Search everywhere', text: 'Pages, apps and the items you can see, as you type. Also with Ctrl K or /.' },
    { target: 'bell', title: 'Notifications', text: 'Invitations, shares, access requests and alerts arrive here, at once.' },
    { target: 'help', title: 'Help', text: 'This tour, the guide, what is new and the keyboard shortcuts.' },
    { target: 'person', title: 'Your account', text: 'Profile, sign-in and security, notifications, appearance and language, your tenants.' },
  ],
  manage: [
    { target: 'page-header', title: 'Manage', text: 'The people of the tenant, their groups and permission profiles, and what is waiting for you.' },
    { target: 'sections', title: 'Sections', text: 'People, Groups, Permission profiles and Pending: invitations and access requests to decide.' },
    { target: 'page-actions', title: 'Actions', text: 'Invite people or create a group; select rows in a list for the actions on many at once.' },
  ],
  plugins: [
    { target: 'page-header', title: 'Plugins', text: 'The apps, services and extensions of the platform, and which ones are on here.' },
    { target: 'content', title: 'On and off', text: 'Turn a plugin on or off; its extensions follow it. Access and permissions decide who uses it.' },
  ],
  system: [
    { target: 'page-header', title: 'System', text: 'The settings of the whole platform, for every tenant.' },
    { target: 'sections', title: 'Sections', text: 'Administrators, passwords and sessions, keys, email, identity and appearance, quotas, retention.' },
    { target: 'content', title: 'Inherited or customized', text: 'What tenants may customize, what they inherit and what the platform manages for them.' },
  ],
}

/** The tour of the page on screen, if it has one. */
export function tourOf(r: Route): string | null {
  if (r.area === 'tenant') {
    if (r.page === 'home') return 'home'
    if (r.page === 'manage') return 'manage'
    if (r.page === 'plugins') return 'plugins'
    return null
  }
  if (r.area === 'admin') {
    if (r.page === 'overview') return 'home'
    if (r.page === 'plugins') return 'plugins'
    if (r.page === 'system') return 'system'
  }
  return null
}

export function targetOf(s: Step): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${s.target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? el : null
}

/** Remembers a tour as seen (with the person, for every device). */
export function useTourDone() {
  const qc = useQueryClient()
  return async (id: string) => {
    try {
      const me = await api<PersonPrefs>('PUT', '/api/me/prefs', { tour_done: id })
      qc.setQueryData<Session | null>(['session'], (s) => (s ? { ...s, me } : s))
    } catch {
      /* the tour shows again next time */
    }
  }
}

/** The section of `version` of the changelog: `## <version>` up to the next `## `. */
export function releaseNotes(md: string, version: string): { group: string; items: string[] }[] {
  const lines = md.split(/\r?\n/)
  const start = lines.findIndex((l) => /^##\s+\[?v?([0-9][^\]\s]*)\]?/.exec(l)?.[1] === version)
  if (start < 0) return []
  const out: { group: string; items: string[] }[] = []
  let cur: { group: string; items: string[] } = { group: '', items: [] }
  for (const l of lines.slice(start + 1)) {
    if (/^##\s/.test(l)) break
    const h = /^###\s+(.*)$/.exec(l)
    if (h) {
      if (cur.items.length) out.push(cur)
      cur = { group: h[1].trim(), items: [] }
    } else if (/^-\s+/.test(l)) cur.items.push(l.replace(/^-\s+/, '').trim())
    else if (/^\s+\S/.test(l) && cur.items.length) cur.items[cur.items.length - 1] += ' ' + l.trim()
  }
  if (cur.items.length) out.push(cur)
  return out
}

/** The address of the guide (Identity and texts), if there is one. */
function useGuideUrl(session: Session, route: Route): string {
  const ctx = useTenantCtx(route.area === 'tenant' ? route.tenant : '')
  const config = route.area === 'tenant' ? ctx.data?.config : session.config
  return (config?.['identity.guide_url'] as string | undefined) ?? ''
}

export interface HelpItem {
  icon: typeof CircleHelp
  label: string
  run: () => void
  /** a tour of this page not seen yet */
  fresh?: boolean
  disabled?: boolean
}

/** The items of the help (menu of the bar, or person menu). */
export function useHelpItems(session: Session, route: Route): HelpItem[] {
  const brand = useBrand()
  const guide = useGuideUrl(session, route)
  const tour = tourOf(route)
  const fresh = !!tour && !(session.me?.tours_done ?? []).includes(tour)
  return [
    { icon: CirclePlay, label: t('Guided tour of this page'), run: () => tour && startTour(tour), fresh, disabled: !tour },
    { icon: CircleHelp, label: t('Guide of Mosaikit'), run: () => (guide ? void window.open(guide, '_blank', 'noopener') : openHelp('guide')) },
    { icon: Sparkles, label: t('What is new in version {v}', { v: brand.version || '1.0' }), run: () => openHelp('whatsnew') },
    { icon: Keyboard, label: t('Keyboard shortcuts'), run: () => openHelp('shortcuts') },
  ]
}

/** A tour of this page waits to be seen (dot on the help button). */
export function useFreshTour(session: Session, route: Route): boolean {
  const tour = tourOf(route)
  return !!tour && !(session.me?.tours_done ?? []).includes(tour)
}

/** Opens the search box of the top bar (it listens to this event). */
export function openSearch() {
  window.dispatchEvent(new CustomEvent('msk:search'))
}

