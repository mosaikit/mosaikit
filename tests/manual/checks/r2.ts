// Review round 2: dense overviews, app cards with charts, pinned headers, sidebar scrollbar, paging of every list
import * as H from '../h.ts'
import * as L from '../lib.ts'

/** The widgets of a page: [top, height] of each, in the grid. */
async function widgets(p: any): Promise<{ top: number; left: number; w: number; h: number }[]> {
  return p.evaluate(() =>
    [...document.querySelectorAll('main section[aria-labelledby], #main section[aria-labelledby]')].map((e) => {
      const r = e.getBoundingClientRect()
      return { top: Math.round(r.top + scrollY), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }
    }),
  )
}

/** Rows of widgets side by side must have the same height (no ragged bottoms). */
function rowsEqual(ws: { top: number; h: number }[]): boolean {
  const rows = new Map<number, number[]>()
  for (const w of ws) rows.set(w.top, [...(rows.get(w.top) ?? []), w.h])
  return [...rows.values()].every((hs) => Math.max(...hs) - Math.min(...hs) <= 2)
}

const checks: L.Check[] = [
  {
    id: 'R2-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.setViewportSize({ width: 1440, height: 900 })
      await H.go(p, '#/admin')
      await p.waitForTimeout(1500)
      const names = (await p.locator('section[aria-labelledby] h2').allInnerTexts()).map((s: string) => s.trim())
      for (const n of ['Tenants by storage used', 'Space by app', 'Requests', 'Recent errors']) c.ok(names.includes(n), `widget ${n} (${names.join(', ')})`)
      c.ok(await H.vis(p.getByRole('heading', { name: 'Apps, in every tenant' })), 'the heading of the app cards')
      c.ok(await H.vis(p.getByRole('heading', { name: 'Notes', exact: true })), 'a card for Notes')
      c.ok(rowsEqual(await widgets(p)), 'the widgets of a row have the same height at 1440 px')
      await p.setViewportSize({ width: 390, height: 844 })
      await p.waitForTimeout(500)
      const ws = await widgets(p)
      c.ok(ws.every((w) => w.left >= 0 && w.w <= 390), 'on the phone every widget fits the width')
      c.ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'no horizontal scroll on the phone')
      await p.setViewportSize({ width: 1440, height: 900 })
      return c.result()
    },
  },
  {
    id: 'R2-02',
    async run(ctx: any) {
      const c = H.checker()
      for (const who of ['e.ricci', 's.greco']) {
        const p = await L.as(ctx, who)
        await p.setViewportSize({ width: 1440, height: 900 })
        await H.go(p, '#/t/comune-roma')
        await p.waitForTimeout(1200)
        c.ok(rowsEqual(await widgets(p)), `${who}: the widgets of a row have the same height`)
        const ws = await widgets(p)
        const holes = ws.filter((w) => w.left > 0).length
        c.ok(ws.length >= 3 && holes >= 1, `${who}: the widgets sit side by side (${ws.length} widgets)`)
      }
      return c.result()
    },
  },
  {
    id: 'R2-03',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.setViewportSize({ width: 1440, height: 600 })
      await H.go(p, '#/admin/tenants')
      await p.evaluate(() => window.scrollTo(0, 300))
      await p.waitForTimeout(300)
      const top = await p.locator('.msk-page-header').first().evaluate((e: Element) => Math.round(e.getBoundingClientRect().top))
      c.ok(top === 50, `the header stays under the band after scrolling (top ${top})`)
      await H.go(p, '#/admin/plugins')
      await p.getByRole('link', { name: /Notes/ }).first().click()
      await p.waitForTimeout(900)
      await p.evaluate(() => window.scrollTo(0, 300))
      const tabs = await p.getByRole('navigation', { name: 'Tabs' }).evaluate((e: Element) => Math.round(e.getBoundingClientRect().top))
      c.ok(tabs > 90 && tabs < 140, `the tabs stay under the header (top ${tabs})`)
      await p.setViewportSize({ width: 1440, height: 900 })
      return c.result()
    },
  },
  {
    id: 'R2-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await p.setViewportSize({ width: 1440, height: 500 })
      await H.go(p, '#/t/comune-roma')
      const bar = p.locator('[data-sidebar="content"]').first()
      await p.mouse.move(700, 300)
      const away = await bar.evaluate((e: Element) => getComputedStyle(e).scrollbarColor)
      await bar.hover()
      const over = await bar.evaluate((e: Element) => getComputedStyle(e).scrollbarColor)
      c.ok(/transparent|rgba\(0, 0, 0, 0\)/.test(away.split(' ')[0] + away), `no scrollbar away from the sidebar (${away})`)
      c.ok(over !== away, `the scrollbar shows under the mouse (${over})`)
      await p.setViewportSize({ width: 1440, height: 900 })
      return c.result()
    },
  },
  {
    id: 'R2-05',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin')
      await p.getByText('Figures of the apps as tables').click()
      c.ok(await H.vis(p.getByRole('table').first()), 'the figures of the apps are also available as a table')
      c.note('lists of more than 50 rows page on the client (Sliced, vitest) or the server; see tests of kit.tsx')
      return c.result()
    },
  },
]

export default checks
