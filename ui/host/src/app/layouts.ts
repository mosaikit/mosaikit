// Layouts and style of the shell (phase 10, docs/architecture.md): three independent levels decide how
// the shell looks. The theme gives the colours (theme.ts), the style the shapes, density, font, tabs,
// main buttons and the image under the band, the layout the arrangement of the slots. A layout is
// built in (Teams, Console) or comes from a layout plugin, which is declarative: an arrangement from the
// vocabulary of the shell, default style, a checked stylesheet (scoped under its class) and images.

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'
import type { Config, Session } from '../types.ts'
import type { Route } from './router.ts'
import { useTenantCtx } from './core.ts'
import { useTheme } from './theme.ts'

export type Pattern = 'rail' | 'sidebar' | 'drawer' | 'launcher' | 'areas' | 'tabs'

export interface LayoutDecl {
  pattern: Pattern
  band: { brand: boolean; breadcrumb: boolean; search: 'center' | 'wide'; tenant: 'band' | 'nav' }
  nav: { card: boolean }
  phone: { nav: 'drawer' | 'launcher' }
  style: Partial<StyleVars>
  band_image?: string | null
}

export interface LayoutInfo {
  id: string
  name: string
  description: string
  built_in: boolean
  decl: LayoutDecl
  /** class of the shell that scopes the stylesheet of the layout */
  class: string
  has_css: boolean
  band_image?: string | null
}

export interface LayoutsResponse {
  layouts: LayoutInfo[]
  /** the layouts tenants may choose (null: every one) */
  allowed: string[] | null
  /** the layout of the platform */
  platform: string
}

export interface StyleVars {
  radius: 'square' | 'medium' | 'round'
  density: 'compact' | 'comfortable'
  font: 'system' | 'humanist' | 'serif'
  tabs: 'underline' | 'pill' | 'boxed'
  buttons: 'filled' | 'outline' | 'soft'
}

export const STYLE_DEFAULTS: StyleVars = { radius: 'medium', density: 'comfortable', font: 'system', tabs: 'underline', buttons: 'filled' }
export const STYLE_OPTIONS: { [K in keyof StyleVars]: StyleVars[K][] } = {
  radius: ['square', 'medium', 'round'],
  density: ['compact', 'comfortable'],
  font: ['system', 'humanist', 'serif'],
  tabs: ['underline', 'pill', 'boxed'],
  buttons: ['filled', 'outline', 'soft'],
}
export const STYLE_KEYS = Object.keys(STYLE_DEFAULTS) as (keyof StyleVars)[]

/** The built-in Teams layout: the fallback while the list has not arrived or for older servers. */
export const TEAMS: LayoutInfo = {
  id: 'teams',
  name: 'Teams',
  description: '',
  built_in: true,
  class: 'mskl-teams',
  has_css: false,
  decl: { pattern: 'rail', band: { brand: true, breadcrumb: false, search: 'center', tenant: 'band' }, nav: { card: false }, phone: { nav: 'drawer' }, style: {} },
}

export function useLayouts() {
  return useQuery({ queryKey: ['layouts'], queryFn: () => api<LayoutsResponse>('GET', '/api/layouts'), staleTime: 60_000 })
}

/** The layout in use here: the tenant's (as the server resolves it) or the platform's for the Administrator. */
export function useLayoutInUse(session: Session, route: Route): LayoutInfo {
  const list = useLayouts().data
  const ctx = useTenantCtx(route.area === 'tenant' ? route.tenant : '')
  const id = route.area === 'tenant' ? ctx.data?.layout : session.user.is_system_admin ? list?.platform : undefined
  return list?.layouts.find((l) => l.id === id) ?? list?.layouts.find((l) => l.id === list.platform) ?? TEAMS
}

/** The style in use: the values set by the platform or the tenant, otherwise the defaults of the layout,
 *  otherwise the ones of the shell. */
export function styleOf(config: Config | undefined, layout: LayoutInfo): StyleVars {
  const out = { ...STYLE_DEFAULTS, ...layout.decl.style }
  for (const k of STYLE_KEYS) {
    const v = config?.[`style.${k}`]
    if (typeof v === 'string' && (STYLE_OPTIONS[k] as string[]).includes(v)) (out as Record<string, string>)[k] = v
  }
  return out
}

/** The image under the band: the one of the Style (platform or tenant) wins over the layout's. */
export function bandImageOf(config: Config | undefined, layout: LayoutInfo, slug?: string): string | null {
  const own = config?.['style.band_image'] as { v?: string } | null | undefined
  if (own && typeof own === 'object') return slug ? `api/auth/tenants/${encodeURIComponent(slug)}/logo/band?v=${own.v ?? ''}` : `brand/band?v=${own.v ?? ''}`
  if (layout.band_image) return `api/layouts/${encodeURIComponent(layout.id)}/images/${encodeURIComponent(layout.band_image)}`
  return null
}

let applied: StyleVars = STYLE_DEFAULTS

function setAttrs(style: StyleVars) {
  const html = document.documentElement
  for (const k of STYLE_KEYS) html.dataset[`style${k[0].toUpperCase()}${k.slice(1)}`] = style[k]
}

