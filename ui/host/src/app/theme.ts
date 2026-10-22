// Theme of the shell: preset (set of CSS variables in index.css) and mode (light, dark, automatic).
// The preset is not a personal choice: the Tenant Manager decides it for the tenant, or the Administrator
// for the platform (and for the tenants that do not choose one), and it comes from the server. The browser
// remembers the last one used only for the sign-in page. The mode is everyone's own; without a choice
// the default of the platform or of the tenant applies (Theme and mode).

import { useSyncExternalStore } from 'react'

export type Mode = 'light' | 'dark' | 'auto'
export const PRESETS = [
  { id: 'mosaikit', name: 'Mosaikit', note: 'the colours of Microsoft Teams' },
  { id: 'italia', name: 'Italia', note: 'Designers Italia, for public administration tenants' },
  { id: 'tessera', name: 'Tessera', note: 'the colours of the logo' },
] as const
export type PresetId = (typeof PRESETS)[number]['id']

const KEY = 'msk_theme'
/** the mode chosen by the person (absent: the default of the place) */
const MODE_KEY = 'msk_mode'
interface Theme {
  preset: PresetId
  mode: Mode
}

function chosenMode(): Mode | null {
  try {
    const m = localStorage.getItem(MODE_KEY)
    if (m === 'light' || m === 'dark' || m === 'auto') return m
    // before: the mode was saved with the preset
    const old = (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Theme>).mode
    return old === 'light' || old === 'dark' ? old : null
  } catch {
    return null
  }
}

function read(): Theme {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Theme>
    return {
      preset: PRESETS.some((p) => p.id === t.preset) ? (t.preset as PresetId) : 'mosaikit',
      mode: chosenMode() ?? 'auto',
    }
  } catch {
    return { preset: 'mosaikit', mode: 'auto' }
  }
}

let current = read()
const listeners = new Set<() => void>()
const media = window.matchMedia('(prefers-color-scheme: dark)')

/** Applies the theme to <html>: `data-preset` and class `dark`. */
export function applyTheme() {
  const dark = effectiveMode() === 'dark'
  document.documentElement.dataset.preset = current.preset
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

/** The mode in use: with `auto` the one of the system. */
export function effectiveMode(t: Theme = current): 'light' | 'dark' {
  return t.mode === 'dark' || (t.mode === 'auto' && media.matches) ? 'dark' : 'light'
}

/** The mode chosen by the person. */
export function setTheme(t: Partial<Pick<Theme, 'mode'>>) {
  if (t.mode)
    try {
      localStorage.setItem(MODE_KEY, t.mode)
    } catch {
      /* storage not available */
    }
  update(t)
}

/** The default mode of the platform or of the tenant, for whoever did not choose one. */
export function setDefaultMode(m: string | undefined) {
  if (chosenMode() || (m !== 'light' && m !== 'dark' && m !== 'auto') || m === current.mode) return
  update({ mode: m })
}

/** The preset in use, from what the server says (tenant or platform); unknown: the base one. */
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
    /* storage not available */
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
