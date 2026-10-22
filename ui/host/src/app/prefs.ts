// Preferenze della cornice: la barra in alto decisa dall'Administrator (dalla sessione) e la sidebar
// all'avvio scelta dalla persona (nel browser).

import type { Session, ShellBand } from '../types.ts'

/** La barra in alto decisa dall'Administrator; con un server che non la manda, tutto acceso. */
export const BAND_ON: ShellBand = { logo: true, search: true, lang: true, help: true, mode: true }
export function bandOf(session: Session): ShellBand {
  return { ...BAND_ON, ...session.band }
}

/** La sidebar all'avvio: chiusa (a icone) o aperta, scelta in Account › Aspetto e lingua. */
export const SIDEBAR_PREF = 'msk_sidebar_open'
export function sidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_PREF) === '1'
  } catch {
    return false
  }
}
