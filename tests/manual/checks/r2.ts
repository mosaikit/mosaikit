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
      for (const [w, h] of [[1440, 700], [390, 800]]) {
        await p.setViewportSize({ width: w, height: h })
        for (const hash of ['#/admin/tenants', '#/admin/people', '#/admin/log', '#/admin/plugins']) {
          await H.go(p, hash)
          await p.waitForTimeout(900)
          const m = await p.evaluate(() => {
            const ls = document.querySelector('[data-listscroll]')
            const th = document.querySelector('thead th')
            return { over: document.documentElement.scrollHeight - innerHeight, list: !!ls, sticky: th ? getComputedStyle(th).position : 'sticky' }
          })
          c.ok(m.list && m.over <= 1, `${hash} at ${w}px: the page does not scroll, the list does (page overflow ${m.over})`)
          c.ok(m.sticky === 'sticky', `${hash} at ${w}px: the header row of the table is pinned`)
        }
      }
      await H.go(p, '#/admin')
      c.ok(await p.evaluate(() => !document.querySelector('[data-listscroll]')), 'the overview is not list-first: the page scrolls')
      await p.setViewportSize({ width: 1440, height: 900 })
      return c.result()
    },
  },
  {
    id: 'R2-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.setViewportSize({ width: 1440, height: 330 })
      await H.go(p, '#/admin')
      const bar = p.locator('[data-sidebar="content"]').first()
      const m = await bar.evaluate((e: Element) => ({ over: e.scrollHeight > e.clientHeight, ov: getComputedStyle(e).overflowY }))
      c.ok(m.ov === 'auto' && m.over, `the sidebar overflows and can scroll (${m.ov})`)
      await p.mouse.move(800, 200)
      const away = await bar.evaluate((e: Element) => getComputedStyle(e).scrollbarColor)
      await bar.hover()
      const over = await bar.evaluate((e: Element) => getComputedStyle(e).scrollbarColor)
      c.ok(/transparent|rgba\(0, 0, 0, 0\)/.test(away), `no scrollbar away from the sidebar (${away})`)
      c.ok(over !== away, `the scrollbar shows under the mouse (${over})`)
      await p.mouse.wheel(0, 200)
      await p.waitForTimeout(300)
      c.ok((await bar.evaluate((e: Element) => e.scrollTop)) > 0, 'the wheel scrolls the sidebar')
      await p.setViewportSize({ width: 1440, height: 900 })
      return c.result()
    },
  },
  {
    id: 'R2-05',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await p.setViewportSize({ width: 1440, height: 700 })
      await H.go(p, '#/t/comune-roma/manage')
      const host = await p.locator('.msk-page-header').first().evaluate((e: Element) => {
        const r = e.getBoundingClientRect()
        return { h: Math.round(r.height), border: getComputedStyle(e).borderBottomWidth, h1: getComputedStyle(e.querySelector('h1')!).fontSize }
      })
      for (const id of ['com.mosaikit.notes', 'com.mosaikit.maps', 'com.mosaikit.static-site', 'com.mosaikit.files']) {
        await H.go(p, `#/t/comune-roma/p/${id}`)
        const f = await L.pluginFrame(p)
        await f.locator('.msk-pagehead').waitFor({ timeout: 15000 })
        const m = await f.evaluate(() => {
          const e = document.querySelector('.msk-pagehead')!
          return { h: Math.round(e.getBoundingClientRect().height), border: getComputedStyle(e).borderBottomWidth, h1: getComputedStyle(e.querySelector('h1')!).fontSize, over: document.documentElement.scrollHeight - innerHeight }
        })
        c.ok(Math.abs(m.h - host.h) <= 1 && m.border === host.border && m.h1 === host.h1, `${id}: the header looks like the one of Mosaikit (${JSON.stringify(m)} vs ${JSON.stringify(host)})`)
        c.ok(m.over <= 1, `${id}: the page does not scroll`)
      }
      return c.result()
    },
  },
  {
    id: 'R2-06',
    async run(ctx: any) {
      const c = H.checker()
      const adm = await L.as(ctx, 'admin')
      const mgr = await L.as(ctx, 'e.ricci')
      const pages: [any, string, string][] = [
        [adm, '#/admin/system', 'System'],
        [adm, '#/admin/monitoring', 'Monitoring'],
        [mgr, '#/t/comune-roma/settings', 'Settings'],
        [mgr, '#/t/comune-roma/usage', 'Usage'],
        [mgr, '#/t/comune-roma/account', 'Account'],
      ]
      for (const [w, h] of [[1440, 800], [390, 800]]) {
        for (const [p, hash, name] of pages) {
          await p.setViewportSize({ width: w, height: h })
          await H.go(p, hash)
          await p.waitForTimeout(700)
          const sec = p.getByTestId('header-section')
          c.ok(await H.vis(sec), `${name} at ${w}px: the header shows the subsection`)
          const text = ((await sec.first().innerText().catch(() => '')) as string).trim()
          c.ok(text.length > 0, `${name} at ${w}px: the subsection is written (${text})`)
          if (w > 760) {
            const cur = ((await p.getByRole('navigation', { name: 'Sections' }).locator('[aria-current="page"]').first().innerText().catch(() => '')) as string).trim()
            c.ok(cur.startsWith(text), `${name}: the header (${text}) agrees with the list at the left (${cur})`)
          }
          c.ok(await H.vis(p.getByRole('heading', { name, level: 1 })), `${name}: the page title stays`)
        }
      }
      return c.result()
    },
  },
  {
    id: 'R2-07',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      for (const [w, h] of [[1440, 800], [390, 800]]) {
        await p.setViewportSize({ width: w, height: h })
        for (const tab of ['identity', 'theme', 'layout', 'style', 'languages', 'topbar']) {
          await H.go(p, `#/admin/system/${tab}`)
          await p.waitForTimeout(600)
          const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)
          c.ok(over <= 1, `${tab} at ${w}px: nothing sideways (${over})`)
        }
      }
      await p.setViewportSize({ width: 1280, height: 800 })
      await H.go(p, '#/admin/system/layout')
      await p.locator('[data-layout-card="console"]').click()
      await p.getByRole('button', { name: 'Save' }).click()
      await p.locator('.msk-shell[data-layout="console"]').waitFor({ state: 'attached', timeout: 10000 })
      await p.locator('[data-layout-card="teams"]').click()
      await p.getByRole('button', { name: 'Save' }).click()
      await p.locator('.msk-shell[data-layout="teams"]').waitFor({ state: 'attached', timeout: 10000 })
      c.note('the layout was applied without a reload (also in tests/e2e/specs/14-layout-apply.spec.ts)')
      return c.result()
    },
  },
  {
    id: 'R2-08',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.setViewportSize({ width: 1280, height: 360 })
      await H.go(p, '#/admin/system')
      await p.evaluate(() => window.scrollTo(0, 300))
      const side = p.getByRole('navigation', { name: 'Sections' })
      const box = await side.evaluate((e: Element) => ({ top: Math.round(e.getBoundingClientRect().top), over: e.scrollHeight > e.clientHeight, ov: getComputedStyle(e).overflowY }))
      c.ok(box.top < 140 && box.ov === 'auto' && box.over, `the list of sections stays in place and scrolls by itself (${JSON.stringify(box)})`)
      await side.hover()
      await p.mouse.wheel(0, 150)
      await p.waitForTimeout(300)
      c.ok((await side.evaluate((e: Element) => e.scrollTop)) > 0, 'the wheel scrolls the list of sections')
      await p.setViewportSize({ width: 1440, height: 900 })
      return c.result()
    },
  },
  {
    id: 'R2-09',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      for (const [w, h] of [[2000, 1194], [390, 800]]) {
        await p.setViewportSize({ width: w, height: h })
        for (const page of ['log', 'manage', 'trash', 'shares', 'plugins']) {
          await H.go(p, `#/t/comune-roma/${page}`)
          await p.waitForTimeout(900)
          const m = await p.evaluate(() => {
            const head = document.querySelector('.msk-page-header')!.getBoundingClientRect()
            const bad: string[] = []
            for (const e of document.querySelectorAll('[data-listscroll] .msk-pills, aside.msk-facets')) {
              const r = e.getBoundingClientRect()
              if (r.top < head.bottom - 1 || r.bottom > innerHeight + 1) bad.push(Math.round(r.top) + '-' + Math.round(r.bottom))
            }
            return { headTop: Math.round(head.top), over: document.documentElement.scrollHeight - innerHeight, list: !!document.querySelector('[data-listscroll]'), bad }
          })
          c.ok(m.list && m.headTop === 50 && m.over <= 1 && m.bad.length === 0, `${page} at ${w}px: ${JSON.stringify(m)}`)
        }
      }
      await p.setViewportSize({ width: 1440, height: 900 })
      return c.result()
    },
  },
]

export default checks
