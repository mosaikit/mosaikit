import { expect, test, type Page } from '@playwright/test'
import { PASSWORD, login } from './support'

// Grouped sidebar navigation: groups declared by the distribution (`[[nav_groups]]`) arrive with the brand.
// The brand answer is completed here, so the spec needs no distribution of its own.

const GROUPS = [
  { id: 'work', label: 'Work', icon: 'briefcase', plugins: ['com.mosaikit.notes', 'com.mosaikit.ghost', 'com.mosaikit.contacts'], i18n: { it: { label: 'Lavoro' } } },
  { id: 'empty', label: 'Nothing', icon: 'nope', plugins: ['com.mosaikit.ghost'] },
]

async function withGroups(page: Page) {
  await page.route('**/api/brand', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    await route.fulfill({ response: res, json: { ...body, nav_groups: GROUPS } })
  })
  // the layout in use of the tenant (`nav.layout`, whose default is the groups of the distribution) comes with its context
  await page.route('**/api/t/*/context', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    await route.fulfill({ response: res, json: { ...body, config: { ...body.config, 'nav.layout': GROUPS } } })
  })
}
const sidebar = (page: Page) => page.locator('[data-sidebar="sidebar"]').first()

test.describe.serial('19-nav-groups', () => {
  test('open sidebar: heading with its apps, collapse is remembered, keyboard', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await withGroups(page)
    await page.evaluate(() => localStorage.removeItem('msk_nav_groups'))
    await page.reload()
    await page.getByRole('button', { name: 'Open or close the sidebar' }).first().click()
    const head = sidebar(page).getByRole('button', { name: 'Work', exact: true })
    await expect(head).toHaveAttribute('aria-expanded', 'true')
    await expect(sidebar(page).getByRole('link', { name: 'Notes', exact: true })).toBeVisible()
    // a group with no installed plugin is hidden
    await expect(sidebar(page).getByRole('button', { name: 'Nothing' })).toHaveCount(0)
    // keyboard: the arrow moves from the heading to the first app
    await head.focus()
    await page.keyboard.press('ArrowDown')
    await expect(sidebar(page).getByRole('link', { name: 'Notes', exact: true })).toBeFocused()
    // collapse; the choice survives a reload
    await head.click()
    await expect(head).toHaveAttribute('aria-expanded', 'false')
    await expect(sidebar(page).getByRole('link', { name: 'Notes', exact: true })).toHaveCount(0)
    await page.reload()
    await page.getByRole('button', { name: 'Open or close the sidebar' }).first().click()
    await expect(sidebar(page).getByRole('button', { name: 'Work', exact: true })).toHaveAttribute('aria-expanded', 'false')
  })

  test('closed sidebar: one icon opens a menu with the apps; Escape returns the focus', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await withGroups(page)
    await page.reload()
    const trigger = sidebar(page).getByRole('button', { name: 'Open the apps of Work' })
    await expect(trigger).toBeVisible()
    await trigger.click()
    await expect(page.getByRole('menuitem', { name: 'Notes', exact: true }).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitem', { name: 'Notes' })).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await trigger.click()
    await page.getByRole('menuitem', { name: 'Notes', exact: true }).first().click()
    await expect(page).toHaveURL(/notes/)
  })

  test('the group label follows the language', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await withGroups(page)
    await page.evaluate(() => localStorage.setItem('msk_lang', 'it'))
    await page.reload()
    await expect(sidebar(page).getByRole('button', { name: 'Apri le app di Lavoro' })).toBeVisible()
    await page.evaluate(() => localStorage.removeItem('msk_lang'))
  })

  test('closed sidebar: Settings stay at the bottom; the names under the icons can be hidden', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await page.evaluate(() => {
      localStorage.removeItem('msk_rail_labels')
      localStorage.removeItem('msk_sidebar_open')
    })
    await page.reload()
    const rail = sidebar(page)
    await expect(page.locator('[data-collapsible="icon"]')).toBeAttached()
    const settings = rail.getByRole('link', { name: 'Settings' })
    const gap = async () => {
      const b = await settings.boundingBox()
      const s = await rail.boundingBox()
      return s!.y + s!.height - (b!.y + b!.height)
    }
    expect(await gap()).toBeLessThanOrEqual(4)
    const withNames = (await settings.boundingBox())!.height
    // Account › Appearance and language: the switch hides the names, at once
    await page.goto('./#/t/alfa/account/appearance')
    await page.getByRole('switch', { name: 'Names under the icons' }).click()
    await expect(settings.locator('span')).toBeHidden()
    expect((await settings.boundingBox())!.height).toBeLessThan(withNames)
    // the icon keeps its name for assistive technology and as a tooltip, and stays at the bottom
    await expect(settings).toHaveAttribute('title', 'Tenant settings')
    expect(await gap()).toBeLessThanOrEqual(4)
    await page.reload()
    await expect(page.getByRole('switch', { name: 'Names under the icons' })).not.toBeChecked()
    await page.getByRole('switch', { name: 'Names under the icons' }).click()
    await expect(settings.locator('span')).toBeVisible()
  })
})
