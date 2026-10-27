import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PluginView, Session, TenantContext } from '../types.ts'
import { bandImageOf, brightest, ratio, SCRIM_MAX, SCRIM_MIN, scrimFor, styleOf, TEAMS, type LayoutInfo, type Pattern } from './layouts.ts'
import { appChildren } from './nav.tsx'
import Frame from './frames.tsx'
import Shell from './Shell.tsx'

const layout = (id: string, pattern: Pattern, extra: Partial<LayoutInfo['decl']> = {}): LayoutInfo => ({
  ...TEAMS,
  id,
  name: id,
  class: `mskl-${id}`,
  decl: { ...TEAMS.decl, pattern, ...extra },
})

describe('band image', () => {
  it('a brighter image needs more scrim, a dark one the least', () => {
    const band: [number, number, number] = [0x44, 0x47, 0x91]
    const white = new Array(32 * 8 * 4).fill(255)
    const dark = Array.from({ length: 32 * 8 }, () => [30, 30, 30, 255]).flat()
    const sWhite = scrimFor(brightest(white, 32, 8, [0, 0, 0]), [[band, [255, 255, 255]]])!
    const sDark = scrimFor(brightest(dark, 32, 8, [0, 0, 0]), [[band, [255, 255, 255]]])!
    expect(sDark).toBe(SCRIM_MIN)
    expect(sWhite).toBeGreaterThan(sDark)
    expect(sWhite).toBeLessThanOrEqual(SCRIM_MAX)
    // the scrim found really gives 4.5:1
    const mix = band.map((c) => c * sWhite + 255 * (1 - sWhite)) as [number, number, number]
    expect(ratio(mix, [255, 255, 255])).toBeGreaterThanOrEqual(4.5)
  })

  it('a pale band never reads over a white image', () => {
    const white = new Array(32 * 8 * 4).fill(255)
    expect(scrimFor(brightest(white, 32, 8, [0, 0, 0]), [[[0xdd, 0xdd, 0xdd], [255, 255, 255]]])).toBeNull()
  })

  it('the brightest cell is found, transparency shows the band', () => {
    const rgba = Array.from({ length: 32 * 8 }, (_, i) => (i % 32 < 2 && i < 64 ? [255, 255, 255, 255] : [0, 0, 0, 0])).flat()
    expect(brightest(rgba, 32, 8, [10, 20, 30])).toEqual([255, 255, 255])
    expect(brightest(new Array(16 * 4 * 4).fill(0), 16, 4, [10, 20, 30])).toEqual([10, 20, 30])
  })

  it('the image of the Style wins over the layout’s', () => {
    const l = { ...layout('x', 'tabs'), band_image: 'band.png' }
    expect(bandImageOf({}, l)).toBe('api/layouts/x/images/band.png')
    expect(bandImageOf({ 'style.band_image': { v: 'ab' } }, l)).toBe('brand/band?v=ab')
    expect(bandImageOf({ 'style.band_image': { v: 'ab' } }, l, 'rome')).toBe('api/auth/tenants/rome/logo/band?v=ab')
    expect(bandImageOf({}, TEAMS)).toBeNull()
  })
})

describe('style', () => {
  it('the settings win over the layout, the layout over the defaults', () => {
    const l = layout('x', 'drawer', { style: { radius: 'round', tabs: 'pill' } })
    expect(styleOf({}, l)).toEqual({ radius: 'round', density: 'comfortable', font: 'system', tabs: 'pill', buttons: 'filled' })
    expect(styleOf({ 'style.radius': 'square', 'style.font': 'serif', 'style.tabs': null }, l)).toMatchObject({ radius: 'square', font: 'serif', tabs: 'pill' })
    expect(styleOf({ 'style.radius': 'huge' }, l).radius).toBe('round')
  })
})

