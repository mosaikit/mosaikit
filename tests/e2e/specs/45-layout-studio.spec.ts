import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { PASSWORD, accessible, adminLogin, colorsSettled, login, logout } from './support'

// Layout Studio (docs/manual-tests.md, LST-01..05): indigo band and grey sidebar in light and dark (the colours of the mockup,
// following the mode of the shell), 3D icons from one sprite on the apps that have a marker, the line icon kept elsewhere.
// With STUDIO_SHOTS=<folder> the test also writes the pictures of the card (media/).

const ID = 'com.mosaikit.layout-studio'
const rgb = (s: string) => (s.match(/\d+/g) ?? []).slice(0, 3).map(Number)
const lum = ([r, g, b]: number[]) =>
  [r, g, b]
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0)
const ratio = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)

async function colors(page: Page) {
  return page.evaluate(() => {
    const cs = (sel: string) => getComputedStyle(document.querySelector(sel)!)
    const item = document.querySelector('.msk-nav-item[data-icon] > svg:first-child')
    return {
      band: cs('header.msk-band').backgroundColor,
      bandText: cs('header.msk-band').color,
      nav: cs('.msk-nav').backgroundColor,
      main: cs('.msk-main').backgroundColor,
      icon: item ? getComputedStyle(item).backgroundImage : '',
    }
  })
}

test.describe.serial('45-layout-studio', () => {
  test('Studio: the colours of both modes, the 3D icons, the fallback to the line icon', async ({ page }) => {
    test.setTimeout(240_000)
    await adminLogin(page)
    const put = await page.evaluate(async (id) => {
      const s = await (await fetch('api/session')).json()
      const r = await fetch('api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrf },
        body: JSON.stringify({ values: { layout: id, 'layout.allowed': null } }),
      })
      return `${r.status} ${await r.text()}`
    }, ID)
    // the plugin comes from mosaikit-plugins: without it (an older checkout) there is nothing to test
    test.skip(put.includes('layout_unknown'), 'layout-studio is not in this mosaikit-plugins')
    expect(put).toMatch(/^200/)
    await logout(page)
    await login(page, 'Alfa', 'manager', PASSWORD)
    await page.setViewportSize({ width: 1440, height: 860 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.reload()
    await expect(page.locator(`.msk-shell[data-layout="${ID}"]`)).toBeAttached()
    await expect(page.locator('.msk-shell')).toHaveAttribute('data-mode', 'light')
    await expect(page.locator('.msk-nav-item[data-icon]').first()).toBeVisible()
    await colorsSettled(page)

    const out = process.env.STUDIO_SHOTS
    const shot = async (name: string) => {
      if (out) await page.screenshot({ path: `${out}/${name}.png` })
    }
    // light: indigo band with white text at 4.5:1, grey sidebar, white work area
    let c = await colors(page)
    expect(rgb(c.band)).toEqual([0x44, 0x45, 0x8f])
    expect(rgb(c.nav)).toEqual([0xef, 0xf0, 0xf5])
    expect(rgb(c.main)).toEqual([255, 255, 255])
    expect(ratio(rgb(c.band), rgb(c.bandText))).toBeGreaterThanOrEqual(4.5)
    // the sprite is the icon of the apps that the shell marks; an app with no rule keeps its line icon
    expect(c.icon).toContain('images/icons.png')
    const sprite = await page.evaluate(async () => {
      const u = /url\("?([^")]+)"?\)/.exec(getComputedStyle(document.querySelector('.msk-nav-item[data-icon] > svg:first-child')!).backgroundImage)![1]
      const r = await fetch(u)
      return { status: r.status, type: r.headers.get('content-type') }
    })
    expect(sprite.status).toBe(200)
    expect(sprite.type).toContain('image/png')
    await page.evaluate(() => document.querySelector('.msk-nav-item[data-icon] > svg:first-child')!.closest('.msk-nav-item')!.setAttribute('data-icon', 'no-such-icon'))
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.msk-nav-item[data-icon="no-such-icon"] > svg:first-child')!).backgroundImage)).toBe('none')
    await page.reload()
    await expect(page.locator('.msk-nav-item[data-icon]').first()).toBeVisible()
    await accessible(page, 'Studio, light')
    await shot('light')
    if (out) {
      await page.locator('.msk-nav').getByRole('link', { name: 'Notes', exact: true }).click()
      await expect(page.frameLocator('iframe.plugin-frame').locator('body')).toBeVisible()
      await page.waitForTimeout(2500)
      await shot('page')
    }

    // dark: the band, sidebar and work area of the dark palette, the text still at 4.5:1
    await page.getByRole('button', { name: 'Mode' }).click()
    await page.getByRole('menu').getByText('Dark', { exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.msk-shell')).toHaveAttribute('data-mode', 'dark')
    await colorsSettled(page)
    c = await colors(page)
    expect(rgb(c.band)).toEqual([0x2a, 0x2b, 0x5c])
    expect(rgb(c.nav)).toEqual([0x13, 0x17, 0x28])
    expect(rgb(c.main)).toEqual([0x17, 0x1b, 0x2e])
    expect(ratio(rgb(c.band), rgb(c.bandText))).toBeGreaterThanOrEqual(4.5)
    await accessible(page, 'Studio, dark')
    await shot('dark')
    if (out) fs.writeFileSync(`${out}/done`, '1')

    await page.getByRole('button', { name: 'Mode' }).click()
    await page.getByRole('menu').getByText('Light', { exact: true }).click()
    await page.keyboard.press('Escape')
    await logout(page)
    await adminLogin(page)
    await page.evaluate(async () => {
      const s = await (await fetch('api/session')).json()
      await fetch('api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrf },
        body: JSON.stringify({ values: { layout: 'teams' } }),
      })
    })
  })
})
