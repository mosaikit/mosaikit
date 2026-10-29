// Tables: one pattern for every list (fixed header row, only the rows scroll with the scrollbar under the header row, a
// full-text filter, sortable titles, rows that load as the end of the list comes into view), and the two views of the
// installed plugins (cards, table).
import * as H from '../h.ts'
import * as L from '../lib.ts'

/** What a table of the page looks like: the header row, the rows that scroll, the scrollbar. */
async function table(p: any) {
  return p.evaluate(() => {
    const t = [...document.querySelectorAll('#main table')].find((e: any) => e.getBoundingClientRect().height > 0) as HTMLElement | undefined
    if (!t) return null
    const body = t.querySelector('tbody') as HTMLElement
    const head = t.querySelector('thead') as HTMLElement
    const hb = head.getBoundingClientRect()
    const bb = body.getBoundingClientRect()
    return {
      scrolls: /(auto|scroll)/.test(getComputedStyle(body).overflowY),
      headBottom: Math.round(hb.bottom),
      bodyTop: Math.round(bb.top),
      sorts: t.querySelectorAll('thead th[aria-sort]').length,
      rows: body.querySelectorAll('tr:not([data-foot])').length,
      pageScroll: document.documentElement.scrollHeight - innerHeight,
    }
  })
}

const checks: L.Check[] = [
  {
    id: 'TBL-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      for (const [w, h] of [[1440, 900], [1280, 600], [390, 844]]) {
        await p.setViewportSize({ width: w, height: h })
        for (const route of ['#/admin/tenants', '#/admin/people']) {
          await H.go(p, route)
          await p.waitForTimeout(1200)
          const m = await table(p)
          c.ok(!!m && m.scrolls && m.bodyTop >= m.headBottom - 1 && m.sorts > 0 && m.pageScroll <= 1, `${route} at ${w}x${h}: ${JSON.stringify(m)}`)
          if (w === 1440) {
            const first = await p.locator('#main tbody tr').first().innerText()
            await p.locator('#main thead th[aria-sort] button').first().click()
            const asc = await p.locator('#main thead th[aria-sort="ascending"]').count()
            await p.locator('#main thead th[aria-sort] button').first().click()
            const desc = await p.locator('#main thead th[aria-sort="descending"]').count()
            c.ok(asc === 1 && desc === 1, `${route}: the first click sorts ascending, the second descending (${asc}/${desc}, first row «${first.slice(0, 20)}»)`)
          }
        }
      }
      await p.setViewportSize({ width: 1440, height: 900 })
      return c.result()
    },
  },
  {
    id: 'TBL-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await p.setViewportSize({ width: 1440, height: 900 })
      await H.go(p, '#/t/comune-roma/p/com.mosaikit.files')
      await p.waitForTimeout(1500)
      const f = p.frameLocator('iframe.plugin-frame')
      c.ok((await f.locator('.msk-headwrap').count()) + (await f.locator('.fm-main').count()) > 0, 'the Files app is drawn')
      c.ok((await f.locator('input[type="search"], .msk-filter').count()) > 0, 'Files: a filter box in the header')
      return c.result()
    },
  },
  {
    id: 'TBL-03',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.setViewportSize({ width: 1440, height: 900 })
      await p.evaluate(() => localStorage.removeItem('msk_plugins_view'))
      await H.go(p, '#/admin/plugins')
      await p.waitForTimeout(1200)
      c.ok((await p.locator('[data-testid="plugin-card"]').count()) > 0, 'the cards are the default view')
      c.ok((await p.getByRole('radio', { name: 'Cards' }).getAttribute('aria-checked')) === 'true', 'the switch shows Cards')
      await p.getByRole('radio', { name: 'Table' }).click()
      c.ok((await p.locator('#main table').count()) === 1 && (await p.locator('[data-testid="plugin-card"]').count()) === 0, 'the table view replaces the cards')
      await p.reload()
      await p.waitForTimeout(1200)
      c.ok((await p.locator('#main table').count()) === 1, 'the choice is remembered after a reload')
      await p.getByRole('radio', { name: 'Cards' }).click()
      await p.getByRole('searchbox', { name: 'Filter the plugins' }).fill('notes')
      c.ok((await p.locator('[data-testid="plugin-card"]').count()) >= 1, 'the filter finds the Notes card')
      await p.getByRole('searchbox', { name: 'Filter the plugins' }).fill('')
      await p.getByRole('combobox', { name: 'Sort by' }).click()
      await p.getByRole('option', { name: 'Version' }).click()
      c.ok((await p.getByRole('button', { name: 'Ascending' }).count()) === 1, 'the sort menu offers a direction')
      await p.locator('[data-testid="plugin-card"]').first().getByRole('checkbox').click()
      c.ok((await p.getByRole('group', { name: 'Actions on the selection' }).count()) === 1, 'the selection bar appears from a card')
      await p.evaluate(() => localStorage.removeItem('msk_plugins_view'))
      return c.result()
    },
  },
  {
    id: 'TBL-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.setViewportSize({ width: 1440, height: 900 })
      await H.go(p, '#/admin/tenants')
      await p.waitForTimeout(1500)
      const n0 = (await table(p))?.rows ?? 0
      c.ok(n0 > 0 && n0 < 60, `the first page loads ${n0} rows, not everything`)
      await p.locator('#main tbody').evaluate((e: HTMLElement) => (e.scrollTop = e.scrollHeight))
      await p.waitForTimeout(1500)
      const n1 = (await table(p))?.rows ?? 0
      c.ok(n1 >= n0, `after scrolling to the end ${n1} rows (before ${n0})`)
      return c.result()
    },
  },
  {
    id: 'TBL-05',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.setViewportSize({ width: 1440, height: 900 })
      await H.go(p, '#/admin/log')
      await p.waitForTimeout(1500)
      await p.locator('#main tbody').evaluate((e: HTMLElement) => (e.scrollTop = e.scrollHeight))
      await p.waitForTimeout(1200)
      const before = await p.locator('#main tbody').evaluate((e: HTMLElement) => ({ top: e.scrollTop, rows: e.querySelectorAll('tr').length }))
      await p.waitForTimeout(3000)
      const after = await p.locator('#main tbody').evaluate((e: HTMLElement) => ({ top: e.scrollTop, rows: e.querySelectorAll('tr').length }))
      c.ok(after.rows >= before.rows && Math.abs(after.top - before.top) <= 2, `the Log keeps its rows and its scroll position: ${JSON.stringify({ before, after })}`)
      return c.result()
    },
  },
  {
    id: 'TBL-06',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.setViewportSize({ width: 1440, height: 900 })
      await H.go(p, '#/admin/plugins/updates')
      await p.waitForTimeout(1200)
      c.ok((await p.locator('[data-testid="empty-state"] svg[aria-hidden="true"]').count()) === 1, 'Plugins › Updates (nothing to update) shows the illustrated empty state')
      c.ok((await p.locator('[data-testid="empty-state"] h2').innerText()).length > 0, 'with a title')
      await H.go(p, '#/admin/tenants')
      await p.waitForTimeout(1200)
      await p.getByRole('searchbox', { name: 'Search a tenant' }).fill('zzzz-no-such-tenant')
      await p.waitForTimeout(1200)
      c.ok((await p.locator('[data-testid="empty-filtered"]').count()) === 1 && (await p.getByRole('button', { name: 'Clear filters' }).count()) === 1, 'a filter that matches nothing shows the small message and Clear filters')
      await p.getByRole('button', { name: 'Clear filters' }).click()
      return c.result()
    },
  },
  {
    id: 'TBL-07',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await p.setViewportSize({ width: 1440, height: 900 })
      await H.go(p, '#/t/comune-roma/p/com.mosaikit.tasks')
      await p.waitForTimeout(1500)
      const f = p.frameLocator('iframe.plugin-frame')
      const shown = () => f.locator('.msk-detail').evaluate((e: HTMLElement) => getComputedStyle(e).display !== 'none')
      c.ok(!(await shown()), 'no panel while nothing is open')
      await f.getByRole('button', { name: /New/ }).first().click()
      c.ok(await shown(), 'the panel opens for a new item')
      await f.getByRole('button', { name: 'Cancel' }).click()
      c.ok(!(await shown()), 'Cancel gives the width back')
      return c.result()
    },
  },
  {
    id: 'TBL-08',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await p.setViewportSize({ width: 1440, height: 900 })
      await H.go(p, '#/t/comune-roma/p/com.mosaikit.files')
      await p.waitForTimeout(1500)
      const f = p.frameLocator('iframe.plugin-frame')
      const pdf = ['%PDF-1.4', '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj', '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj', '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj', 'trailer<</Root 1 0 R/Size 4>>', '%%EOF', ''].join(String.fromCharCode(10))
      await f.locator('input[type="file"]').setInputFiles({ name: 'tbl08.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) })
      await f.locator('.fm-main').getByText('tbl08.pdf', { exact: true }).first().click()
      c.ok(await f.locator('.fm-side .pv canvas').isVisible({ timeout: 15000 }).catch(() => false), 'the PDF is drawn in the panel')
      c.ok(await f.locator('.fm-bar button[data-tip]').first().isVisible(), 'icon-only buttons in the bar')
      const over = await f.locator('.fm-side').evaluate((e: HTMLElement) => e.scrollWidth <= e.clientWidth)
      c.ok(over, 'the panel does not scroll sideways')
      return c.result()
    },
  },
]

export default checks
