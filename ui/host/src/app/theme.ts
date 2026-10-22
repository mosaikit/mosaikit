// Tema della shell: preset (insieme di variabili CSS in index.css) e modo (chiaro, scuro, automatico).
// Il preset non e' una scelta personale: lo decide il Tenant Manager per il tenant, o l'Administrator
// per la piattaforma (e per i tenant che non ne scelgono uno), e arriva dal server. Il browser ricorda
// l'ultimo usato solo per la pagina di accesso. Il modo e' di ciascuno.

import { useSyncExternalStore } from 'react'

export type Mode = 'light' | 'dark' | 'auto'
export const PRESETS = [
  { id: 'mosaikit', name: 'Mosaikit', note: 'i colori di Microsoft Teams' },
  { id: 'italia', name: 'Italia', note: 'Designers Italia, per i tenant della PA' },
  { id: 'tessera', name: 'Tessera', note: 'i colori del logo' },
] as const
export type PresetId = (typeof PRESETS)[number]['id']

const KEY = 'msk_theme'
interface Theme {
  preset: PresetId
  mode: Mode
}

function read(): Theme {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Theme>
    return {
      preset: PRESETS.some((p) => p.id === t.preset) ? (t.preset as PresetId) : 'mosaikit',
      mode: t.mode === 'light' || t.mode === 'dark' ? t.mode : 'auto',
    }
  } catch {
    return { preset: 'mosaikit', mode: 'auto' }
  }
}

let current = read()
const listeners = new Set<() => void>()
const media = window.matchMedia('(prefers-color-scheme: dark)')

/** Applica il tema a <html>: `data-preset` e classe `dark`. */
export function applyTheme() {
  const dark = effectiveMode() === 'dark'
  document.documentElement.dataset.preset = current.preset
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

/** Il modo in uso: con `auto` quello del sistema. */
export function effectiveMode(t: Theme = current): 'light' | 'dark' {
  return t.mode === 'dark' || (t.mode === 'auto' && media.matches) ? 'dark' : 'light'
}

/** Il modo scelto dalla persona. */
export function setTheme(t: Partial<Pick<Theme, 'mode'>>) {
  update(t)
}

/** Il preset in uso, da quello che dice il server (tenant o piattaforma); sconosciuto: quello di base. */
export function setPreset(id: string | undefined) {
  if (!id) return
  const preset: PresetId = PRESETS.some((p) => p.id === id) ? (id as PresetId) : 'mosaikit'
  if (preset !== current.preset) update({ preset })
}

function update(t: Partial<Theme>) {
  current = { ...current, ...t }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* storage non disponibile */
  }
  applyTheme()
  listeners.forEach((l) => l())
}

media.addEventListener('change', () => {
  if (current.mode === 'auto') {
    applyTheme()
    listeners.forEach((l) => l())
  }
})

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
