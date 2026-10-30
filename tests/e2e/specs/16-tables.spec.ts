import { expect, test, type Page } from '@playwright/test'
import { accessible, adminLogin, nav } from './support'

// Tables (docs/refactoring-ui.md, «Tables»): the same table everywhere (fixed header row, rows that scroll by themselves,
// filter, sortable titles, rows that load as the end comes into view) and the two views of the installed plugins.
// Runs after the layout contract, which leaves enough tenants for a list to need a second page.

const rows = (page: Page) => page.locator('#main tbody tr:not([data-foot])')
const scroller = (page: Page) => page.locator('#main tbody').first()

test.describe.serial('16-tables', () => {
  test('infinite scroll is progressive and the Log keeps its place', async ({ page }) => {
    test.setTimeout(180_000)
    await adminLogin(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('./#/admin/tenants')
    await expect(rows(page).first()).toBeVisible()
    const first = await rows(page).count()
    const more = page.locator('#main tbody tr[data-foot]').getByRole('button', { name: /Load more/ })
    if (await more.count()) {
      // the first page only: the foot is the last row of the scroller, far below the visible rows
      expect(first).toBeLessThan(60)
      const box = await more.boundingBox()
      const sc = await scroller(page).boundingBox()
      expect(box!.y, 'the foot is not in view before the end of the rows').toBeGreaterThan(sc!.y + sc!.height - 1)
      await scroller(page).evaluate((e) => (e.scrollTop = e.scrollHeight))
      await expect.poll(() => rows(page).count(), { timeout: 15_000 }).toBeGreaterThan(first)
    }
    // the Log: scrolled past the first page, then left alone for longer than the clock of its query
    await page.goto('./#/admin/log')
    await expect(rows(page).first()).toBeVisible()
    for (let i = 0; i < 4; i++) {
      const n = await rows(page).count()
      await scroller(page).evaluate((e) => (e.scrollTop = e.scrollHeight))
      await page.waitForTimeout(1200)
      if ((await rows(page).count()) === n) break
    }
    await scroller(page).evaluate((e) => (e.scrollTop = e.scrollHeight / 2))
    await page.waitForTimeout(300)
    const before = { top: await scroller(page).evaluate((e) => e.scrollTop), n: await rows(page).count() }
    await page.waitForTimeout(2500)
    const after = { top: await scroller(page).evaluate((e) => e.scrollTop), n: await rows(page).count() }
    expect(after.n, 'the rows stay').toBe(before.n)
    expect(Math.abs(after.top - before.top), 'the scroll position stays').toBeLessThanOrEqual(2)
  })

  test('the sort of a server-paged list acts on the whole list, not on the rows loaded', async ({ page }) => {
    test.setTimeout(180_000)
    await adminLogin(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    // the global order, from the API (all tenants in one page)
    const all = (await (await page.request.get('api/admin/tenants?limit=500')).json()) as { items: { name: string }[]; total: number }
    const key = (x: string) => x.toLowerCase()
    const names = all.items.map((x) => x.name).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
    await page.goto('./#/admin/tenants')
    await expect(rows(page).first()).toBeVisible()
    const firstCell = async () => (await rows(page).first().locator('td').nth(1).innerText()).split('
')[0].trim()
    const head = page.locator('#main thead th[aria-sort]').filter({ hasText: /^Tenant$/ })
    // a computed column (the count of members) is not a sort button on a server list
    await expect(page.locator('#main thead th', { hasText: /^Members$/ }).locator('button')).toHaveCount(0)
    await head.getByRole('button').click()
    await expect(head).toHaveAttribute('aria-sort', 'ascending')
    await expect.poll(firstCell).toBe(names[0])
    // more than one page: the rows after scrolling continue the same order
    await scroller(page).evaluate((e) => (e.scrollTop = e.scrollHeight))
    await expect.poll(() => rows(page).count(), { timeout: 15_000 }).toBeGreaterThan(Math.min(50, names.length - 1))
    const shown = async () => (await rows(page).locator('td:nth-child(2)').allInnerTexts()).map((x) => x.split('
')[0].trim())
    const asc = await shown()
    expect(asc).toEqual(names.slice(0, asc.length))
    // descending: the first row is the global maximum and the scroll goes back to the top
    await head.getByRole('button').click()
    await expect(head).toHaveAttribute('aria-sort', 'descending')
    await expect.poll(firstCell).toBe(names[names.length - 1])
    expect(await scroller(page).evaluate((e) => e.scrollTop)).toBe(0)
    // the Log: sorted by Tenant (a platform Log), the loaded rows are in order and more rows continue it
    await page.goto('./#/admin/log')
    await expect(rows(page).first()).toBeVisible()
    const col = page.locator('#main thead th[aria-sort]').filter({ hasText: /^Tenant$/ })
    await col.getByRole('button').click()
    await expect(col).toHaveAttribute('aria-sort', 'ascending')
    const idx = (await page.locator('#main thead th').allInnerTexts()).findIndex((x) => x.trim() === 'Tenant') + 1
    const tenants = async () => (await rows(page).locator(`td:nth-child(${idx})`).allInnerTexts()).map((x) => x.trim().toLowerCase())
    await expect.poll(() => rows(page).count()).toBeGreaterThan(0)
    const inOrder = (v: string[]) => v.every((x, i) => i === 0 || v[i - 1] <= x || x === '—')
    expect(inOrder(await tenants())).toBe(true)
    await scroller(page).evaluate((e) => (e.scrollTop = e.scrollHeight))
    await page.waitForTimeout(1500)
    expect(inOrder(await tenants())).toBe(true)
  })

  test('a table sorts, filters and keeps its header row; the plugins have cards and a table', async ({ page }) => {
    test.setTimeout(180_000)
    await adminLogin(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await nav(page, 'Plugins').click()
    // cards: the default; filter, sort menu, selection
    await expect(page.getByRole('radio', { name: 'Cards' })).toHaveAttribute('aria-checked', 'true')
    const cards = page.getByTestId('plugin-card')
    await expect(cards.first()).toBeVisible()
    const all = await cards.count()
    await page.getByRole('searchbox', { name: 'Filter the plugins' }).fill('notes')
    await expect.poll(() => cards.count()).toBeLessThan(all)
    await page.getByRole('searchbox', { name: 'Filter the plugins' }).fill('')
    await expect(cards).toHaveCount(all)
    await page.getByRole('combobox', { name: 'Sort by' }).click()
    await page.getByRole('option', { name: 'Plugins' }).click()
    const names = async () => (await cards.locator('h3').allInnerTexts()).map((x) => x.trim())
    const asc = await names()
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
    await page.getByRole('button', { name: 'Ascending' }).click()
    const desc = await names()
    expect(desc).toEqual([...asc].reverse())
    await cards.first().getByRole('checkbox').click()
    await expect(page.getByRole('group', { name: 'Actions on the selection' })).toBeVisible()
    await page.getByRole('button', { name: 'Deselect' }).click()
    // the table: the same sort (kept), the header row fixed, a scrollbar of the rows, aria-sort
    await page.getByRole('radio', { name: 'Table' }).click()
    await expect(page.locator('#main thead th[aria-sort="descending"]')).toHaveCount(1)
    const m = await page.evaluate(() => {
      const b = document.querySelector('#main tbody') as HTMLElement
      const h = document.querySelector('#main thead') as HTMLElement
      return { top: b.getBoundingClientRect().top, bottom: h.getBoundingClientRect().bottom, scrolls: getComputedStyle(b).overflowY, page: document.documentElement.scrollHeight - innerHeight }
    })
    expect(m.scrolls).toMatch(/auto|scroll/)
    expect(m.top).toBeGreaterThanOrEqual(m.bottom - 1)
    expect(m.page).toBeLessThanOrEqual(1)
    await accessible(page, 'plugins as a table')
    // the choice is remembered
    await page.reload()
    await expect(page.locator('#main table')).toBeVisible()
    await page.getByRole('radio', { name: 'Cards' }).click()
    await page.reload()
    await expect(cards.first()).toBeVisible()
    // a click on the card opens the plugin
    await cards.first().getByRole('link').click()
    await expect(page).toHaveURL(/#\/admin\/plugin\//)
    // Updates and Catalog have both views too
    await page.goto('./#/admin/plugins/catalog')
    await expect(page.getByRole('radio', { name: 'Table' })).toBeVisible()
  })
})
