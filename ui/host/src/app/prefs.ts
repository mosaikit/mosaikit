// Preferences of the frame: the top bar decided by the Administrator (from the session) and the sidebar
// at start chosen by the person (in the browser).

import type { Session, ShellBand } from '../types.ts'

/** The top bar decided by the Administrator; with a server that does not send it, everything on. */
export const BAND_ON: ShellBand = { logo: true, search: true, lang: true, help: true, mode: true }
export function bandOf(session: Session): ShellBand {
  return { ...BAND_ON, ...session.band }
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
