import { expect, test } from '@playwright/test'
import { PASSWORD, appearanceTab, login } from './support'

// Navigation layout (docs/manual-tests.md, NAV-01..04): the Tenant Manager groups the apps of the sidebar in groups
// and subgroups (Settings › Identity and appearance › Navigation); the sidebar shows them indented; going back
// restores the order of the distribution.

test.describe.serial('Navigation layout', () => {
  test('a group and a subgroup in the sidebar, then back to the default', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await login(page, 'Alfa', 'manager', PASSWORD)
    await page.getByRole('link', { name: 'Tenant settings' }).click()
    await appearanceTab(page, 'Navigation')
    const editor = page.getByTestId('nav-editor')

    // NAV-01: the setting is inherited; «Customize» makes it editable
    await page.getByRole('button', { name: 'Customize' }).click()
    await editor.getByRole('button', { name: 'Add a group' }).click()
    await editor.getByRole('textbox', { name: 'Name of the group' }).first().fill('Daily work')
    await editor.getByRole('combobox', { name: 'Add an app to the group' }).first().click()
    const first = await page.getByRole('option').first().innerText()
    await page.getByRole('option').first().click()

    // NAV-02: a subgroup with an app of its own
    await editor.getByRole('button', { name: 'Add a subgroup' }).click()
    await editor.getByRole('textbox', { name: 'Name of the group' }).nth(1).fill('Later')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Settings saved').first()).toBeVisible()

    // NAV-03: the sidebar shows the group as a heading and the app under it
    const side = page.locator('[data-sidebar="sidebar"]')
    await expect(side.getByRole('button', { name: /Daily work/ })).toBeVisible()
    // (in the closed sidebar the group is one icon whose menu lists its apps)\n    await side.getByRole('button', { name: /Daily work/ }).first().click()\n    await expect(page.getByRole('link', { name: first.split('\n')[0], exact: true }).first()).toBeVisible()\n    await page.keyboard.press('Escape')

    // NAV-04: «Restore» goes back to the groups of the distribution
    await page.getByRole('button', { name: 'Restore' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Settings saved').first()).toBeVisible()
    await expect(side.getByRole('button', { name: /Daily work/ })).toHaveCount(0)
    await ctx.close()
  })
})
