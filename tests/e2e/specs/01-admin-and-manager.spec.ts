import { expect, test } from '@playwright/test'
import { PASSWORD, adminLogin, fresh, login, logout, appearanceTab, nav, createTenant, accessible } from './support'

// Administrator and Tenant Manager: second factor, plugins, tenants, top bar, theme, people, invitation. Runs in order after the previous file (the state of the installation is shared).

test.describe.serial('01-admin-and-manager', () => {
  test('administrator: second factor, plugins, tenants, top bar and theme', async ({ page }) => {
    // before any tenant the sign-in page says so and points to the administrator access
    await fresh(page)
    await expect(page.getByText('No tenant available.', { exact: false })).toBeVisible()
    await accessible(page, 'sign-in')
    await adminLogin(page)
    await expect(page.getByText('Platform', { exact: true }).first()).toBeVisible()
    await accessible(page, 'platform overview')

    // plugins preinstalled from the registry
    await nav(page, 'Plugins').click()
    for (const name of ['Notes', 'Tasks', 'Contacts', 'Maps', 'Static sites', 'Files']) {
      await expect(page.getByRole('row', { name: new RegExp(name) }).first()).toContainText('active')
    }
    await accessible(page, 'plugins of the platform')

    // two tenants, each with its Tenant Manager
    await nav(page, 'Tenants').click()
    await createTenant(page, 'alfa', 'City of Alfa')
    await createTenant(page, 'beta', 'City of Beta')
    await page.getByRole('link', { name: 'City of Alfa' }).click()
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: /^People/ }).click()
    await expect(page.getByRole('row', { name: /manager/ })).toContainText('Tenant Manager')
    await accessible(page, 'detail of the tenant')

    // the top bar, decided by the Administrator: without help, the help moves to the person menu
    await nav(page, 'System').click()
    await appearanceTab(page, 'Top bar')
    await page.getByRole('switch', { name: 'Help' }).click()
    await accessible(page, 'top bar, with changes')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeHidden()
    await page.getByRole('button', { name: /person menu/ }).click()
    await expect(page.getByRole('menuitem', { name: 'Guided tour of this page' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('switch', { name: 'Help' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeVisible()

    // the theme of the platform: Tessera, the colours of the logo
    await appearanceTab(page, 'Theme and mode')
    await page.getByRole('button', { name: /Tessera/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'tessera')
    await accessible(page, 'system, Tessera theme')
    await logout(page)
  })

  test('Tenant Manager: navigation, people, theme of the tenant, invitation', async ({ page }) => {
    await login(page, 'City of Alfa', 'manager', PASSWORD)
    // the tenant inherits the theme of the platform
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'tessera')
    for (const name of ['Tenant overview', 'Manage', 'Plugins', 'Shares', 'Usage', 'Tenant settings']) {
      await expect(nav(page, name)).toBeVisible()
    }
    await nav(page, 'Manage').click()
    await page.getByRole('button', { name: 'New user' }).click()
    const d = page.getByRole('dialog', { name: 'New user' })
    await d.getByLabel('Username').fill('anna')
    await d.getByLabel('Display name').fill('Anna Rossi')
    await d.getByLabel('Email', { exact: true }).fill('anna@example.org')
    await d.getByLabel('Initial password').fill(PASSWORD)
    await d.getByRole('button', { name: 'Create user' }).click()
    await expect(page.getByRole('row', { name: /Anna Rossi/ })).toBeVisible()
    // the action bar appears only with a selection
    await expect(page.getByRole('button', { name: 'Make Tenant Manager' })).toBeHidden()
    await page.getByRole('row', { name: /Anna Rossi/ }).getByRole('checkbox').click()
    await expect(page.getByRole('button', { name: 'Make Tenant Manager' })).toBeVisible()
    await accessible(page, 'manage')

    // theme of the tenant: customized, then the one of the platform again
    await nav(page, 'Tenant settings').click()
    await appearanceTab(page, 'Theme and mode')
    await expect(page.getByText('Inherited', { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: /Designers Italia/ }).click()
    await expect(page.getByText('Customized', { exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'italia')
    await page.getByRole('button', { name: 'Restore the theme of the platform' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'tessera')
    await logout(page)

    // the Tenant Manager of Beta invites Anna, who is in Alfa
    await login(page, 'City of Beta', 'manager', PASSWORD)
    await nav(page, 'Manage').click()
    await page.getByRole('radio', { name: /Pending/ }).click()
    await page.getByRole('button', { name: 'Invite people' }).click()
    const inv = page.getByRole('dialog', { name: 'Invite a person of another tenant' })
    await inv.getByLabel('Home tenant').fill('alfa')
    await inv.getByLabel('Username').fill('anna')
    await inv.getByRole('button', { name: 'Send the invitation' }).click()
    await expect(page.getByRole('row', { name: /anna/ })).toBeVisible()
    await logout(page)
  })

})
