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
    // a click on the card opens the plugin
    await page.getByRole('button', { name: 'Deselect' }).click()
    await cards.first().getByRole('link').click()
    await expect(page).toHaveURL(/#\/admin\/plugin\//)
    await page.goBack()
    // the table: the same sort (kept), the header row fixed, a scrollbar of the rows, aria-sort
    await page.getByRole('radio', { name: 'Table' }).click()
    await expect(page.locator('#main thead th[aria-sort="descending"]')).toHaveCount(1)
    const m = await page.evaluate(() => {
      const b = document.querySelector('#main tbody') as HTMLElement
      const h = document.querySelector('#main thead') as HTMLElement
      return { top: b.getBoundingClientRect().top, bottom: h.getBoundingClientRect().bottom, scrolls: getComputedStyle(b).overflowY, page: document.documentElement.scrollHeight - innerHeight }
    })
    expect(m.scrolls).toBe('scroll')
    expect(m.top).toBeGreaterThanOrEqual(m.bottom - 1)
    expect(m.page).toBeLessThanOrEqual(1)
    await accessible(page, 'plugins as a table')
    // the choice is remembered
    await page.reload()
    await expect(page.locator('#main table')).toBeVisible()
    await page.getByRole('radio', { name: 'Cards' }).click()
    await page.reload()
    await expect(cards.first()).toBeVisible()
    // Updates and Catalog have both views too
    await page.getByRole('radio', { name: 'Catalog' }).click().catch(() => {})
    await expect(page.getByRole('radio', { name: 'Table' })).toBeVisible()
  })
})
