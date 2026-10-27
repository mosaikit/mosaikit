import { expect, test } from '@playwright/test'
import { PASSWORD, NEW_PASSWORD, login, logout, section, nav, accessible } from './support'

// Member: Account, notification, plugin, sharing, public link; shares and usage seen by the Tenant Manager. Runs in order after the previous file (the state of the installation is shared).

test.describe.serial('02-member-sharing', () => {
  test('member: Account, notification, plugin, sharing and public link', async ({ page, context }) => {
    await login(page, 'City of Alfa', 'anna', PASSWORD)
    await expect(nav(page, 'Manage')).toBeHidden()
    await accessible(page, 'home')

    // change of one's own password: the rule next to the field
    await page.getByRole('button', { name: /person menu/ }).click()
    await page.getByRole('menuitem', { name: 'Account' }).click()
    await page.getByRole('link', { name: 'Sign-in and security' }).click()
    await page.getByLabel('Current password').fill(PASSWORD)
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
    await page.getByLabel('Repeat the new password').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Update password' }).click()
    await expect(page.getByText('Password updated: the other sessions were closed')).toBeVisible()
    await accessible(page, 'account')

    // the bell: the invitation of Beta, accepted from the panel
    await page.getByRole('button', { name: /^Notifications/ }).click()
    const panel = page.getByRole('dialog')
    await expect(panel).toContainText('City of Beta')
    await panel.getByRole('button', { name: 'Accept' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /^Tenant: / })).toBeVisible()

    // a note in the plugin, in the iframe (the plugin labels come from its manifest)
    await nav(page, 'Notes').click()
    const frame = page.frameLocator('iframe.plugin-frame')
    await expect(frame.getByRole('heading', { name: 'Notes' })).toBeVisible()
    await frame.locator('[data-key="title"]').fill('Meeting minutes')
    await frame.locator('[data-key="body"]').fill('<b>confidential content</b>')
    await frame.getByRole('button', { name: 'Save' }).click()
    const row = frame.locator('tbody tr.row', { hasText: 'Meeting minutes' })
    await expect(row).toBeVisible()
    // WASM hook of the plugin: default tag
    await expect(row).toContainText('personal')

    // read sharing with the manager, in the dialog of the host
    await frame.getByRole('button', { name: 'Share…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Sharing' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Search people or groups').fill('manager')
    await dialog.getByRole('option', { name: /manager/ }).click()
    await dialog.getByRole('button', { name: 'Share', exact: true }).click()
    await expect(dialog.getByRole('list', { name: 'Shared with' })).toContainText('manager')
    await accessible(page, 'sharing')

    // public link
    await dialog.getByRole('button', { name: 'Create link' }).click()
    const url = await dialog.getByLabel('Public link', { exact: true }).inputValue()
    expect(url).toMatch(/\/p\/[0-9a-f]{48}\/$/)
    await dialog.getByRole('button', { name: 'Close' }).click()

    const pub = await context.newPage()
    await pub.goto(url)
    await expect(pub.getByRole('heading', { name: 'Meeting minutes' })).toBeVisible()
    // the content is shown as text, not as HTML
    await expect(pub.locator('body')).toContainText('<b>confidential content</b>')
    await pub.close()
    await logout(page)
  })

  test('Tenant Manager: the note shared read only, shares and usage', async ({ page }) => {
    await login(page, 'City of Alfa', 'manager', PASSWORD)
    await expect(page.getByRole('heading', { name: 'Tenant overview' })).toBeVisible()
    // dark mode, with the theme of the tenant
    await page.getByRole('button', { name: 'Mode' }).click()
    await page.getByRole('menuitemradio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await accessible(page, 'tenant overview, dark')
    await page.getByRole('button', { name: 'Mode' }).click()
    await page.getByRole('menuitemradio', { name: 'Light' }).click()
    await nav(page, 'Notes').click()
    const frame = page.frameLocator('iframe.plugin-frame')
    const row = frame.locator('tbody tr.row', { hasText: 'Meeting minutes' })
    await expect(row).toContainText('read only')
    await row.click()
    await expect(frame.locator('[data-key="title"]')).toBeDisabled()
    await expect(frame.getByRole('button', { name: 'Save' })).toBeHidden()

    await nav(page, 'Shares').click()
    await expect(page.getByRole('row', { name: /Meeting minutes/ })).toContainText('Anna Rossi')
    await page.getByRole('radio', { name: /Public/ }).click()
    await expect(page.getByRole('row', { name: /Meeting minutes/ })).toBeVisible()
    await accessible(page, 'shares')

    await nav(page, 'Usage').click()
    await accessible(page, 'usage, quotas')
    // the activity of the tenant and the KPIs of the plugins have their own section
    await section(page, 'Activity')
    await expect(page.getByText('Notes by tag')).toBeVisible()
    await expect(page.getByRole('table', { name: /Notes by tag/ })).toContainText('personal')
    await accessible(page, 'usage')
    await logout(page)
  })

})