describe('navigation tree', () => {
  it('the pages of an app from its manifest, the active one from the place', () => {
    const p = {
      id: 'com.mosaikit.notes',
      nav: [
        { id: 'all', label: 'All notes' },
        { id: 'tags', label: 'By tag' },
        { id: 'work', label: 'Work', parent: 'tags', place: 'tag-work' },
      ],
    } as unknown as PluginView
    const kids = appChildren('rome', p, { area: 'tenant', tenant: 'rome', page: 'plugin', id: p.id, section: 'tag-work' })!
    expect(kids.map((k) => k.label)).toEqual(['All notes', 'By tag'])
    expect(kids[0].href).toBe('#/t/rome/p/com.mosaikit.notes/all')
    expect(kids[1].href).toBeUndefined()
    expect(kids[1].children![0]).toMatchObject({ label: 'Work', href: '#/t/rome/p/com.mosaikit.notes/tag-work', active: true })
    expect(appChildren('rome', { ...p, nav: [] }, { area: 'tenant', tenant: 'rome', page: 'home' })).toBeUndefined()
  })
})

const session = {
  user: { user_id: 'u', username: 'anna', display_name: 'Anna', is_system_admin: false, home_tenant_slug: 'rome' },
  csrf: 'x',
  memberships: [{ slug: 'rome', name: 'Rome', role: 'tenant_manager', is_home: true }],
  invitations: 0,
  plugin_origin: 'http://127.0.0.1:1',
  public_origin: 'http://127.0.0.1:1',
  dev: false,
} as unknown as Session

const ctx = {
  tenant: { id: 't', slug: 'rome', name: 'Rome', role: 'tenant_manager', settings: {} },
  plugins: [{ id: 'com.mosaikit.notes', label: 'Notes', kind: 'app', has_ui: true, nav: [{ id: 'all', label: 'All notes' }] }],
  prefs: {},
  config: {},
} as unknown as TenantContext

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// no server here: the calls of the shell (brand, notifications…) never answer
vi.stubGlobal('fetch', () => new Promise(() => {}))

/** Renders in the page (happy-dom) and gives back the HTML. */
async function render(node: React.ReactNode): Promise<string> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  qc.setQueryData(['ctx', 'rome'], ctx)
  const box = document.createElement('div')
  document.body.appendChild(box)
  const root = createRoot(box)
  await act(async () => root.render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>))
  const html = document.body.innerHTML
  act(() => root.unmount())
  box.remove()
  return html
}

describe('every layout draws the same slots', () => {
  const route = { area: 'tenant', tenant: 'rome', page: 'home' } as const
  const band = { logo: true, search: true, lang: true, help: true, mode: true }
  const cases: [string, LayoutInfo][] = [
    ['console', layout('console', 'sidebar', { band: { brand: true, breadcrumb: true, search: 'center', tenant: 'nav' }, nav: { card: true } })],
    ['workspace', layout('workspace', 'drawer', { band: { brand: true, breadcrumb: false, search: 'wide', tenant: 'band' } })],
    ['suite', layout('suite', 'launcher', { phone: { nav: 'launcher' } })],
    ['project', layout('project', 'areas')],
    ['tabs', layout('tabs', 'tabs')],
  ]
  for (const [name, l] of cases)
    it(`${name}: skip link, band, navigation, content`, async () => {
      const html = await render(
        <Frame session={session} route={route} band={band} layout={l} bandImage={{ src: null, scrim: 0.5 }}>
          <p>content</p>
        </Frame>,
      )
      expect(html.indexOf('skip-link')).toBeGreaterThan(-1)
      expect(html.indexOf('skip-link')).toBeLessThan(html.indexOf('<header'))
      expect(html).toContain('msk-band')
      expect(html).toMatch(/<nav[^>]*msk-nav/)
      expect(html).toMatch(/<main[^>]*id="main"/)
      // every layout shows the start; the apps are in the navigation, or in the area or the launcher
      expect(html).toContain('Tenant overview')
      if (name !== 'suite' && name !== 'project') expect(html).toContain('Notes')
      else expect(html).toContain(name === 'project' ? 'Apps' : 'All apps and pages')
      expect(html).toContain('content')
    })

  it('teams: the rail of the built-in layout', async () => {
    const html = await render(
      <Shell session={session} route={route}>
        <p>content</p>
      </Shell>,
    )
    expect(html).toContain('skip-link')
    expect(html).toContain('data-layout="teams"')
    expect(html).toContain('id="main"')
    expect(html).toContain('Notes')
  })
})
