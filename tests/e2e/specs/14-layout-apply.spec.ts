import { expect, test } from '@playwright/test'
import { adminLogin, appearanceTab, nav } from './support'

// R2-07: a layout that is saved is in use at once, without a reload. Runs after the layouts file (any state will do).

test.describe.serial('14-layout-apply', () => {
  test('R2-07 a saved layout is applied at once, without a reload', async ({ page }) => {
    await adminLogin(page)
    await nav(page, 'System').click()
    await appearanceTab(page, 'Layout')
    // the tabs of Identity and appearance stay in place when the page scrolls
    await page.setViewportSize({ width: 1280, height: 400 })
    await page.evaluate(() => window.scrollTo(0, 200))
    const tabs = page.getByRole('navigation', { name: 'Tabs' })
    const top = await tabs.evaluate((e) => Math.round(e.getBoundingClientRect().top))
    expect(top).toBeGreaterThan(90)
    expect(top).toBeLessThan(140)
    await page.setViewportSize({ width: 1280, height: 800 })
    for (const id of ['console', 'teams']) {
      await page.locator(`[data-layout-card="${id}"]`).click()
      await page.getByRole('button', { name: 'Save' }).click()
      // no page.reload(): the shell redraws with the new layout
      await expect(page.locator(`.msk-shell[data-layout="${id}"]`)).toBeAttached({ timeout: 10_000 })
    }
  })

  test('R2-08 the list of sections of a page stays in place and scrolls by itself', async ({ page }) => {
    await adminLogin(page)
    await nav(page, 'System').click()
    await page.setViewportSize({ width: 1280, height: 360 })
    await page.evaluate(() => window.scrollTo(0, 300))
    const side = page.getByRole('navigation', { name: 'Sections' })
    const box = await side.evaluate((e) => ({ top: Math.round(e.getBoundingClientRect().top), over: e.scrollHeight > e.clientHeight, ov: getComputedStyle(e).overflowY }))
    // under the band and the header, whatever the scroll of the page
    expect(box.top).toBeLessThan(140)
    expect(box.ov).toBe('auto')
    expect(box.over).toBe(true)
    await side.hover()
    await page.mouse.wheel(0, 150)
    await expect.poll(() => side.evaluate((e) => e.scrollTop)).toBeGreaterThan(0)
  })
})
