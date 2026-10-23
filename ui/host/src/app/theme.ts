// Theme of the shell: preset (set of CSS variables in index.css) and mode (light, dark, automatic).
// The preset is not a personal choice: the Tenant Manager decides it for the tenant, or the Administrator
// for the platform (and for the tenants that do not choose one), and it comes from the server. The browser
// remembers the last one used only for the sign-in page. The mode is everyone's own; without a choice
// the default of the platform or of the tenant applies (Theme and mode).

import { useSyncExternalStore } from 'react'
import { themeCss } from './themegen.ts'

export type Mode = 'light' | 'dark' | 'auto'
export const PRESETS = [
  { id: 'mosaikit', name: 'Mosaikit', note: 'indigo and grey, the default colours' },
  { id: 'italia', name: 'Italia', note: 'Designers Italia, for public administration tenants' },
  { id: 'tessera', name: 'Tessera', note: 'the colours of the logo' },
] as const
export type PresetId = string

/** A theme made with the theme editor (System › Theme, Tenant settings › Theme). */
export interface CustomTheme {
  id: string
  name: string
  scope: 'platform' | 'tenant'
  input: unknown
  light: Record<string, string>
  dark: Record<string, string>
}

const KEY = 'msk_theme'
/** the mode chosen by the person (absent: the default of the place) */
const MODE_KEY = 'msk_mode'
interface Theme {
  preset: PresetId
  mode: Mode
  /** high contrast, for oneself (Account › Appearance and language, the palette of the top bar) */
  contrast: boolean
}

/** The custom themes known to this page, by id (their CSS is in a <style> of the head). */
const custom = new Map<string, CustomTheme>()
const known = (id: string) => PRESETS.some((p) => p.id === id) || custom.has(id)
/** the theme the server asked for, applied as soon as it is known */
let wanted: string | undefined

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
      contrast: t.contrast === true,
    }
  } catch {
    return { preset: 'mosaikit', mode: 'auto', contrast: false }
  }
}

const DEF_KEY = 'msk_theme_def'
let current = read()
try {
  const def = JSON.parse(localStorage.getItem(DEF_KEY) ?? 'null') as CustomTheme | null
  const last = (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Theme>).preset
  if (def?.id && def.id === last) {
    custom.set(def.id, def)
    current = { ...current, preset: def.id }
    const el = document.createElement('style')
    el.id = 'msk-custom-themes'
    el.textContent = themeCss(def.id, def)
    document.head.appendChild(el)
  }
} catch {
  /* storage not available */
}
const listeners = new Set<() => void>()
const media = window.matchMedia('(prefers-color-scheme: dark)')

/** Applies the theme to <html>: `data-preset` and class `dark`. */
export function applyTheme() {
  const dark = effectiveMode() === 'dark'
  document.documentElement.dataset.preset = current.preset
  if (current.contrast) document.documentElement.dataset.contrast = 'more'
  else delete document.documentElement.dataset.contrast
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
  wanted = id
  // a custom theme not registered yet: applied by registerThemes
  if (!known(id)) return
  if (id !== current.preset) update({ preset: id })
}

/** The custom themes (from the session, the tenant or the sign-in page): their CSS goes into the page
 *  and they can be applied like the built-in ones. */
export function registerThemes(list: CustomTheme[] | undefined) {
  if (!list?.length) return
  let changed = false
  for (const t of list) {
    const old = custom.get(t.id)
    if (!old || JSON.stringify(old) !== JSON.stringify(t)) {
      custom.set(t.id, t)
      changed = true
    }
  }
  if (!changed) return
  let el = document.getElementById('msk-custom-themes')
  if (!el) {
    el = document.createElement('style')
    el.id = 'msk-custom-themes'
    document.head.appendChild(el)
  }
  el.textContent = [...custom.values()].map((t) => themeCss(t.id, t)).join('\n')
  if (wanted && known(wanted) && wanted !== current.preset) update({ preset: wanted })
  else listeners.forEach((l) => l())
}

/** A custom theme known to the page. */
export function customTheme(id: string): CustomTheme | undefined {
  return custom.get(id)
}

/** High contrast, for oneself (saved with the person by the caller). */
export function setContrast(on: boolean) {
  if (on !== current.contrast) update({ contrast: on })
}

function update(t: Partial<Theme>) {
  current = { ...current, ...t }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
    // the colours of a custom theme too, so the next visit starts with them (no flash of another theme)
    const def = custom.get(current.preset)
    if (def) localStorage.setItem(DEF_KEY, JSON.stringify(def))
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
