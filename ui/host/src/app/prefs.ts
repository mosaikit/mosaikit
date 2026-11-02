// Preferences of the frame: the top bar decided by the Administrator (from the session) and the sidebar
// at start chosen by the person (in the browser).

import type { Session, ShellBand } from '../types.ts'

/** The top bar decided by the Administrator; with a server that does not send it, everything on. */
export const BAND_ON: ShellBand = { logo: true, search: true, lang: true, help: true, mode: true }
export function bandOf(session: Session): ShellBand {
  return { ...BAND_ON, ...session.band }
}

/** The groups of the navigation a person collapsed (id -> false), kept in the browser like the sidebar. */
export const NAV_GROUPS_PREF = 'msk_nav_groups'
export function navGroupOpen(id: string): boolean {
  try {
    return JSON.parse(localStorage.getItem(NAV_GROUPS_PREF) ?? '{}')[id] !== false
  } catch {
    return true
  }
}
export function setNavGroupOpen(id: string, open: boolean) {
  try {
    const all = JSON.parse(localStorage.getItem(NAV_GROUPS_PREF) ?? '{}')
    if (open) delete all[id]
    else all[id] = false
    localStorage.setItem(NAV_GROUPS_PREF, JSON.stringify(all))
  } catch {
    /* the state is a convenience */
  }
}

/** The sidebar at start: closed (icons) or open, chosen in Account › Appearance and language. */
export const SIDEBAR_PREF = 'msk_sidebar_open'
export function sidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_PREF) === '1'
  } catch {
    return false
  }
}
