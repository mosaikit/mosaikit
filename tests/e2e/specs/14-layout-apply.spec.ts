import { expect, test } from '@playwright/test'
import { PASSWORD, adminLogin, appearanceTab, login, logout, nav } from './support'

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

  test('R2-09 list pages: no gap under the band, the filters fully visible, no scroll of the page', async ({ page }) => {
    await login(page, 'Alfa Municipality', 'manager', PASSWORD)
    for (const [w, h] of [[2000, 1194], [390, 800]]) {
      await page.setViewportSize({ width: w, height: h })
      for (const hash of ['log', 'manage', 'trash', 'shares', 'plugins']) {
        await page.goto('./#/t/alfa/' + hash)
        await page.waitForTimeout(1200)
        const m = await page.evaluate(() => {
          const head = document.querySelector('.msk-page-header')!.getBoundingClientRect()
          const bad: string[] = []
          for (const e of document.querySelectorAll('[data-listscroll] .msk-pills, aside.msk-facets')) {
            const r = e.getBoundingClientRect()
            // a filter column that is closed (on a phone it opens from the button of the header) has no box
            if (r.width === 0 || r.height === 0) continue
            if (r.top < head.bottom - 1 || r.bottom > innerHeight + 1) bad.push(e.className.slice(0, 30) + ':' + Math.round(r.top) + '-' + Math.round(r.bottom))
          }
          return { headTop: Math.round(head.top), over: document.documentElement.scrollHeight - innerHeight, list: !!document.querySelector('[data-listscroll]'), bad }
        })
        const where = hash + ' at ' + w + 'px ' + JSON.stringify(m)
        expect(m.list, where).toBe(true)
        // right under the band (50 px), nothing pushed down
        expect(m.headTop, where).toBe(50)
        // only the list scrolls
        expect(m.over, where).toBeLessThanOrEqual(1)
        expect(m.bad, where).toEqual([])
      }
    }
  })

  test('R2-06 the header of a page with sections shows the page and the selected section', async ({ page }) => {
    await adminLogin(page)
    const check = async (hash: string, page_: string) => {
      for (const [w, h] of [[2000, 1194], [390, 800]]) {
        await page.setViewportSize({ width: w, height: h })
        await page.goto('./' + hash)
        await page.waitForTimeout(1000)
        const head = page.locator('.msk-page-header').first()
        await expect(head, hash + ' at ' + w).toContainText(page_)
        const sec = head.getByTestId('header-section')
        await expect(sec, hash + ' at ' + w).toBeVisible()
        const label = ((await sec.innerText()) ?? '').trim()
        expect(label.length).toBeGreaterThan(0)
        if (w > 760) {
          // the same as the selected entry of the list at the left
          const sel = page.locator('nav[aria-label="Sections"] [aria-current="page"], [role="radio"][aria-checked="true"]').first()
          expect(((await sel.innerText()) ?? '').trim().startsWith(label), hash + ': ' + label + ' vs list').toBe(true)
        }
      }
    }
    await check('#/admin/system', 'System')
    await check('#/admin/system/theme', 'System')
    await check('#/admin/monitoring', 'Monitoring')
    await check('#/admin/account', 'Account')
    await logout(page)
    await login(page, 'Alfa Municipality', 'manager', PASSWORD)
    for (const [hash, name] of [['settings', 'Settings'], ['usage', 'Usage'], ['account', 'Account'], ['manage', 'Manage'], ['manage/groups', 'Manage']]) await check('#/t/alfa/' + hash, name)
  })
})
