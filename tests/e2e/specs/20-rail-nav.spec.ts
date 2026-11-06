import { expect, test, type Page } from '@playwright/test'
import { PASSWORD, login, nav } from './support'

// The closed sidebar (docs/manual-tests.md, RAIL-01, RAIL-03, RAIL-04): pressing the icon of the open page, menus that open on hover
// (one at a time) and the press on the icon of an open menu. Two groups of a distribution brand give the icons with a menu, as in 19-nav-groups.

const GROUPS = [
  { id: 'work', label: 'Work', icon: 'briefcase', plugins: ['com.mosaikit.notes'] },
  { id: 'people', label: 'People', icon: 'users', plugins: ['com.mosaikit.contacts'] },
]

async function withGroups(page: Page) {
  await page.route('**/api/brand', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    await route.fulfill({ response: res, json: { ...body, nav_groups: GROUPS } })
  })
}
const sidebar = (page: Page) => page.locator('[data-sidebar="sidebar"]').first()
const trigger = (page: Page, label: string) => sidebar(page).getByRole('button', { name: `Open the apps of ${label}` })

type Win = { __events: string[] }

test.describe.serial('20-rail-nav', () => {
  test('RAIL-01: pressing the icon of the open page tells the plugin; the page stays where it is on a list', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await nav(page, 'Notes').click()
    const iframe = page.locator('iframe.plugin-frame')
    const frame = page.frameLocator('iframe.plugin-frame')
    await expect(frame.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible()
    // the messages the shell sends to the page of the plugin
    const handle = await iframe.elementHandle()
    const inner = (await handle!.contentFrame())!
    await inner.evaluate(() => {
      ;(window as unknown as Win).__events = []
      window.addEventListener('message', (e) => {
        const d = e.data as { msk?: number; event?: string } | null
        if (d?.msk === 1 && d.event) (window as unknown as Win).__events.push(d.event)
      })
    })
    const reselects = () => inner.evaluate(() => (window as unknown as Win).__events.filter((e) => e === 'nav.reselect').length)
    const url = page.url()

    // on the list: the press does not navigate, the plugin is told, and nothing changes
    await nav(page, 'Notes').click()
    await expect.poll(reselects).toBe(1)
    expect(page.url()).toBe(url)
    await expect(frame.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible()

    // on a detail: the same message arrives and the shell keeps the page (the plugin goes back to its list through `msk.onNavReselect`;
    // Notes does not listen to it yet, so what the shell guarantees is tested here)
    await frame.getByRole('button', { name: /^＋ New/ }).first().click()
    await expect(frame.locator('.msk-detail')).toBeVisible()
    await nav(page, 'Notes').click()
    await expect.poll(reselects).toBe(2)
    expect(page.url()).toBe(url)
    // a press on the entry of another page navigates as usual
    await nav(page, 'Tenant settings').click()
    await expect(page).not.toHaveURL(url)
  })

  test('RAIL-03: hover opens a menu at once; the second icon closes the first; one menu at a time', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await withGroups(page)
    await page.reload()
    const work = trigger(page, 'Work')
    const people = trigger(page, 'People')
    await expect(work).toBeVisible()
    await expect(people).toBeVisible()
    await work.hover()
    await expect(page.getByRole('menuitem', { name: 'Notes', exact: true })).toBeVisible({ timeout: 1000 })
    await people.hover()
    await expect(page.getByRole('menuitem', { name: 'Contacts', exact: true })).toBeVisible({ timeout: 1000 })
    await expect(page.getByRole('menuitem', { name: 'Notes', exact: true })).toHaveCount(0)
    await expect(page.getByRole('menu')).toHaveCount(1)
    // back on the first: again only one
    await work.hover()
    await expect(page.getByRole('menuitem', { name: 'Notes', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Contacts', exact: true })).toHaveCount(0)
    await expect(page.getByRole('menu')).toHaveCount(1)
  })

  test('RAIL-04: a press on the icon of an open menu keeps it open; Escape closes it and the focus returns to the icon', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await withGroups(page)
    await page.reload()
    const work = trigger(page, 'Work')
    await work.hover()
    const item = page.getByRole('menuitem', { name: 'Notes', exact: true })
    await expect(item).toBeVisible()
    // mouse: the press on the icon does not close the menu the hover opened (it stays, also after the pointer has left)
    await work.click()
    await expect(item).toBeVisible()
    await page.mouse.move(600, 400)
    await page.waitForTimeout(400)
    await expect(item).toBeVisible()
    // keyboard: Escape closes it and the focus goes back to the icon
    await page.keyboard.press('Escape')
    await expect(item).toHaveCount(0)
    await expect(work).toBeFocused()
    // keyboard only: Enter opens it, Escape closes it again with the focus on the icon
    await page.keyboard.press('Enter')
    await expect(item).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(item).toHaveCount(0)
    await expect(work).toBeFocused()
  })
})
