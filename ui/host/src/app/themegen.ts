// The theme editor's generator, as in the mockup (docs/mockup, makePreset): from three choices — main
// colour, style of the top band, greys — the CSS variables of a theme, light and dark, plus the contrast
// checks (WCAG 2.1 AA) and "Fix it for me". The kernel checks the same pairs again when saving
// (crates/kernel/src/tenancy/themes.rs, CHECKS).

export type Bar = 'color' | 'dark' | 'light'
export type Grays = 'neutral' | 'warm' | 'cool'
export interface ThemeChoices {
  accent: string
  bar: Bar
  grays: Grays
  /** colours set by hand or by "Fix it for me" */
  adv?: { barL?: string; barD?: string; accL?: string; accD?: string }
}
export type Vars = Record<string, string>

interface GrayRow {
  side: string
  pane: string
  content: string
  text: string
  text2: string
  text3: string
  hover: string
  line: string
}
export const GRAYS: Record<Grays, { l: GrayRow; d: GrayRow }> = {
  neutral: {
    l: { side: '#ebebeb', pane: '#f5f5f5', content: '#ffffff', text: '#242424', text2: '#424242', text3: '#616161', hover: '#e0e0e0', line: '#e0e0e0' },
    d: { side: '#141414', pane: '#242424', content: '#1f1f1f', text: '#f0f0f0', text2: '#d1d1d1', text3: '#adadad', hover: '#2b2b2b', line: '#2b2b2b' },
  },
  warm: {
    l: { side: '#efebe6', pane: '#f7f4f0', content: '#fffdfa', text: '#2a2420', text2: '#4a413a', text3: '#6b6058', hover: '#e5dfd8', line: '#e5dfd8' },
    d: { side: '#17130f', pane: '#26211c', content: '#1f1a16', text: '#f2ece6', text2: '#d6cdc4', text3: '#ada39a', hover: '#2e2822', line: '#2e2822' },
  },
  cool: {
    l: { side: '#e8edf2', pane: '#f3f6f9', content: '#ffffff', text: '#1d2733', text2: '#3a4756', text3: '#5c6b7c', hover: '#dbe3eb', line: '#dbe3eb' },
    d: { side: '#11161c', pane: '#1f2630', content: '#1a2027', text: '#e8eef5', text2: '#c6d0db', text3: '#9aa7b6', hover: '#26303b', line: '#26303b' },
  },
}