/** Applies the style to the page: `data-*` on <html> that the CSS of the shell reads. */
export function applyStyle(style: StyleVars, layout: LayoutInfo) {
  applied = style
  setAttrs(style)
  document.documentElement.dataset.layout = layout.id
}

/** The Style editor shows its changes on the whole page while they are not saved (a live preview)… */
export function previewStyle(changes: Partial<StyleVars>) {
  setAttrs({ ...applied, ...changes })
}

/** …and gives the page back its style when it closes or the changes go. */
export function endPreview() {
  setAttrs(applied)
}

/** The stylesheet of a layout plugin, in the head while the layout is in use. */
export function useLayoutStylesheet(layout: LayoutInfo) {
  useEffect(() => {
    if (!layout.has_css) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `api/layouts/${encodeURIComponent(layout.id)}/layout.css`
    link.dataset.layoutCss = layout.id
    document.head.appendChild(link)
    return () => link.remove()
  }, [layout.id, layout.has_css])
}

// ------------------------------------------------------------------ band image and contrast

type Rgb = [number, number, number]

export function hexRgb(v: string): Rgb | null {
  const h = v.trim().replace(/^#/, '')
  const full = h.length === 3 || h.length === 4 ? [...h.slice(0, 3)].map((c) => c + c).join('') : h.length >= 6 ? h.slice(0, 6) : ''
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lum([r, g, b]: Rgb): number {
  const lin = (x: number) => {
    const c = x / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function ratio(a: Rgb, b: Rgb): number {
  const [la, lb] = [lum(a), lum(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The cells the image is cut into (columns × rows) to find its brightest region: as in the kernel. */
export const GRID = [16, 4] as const
export const SCRIM_MIN = 0.3
export const SCRIM_MAX = 0.85

/** The mean colour of the brightest cell of RGBA pixels, composed on `ground`. */
export function brightest(rgba: Uint8ClampedArray | number[], width: number, height: number, ground: Rgb): Rgb {
  const [cols, rows] = GRID
  let best: Rgb = [0, 0, 0]
  let bestL = -1
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * width) / cols)
      const x1 = Math.min(width, Math.max(Math.floor(((cx + 1) * width) / cols), x0 + 1))
      const y0 = Math.floor((cy * height) / rows)
      const y1 = Math.min(height, Math.max(Math.floor(((cy + 1) * height) / rows), y0 + 1))
      const sum = [0, 0, 0]
      let n = 0
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4
          if (i + 3 >= rgba.length) continue
          const a = rgba[i + 3] / 255
          for (let c = 0; c < 3; c++) sum[c] += rgba[i + c] * a + ground[c] * (1 - a)
          n++
        }
      if (!n) continue
      const mean: Rgb = [sum[0] / n, sum[1] / n, sum[2] / n]
      const l = lum(mean)
      if (l > bestL) {
        bestL = l
        best = mean
      }
    }
  return best
}

/** The least scrim of the band colour over the brightest region that keeps the band texts at 4.5:1
 *  (null: not even at the maximum). */
export function scrimFor(cell: Rgb, colors: [Rgb, Rgb][]): number | null {
  for (let s = SCRIM_MIN; s <= SCRIM_MAX + 1e-9; s += 0.05) {
    const ok = colors.every(([band, fg]) => ratio([0, 1, 2].map((i) => band[i] * s + cell[i] * (1 - s)) as Rgb, fg) >= 4.5)
    if (ok) return Math.round(s * 100) / 100
  }
  return null
}

/** The band colours of the theme in use, from the CSS variables of the page. */
export function bandColors(): [Rgb, Rgb] {
  const cs = getComputedStyle(document.documentElement)
  const band = hexRgb(cs.getPropertyValue('--band')) ?? [0x44, 0x47, 0x91]
  const fg = hexRgb(cs.getPropertyValue('--band-foreground')) ?? [255, 255, 255]
  return [band, fg]
}

/** Loads an image and measures the scrim it needs with the band colours in use (null: unreadable). */
export async function measureScrim(src: string, colors: [Rgb, Rgb][] = [bandColors()]): Promise<number | null> {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  await img.decode()
  const w = Math.max(GRID[0], Math.min(256, img.naturalWidth))
  const h = Math.max(GRID[1], Math.min(64, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) return SCRIM_MAX
  g.drawImage(img, 0, 0, w, h)
  const data = g.getImageData(0, 0, w, h).data
  return scrimFor(brightest(data, w, h, colors[0][0]), colors)
}

/** The image under the band and its scrim: measured again whenever theme or image change (a layout or a
 *  theme chosen later may need more scrim than the one of the upload); the maximum if unreadable. */
export function useBandImage(src: string | null): { src: string | null; scrim: number } {
  const th = useTheme()
  const [scrim, setScrim] = useState(0.5)
  useEffect(() => {
    if (!src) return
    let live = true
    // after the variables of the theme are on the page
    const t = window.setTimeout(() => {
      measureScrim(src)
        .then((s) => live && setScrim(s ?? SCRIM_MAX))
        .catch(() => live && setScrim(SCRIM_MAX))
    }, 0)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [src, th.preset, th.mode, th.contrast])
  return useMemo(() => ({ src, scrim }), [src, scrim])
}