export function hexRgb(h: string): [number, number, number] {
  let x = h.replace('#', '')
  if (x.length === 3 || x.length === 4)
    x = x
      .slice(0, 3)
      .split('')
      .map((c) => c + c)
      .join('')
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as [number, number, number]
}
function rgbHex(c: number[]): string {
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}
export function isHex(h: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h.trim())
}
export function mix(a: string, b: string, t: number): string {
  const x = hexRgb(a),
    y = hexRgb(b)
  return rgbHex(x.map((v, i) => v + (y[i] - v) * t))
}
export function lum(h: string): number {
  return hexRgb(h)
    .map((v) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
}
/** Contrast ratio (WCAG) of two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const x = lum(a),
    y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
function onColor(bg: string): string {
  return contrast('#ffffff', bg) >= 4.5 ? '#ffffff' : '#141414'
}

/** The variables of the top band on a background `bg`. */
function band(bg: string, dark: boolean): Vars {
  if (contrast('#242424', bg) > contrast('#ffffff', bg))
    return {
      '--band': bg,
      '--band-foreground': '#242424',
      '--band-muted': '#424242',
      '--band-hover': 'rgba(0,0,0,0.06)',
      '--band-line': 'rgba(0,0,0,0.12)',
      '--search': '#f0f0f0',
      '--search-foreground': '#565656',
    }
  return {
    '--band': bg,
    '--band-foreground': '#ffffff',
    '--band-muted': mix('#ffffff', bg, 0.12),
    '--band-hover': 'rgba(255,255,255,0.16)',
    '--band-line': 'rgba(255,255,255,0.18)',
    '--search': dark ? mix(bg, '#ffffff', 0.14) : mix(bg, '#ffffff', 0.9),
    '--search-foreground': dark ? mix('#ffffff', bg, 0.2) : mix(bg, '#000000', 0.25),
  }
}

/** The CSS variables of a theme, light and dark. */
export function generate(o: ThemeChoices): { light: Vars; dark: Vars } {
  const G = GRAYS[o.grays] ?? GRAYS.neutral
  const adv = o.adv ?? {}
  const acc = adv.accL || o.accent
  const accD = adv.accD || mix(o.accent, '#ffffff', 0.38)
  const barL = adv.barL || { color: mix(acc, '#000000', 0.15), dark: mix(G.d.side, acc, 0.12), light: '#ffffff' }[o.bar]
  const barD = adv.barD || { color: mix(o.accent, '#000000', 0.55), dark: mix(G.d.side, o.accent, 0.08), light: '#2b2b2b' }[o.bar]
  const l = G.l,
    d = G.d
  const light: Vars = {
    '--background': l.content,
    '--foreground': l.text,
    '--card': l.content,
    '--card-foreground': l.text,
    '--popover': l.content,
    '--popover-foreground': l.text,
    '--primary': acc,
    '--primary-foreground': onColor(acc),
    '--primary-strong': mix(acc, '#000000', 0.12),
    '--secondary': l.pane,
    '--secondary-foreground': l.text,
    '--muted': l.pane,
    '--muted-foreground': l.text3,
    '--accent': l.hover,
    '--accent-foreground': l.text,
    '--destructive': '#c4314b',
    '--border': l.line,
    '--input': mix(l.line, '#000000', 0.08),
    '--ring': acc,
    '--ok': '#107c10',
    '--warn': '#8a5600',
    '--pane': l.pane,
    ...band(barL, false),
    '--sidebar': l.side,
    '--sidebar-foreground': l.text2,
    '--sidebar-primary': acc,
    '--sidebar-primary-foreground': onColor(acc),
    '--sidebar-accent': '#ffffff',
    '--sidebar-accent-foreground': acc,
    '--sidebar-border': l.line,
    '--sidebar-ring': acc,
    '--sidebar-hover': l.hover,
    '--rail-foreground': l.text3,
  }
  const dark: Vars = {
    '--background': d.content,
    '--foreground': d.text,
    '--card': d.pane,
    '--card-foreground': d.text,
    '--popover': d.pane,
    '--popover-foreground': d.text,
    '--primary': accD,
    '--primary-foreground': onColor(accD),
    '--primary-strong': accD,
    '--secondary': d.hover,
    '--secondary-foreground': d.text,
    '--muted': d.hover,
    '--muted-foreground': d.text3,
    '--accent': mix(d.hover, '#ffffff', 0.04),
    '--accent-foreground': d.text,
    '--destructive': '#f1707b',
    '--border': d.line,
    '--input': mix(d.line, '#ffffff', 0.1),
    '--ring': accD,
    '--ok': '#54b054',
    '--warn': '#e3a634',
    '--pane': d.pane,
    ...band(barD, true),
    '--sidebar': d.side,
    '--sidebar-foreground': d.text2,
    '--sidebar-primary': accD,
    '--sidebar-primary-foreground': onColor(accD),
    '--sidebar-accent': d.hover,
    '--sidebar-accent-foreground': accD,
    '--sidebar-border': d.line,
    '--sidebar-ring': accD,
    '--sidebar-hover': d.hover,
    '--rail-foreground': d.text3,
  }
  return { light, dark }
}

/** The pairs that must read (text, background): the same list as the kernel. */
export const CHECKS: [string, string, string][] = [
  ['--foreground', '--background', 'Text on the page'],
  ['--muted-foreground', '--background', 'Secondary text on the page'],
  ['--primary', '--background', 'Links and active items on the page'],
  ['--primary-foreground', '--primary', 'Main button'],
  ['--band-foreground', '--band', 'Text on the top band'],
  ['--band-muted', '--band', 'Secondary text on the top band'],
  ['--search-foreground', '--search', 'Search field'],
  ['--sidebar-foreground', '--sidebar', 'Text of the sidebar'],
  ['--sidebar-accent-foreground', '--sidebar-accent', 'Active item in the sidebar'],
  ['--rail-foreground', '--sidebar', 'Labels of the icon bar'],
]

export interface Check {
  label: string
  mode: 'light' | 'dark'
  fg: string
  bg: string
  ratio: number
  ok: boolean
}

/** The main button under the pointer: 12 % darker in light mode, 12 % lighter in dark mode (the hover
 *  of components/ui/button.tsx). */
export function primaryHover(primary: string, mode: 'light' | 'dark'): string {
  return mix(primary, mode === 'dark' ? '#ffffff' : '#000000', 0.12)
}

/** Every check of a theme, light and dark (AA: 4.5), the main button under the pointer included. */
export function checks(t: { light: Vars; dark: Vars }): Check[] {
  const out: Check[] = []
  for (const mode of ['light', 'dark'] as const) {
    for (const [fg, bg, label] of CHECKS) {
      const a = t[mode][fg],
        b = t[mode][bg]
      if (!a || !b || !isHex(a) || !isHex(b)) continue
      const ratio = contrast(a, b)
      out.push({ label, mode, fg, bg, ratio: Math.round(ratio * 100) / 100, ok: ratio >= 4.5 })
    }
    const p = t[mode]['--primary'],
      pf = t[mode]['--primary-foreground']
    if (p && pf && isHex(p) && isHex(pf)) {
      const ratio = contrast(pf, primaryHover(p, mode))
      out.push({ label: 'Main button under the pointer', mode, fg: '--primary-foreground', bg: '--primary', ratio: Math.round(ratio * 100) / 100, ok: ratio >= 4.5 })
    }
  }
  return out
}

/** "Fix it for me": darker colours in light mode, lighter in dark mode, until every check passes
 *  (at most 40 rounds); the greys are never changed. */
export function fix(o: ThemeChoices): ThemeChoices {
  let cur: ThemeChoices = { ...o, adv: { ...o.adv } }
  for (let i = 0; i < 40; i++) {
    const t = generate(cur)
    const bad = checks(t).filter((c) => !c.ok)
    if (!bad.length) break
    const adv = { ...cur.adv }
    for (const c of bad) {
      const v = t[c.mode]
      if (c.fg.startsWith('--band') || c.fg.startsWith('--search')) {
        const key = c.mode === 'dark' ? 'barD' : 'barL'
        adv[key] = mix(v['--band'], c.mode === 'dark' || lum(v['--band']) < 0.45 ? '#000000' : '#ffffff', 0.1)
      } else if (c.fg.includes('primary') || c.fg.includes('accent')) {
        if (c.mode === 'dark') adv.accD = mix(v['--primary'], '#ffffff', 0.1)
        else adv.accL = mix(v['--primary'], '#000000', 0.08)
      }
    }
    cur = { ...cur, adv }
  }
  return cur
}

/** The CSS of a theme for `data-preset=<id>` (light) and `.dark[data-preset=<id>]`. Values are checked
 *  (colours only) so a theme cannot inject other CSS. */
export function themeCss(id: string, t: { light: Vars; dark: Vars }): string {
  const safe = (v: string) => /^(#[0-9a-f]{3,8}|rgba?\([0-9.,\s%]+\))$/i.test(v.trim())
  const block = (vars: Vars) =>
    Object.entries(vars)
      .filter(([k, v]) => /^--[a-z0-9-]+$/.test(k) && safe(v))
      .map(([k, v]) => `${k}:${v};`)
      .join('')
  const sel = id.replace(/[^a-z0-9-]/g, '')
  return `[data-preset='${sel}']{${block(t.light)}}.dark[data-preset='${sel}']{${block(t.dark)}}`
}

export const DEFAULT_CHOICES: ThemeChoices = { accent: '#0f6e5c', bar: 'color', grays: 'neutral' }

/** The choices saved with a theme, or the defaults. */
export function choicesOf(input: unknown): ThemeChoices {
  const o = (input ?? {}) as Partial<ThemeChoices>
  return {
    accent: typeof o.accent === 'string' && isHex(o.accent) ? o.accent : DEFAULT_CHOICES.accent,
    bar: o.bar === 'dark' || o.bar === 'light' ? o.bar : 'color',
    grays: o.grays === 'warm' || o.grays === 'cool' ? o.grays : 'neutral',
    adv: o.adv && typeof o.adv === 'object' ? o.adv : undefined,
  }
}

