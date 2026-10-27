import { expect, test } from '@playwright/test'
import { PASSWORD, BASE, adminLogin, fresh, login, logout, section, nav, accessible } from './support'

// Shares, trash, log and quotas. Runs in order after the previous file (the state of the installation is shared).

test.describe.serial('08-shares-quotas', () => {
  test('shares, trash and log: revoke, delete, restore, delete for good, the log of tenant and platform', async ({ page }) => {
    test.setTimeout(240_000)
    const call = async (method: string, path: string, body?: unknown) =>
      page.evaluate(
        async ([base, method, path, body]) => {
          const s = await (await fetch(`${base}/api/session`)).json()
          const r = await fetch(`${base}${path}`, {
            method: method as string,
            headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrf },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
          const text = await r.text()
          return { status: r.status, json: text ? JSON.parse(text) : null }
        },
        [BASE, method, path, body] as const,
      )
    // a refused sign-in, for the filter of the failures
    await fresh(page)
    await page.evaluate(
      async (base) => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenant: 'alfa', username: 'anna', password: 'not the password' }) }),
      BASE,
    )
    await login(page, 'Alfa Municipality', 'manager', PASSWORD)
    const created = await call('POST', '/api/t/alfa/p/com.mosaikit.notes/r/notes', { values: { title: 'Trash me' } })
    expect(created.status).toBe(201)
    const id = created.json.id as string
    expect((await call('POST', `/api/t/alfa/resources/${id}/links`, {})).status).toBeLessThan(300)

    // Home: shared by me (the page was open before the note was created through the API)
    await page.reload()
    const mine = page.getByRole('region', { name: 'Shared by me' })
    await expect(mine.getByText('Trash me')).toBeVisible()
    await expect(mine).toContainText('1 public link')

    // Shares: revoke every share and link of the item
    await nav(page, 'Shares').click()
    await page.getByRole('radio', { name: /Public and links/ }).click()
    const row = page.getByRole('row', { name: /Trash me/ })
    await row.getByRole('button', { name: 'Revoke', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByText('Revoked: 0 shares, 1 public links')).toBeVisible()
    await expect(page.getByRole('row', { name: /Trash me/ })).toBeHidden()
    await accessible(page, 'shares with selection')

    // delete from the plugin: it goes to the trash
    await nav(page, 'Notes').click()
    const frame = page.frameLocator('iframe.plugin-frame')
    await frame.locator('tbody tr.row', { hasText: 'Trash me' }).click()
    await frame.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click()
    await expect(frame.locator('tbody tr.row', { hasText: 'Trash me' })).toBeHidden()

    // the Trash, from the person menu: restore with one click
    await page.getByRole('button', { name: /person menu/ }).click()
    await page.getByRole('menuitem', { name: 'Trash' }).click()
    await expect(page.getByRole('heading', { name: 'Trash' })).toBeVisible()
    const trashed = page.getByRole('row', { name: /Trash me/ })
    await expect(trashed).toContainText('Notes')
    await accessible(page, 'trash')
    await trashed.getByRole('button', { name: 'Restore' }).click()
    await expect(page.getByText('Restored').first()).toBeVisible()
    await expect(page.getByText('The trash is empty')).toBeVisible()
    expect((await call('GET', `/api/t/alfa/p/com.mosaikit.notes/r/notes/${id}`)).status).toBe(200)

    // deleted again, then for good from the trash
    expect((await call('DELETE', `/api/t/alfa/p/com.mosaikit.notes/r/notes/${id}`)).status).toBeLessThan(300)
    await page.reload()
    await page.getByRole('row', { name: /Trash me/ }).getByRole('button', { name: 'Delete Trash me for good' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByText('The trash is empty')).toBeVisible()
    expect((await call('POST', `/api/t/alfa/trash/${id}/restore`)).status).toBe(404)

    // the Log of the tenant: what happened, failures, the detail of an event, CSV
    await nav(page, 'Log').click()
    await expect(page.getByRole('heading', { name: 'Log' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Deleted for good' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Restored from the trash' }).first()).toBeVisible()
    await accessible(page, 'log')
    await page.getByRole('radio', { name: 'Only failures' }).click()
    await expect(page.getByRole('button', { name: 'Sign-in refused' }).first()).toBeVisible()
    await page.getByRole('radio', { name: 'Everything' }).click()
    await page.getByRole('combobox', { name: 'What', exact: true }).click()
    await page.getByRole('option', { name: 'Items' }).click()
    await page.getByRole('button', { name: 'Moved to the trash' }).first().click()
    const pane = page.getByRole('dialog', { name: 'Moved to the trash' })
    await expect(pane).toContainText('Trash me')
    await accessible(page, 'detail of an event')
    await pane.getByRole('button', { name: 'Only this item' }).click()
    const rows = page.locator('table tbody tr')
    await expect(rows).toHaveCount(5)
    const download = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Export everything as CSV' }).click()
    const file = await download
    const csv = await (await file.createReadStream()).toArray()
    const text = Buffer.concat(csv).toString('utf8')
    expect(text).toContain('resource.purge')
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(6)
    await logout(page)

    // the Log of the platform: every tenant, with the tenant filter
    await adminLogin(page)
    await nav(page, 'Log').click()
    await page.getByRole('combobox', { name: 'Tenant', exact: true }).click()
    // the name in the registry of the tenants (the identity of the tenant may show another one)
    await page.getByRole('option', { name: /Alfa/ }).click()
    await expect(page.getByRole('row', { name: /Deleted for good/ }).first()).toContainText(/Alfa/)
    await accessible(page, 'log of the platform')
    await logout(page)
  })

  test('quotas: set by the Administrator, read by the Tenant Manager, refused at the limit, what is left', async ({ page }) => {
    test.setTimeout(240_000)
    // the Administrator: System › Quotas, then quotas of their own for Beta (people) and Alfa (storage)
    await adminLogin(page)
    await nav(page, 'System').click()
    await section(page, 'Quotas')
    await expect(page.getByText('Quotas of new tenants', { exact: true })).toBeVisible()
    await expect(page.getByText('Capacity of the platform', { exact: true })).toBeVisible()
    await accessible(page, 'system quotas')
    await nav(page, 'Tenants').click()
    await page.getByRole('row', { name: /City of Beta/ }).getByRole('link').first().click()
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Quotas' }).click()
    const people = page.locator('[data-quota="people"]')
    await people.getByRole('button', { name: 'Customize' }).click()
    await people.getByLabel('Quota of the tenant: People').fill('1')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Quotas of the tenant saved').first()).toBeVisible()
    await expect(people).toContainText('Of this tenant')
    await accessible(page, 'quotas of a tenant')
    await nav(page, 'Tenants').click()
    await page.getByRole('row', { name: /City of Alfa/ }).getByRole('link').first().click()
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Quotas' }).click()
    const storage = page.locator('[data-quota="storage"]')
    await storage.getByRole('button', { name: 'Customize' }).click()
    await storage.getByLabel('Quota of the tenant: Storage').fill('1')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Quotas of the tenant saved').first()).toBeVisible()
    await logout(page)

    // the Tenant Manager of Beta: the alert in the sidebar, the quotas read only, the refusal at the limit
    await login(page, 'City of Beta', 'manager', PASSWORD)
    await expect(page.locator('[data-quota-alert="people"]')).toBeVisible()
    await nav(page, 'Usage').click()
    await expect(page.getByText('Managed by the Administrator').first()).toBeVisible()
    await expect(page.locator('[data-quota="people"]')).toContainText(' of 1 · ')
    await expect(page.getByRole('spinbutton')).toHaveCount(0)
    await accessible(page, 'usage quotas')
    await section(page, 'Trend')
    await expect(page.getByRole('img', { name: /People in the last/ })).toBeVisible()
    await accessible(page, 'usage trend')
    await section(page, 'Who uses the most')
    await expect(page.getByText('By person', { exact: true })).toBeVisible()
    await accessible(page, 'usage consumers')
    await section(page, 'Alerts')
    await page.getByRole('switch', { name: 'Forecast' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Alerts saved').first()).toBeVisible()
    await accessible(page, 'usage alerts')
    await nav(page, 'Manage').click()
    await page.getByRole('button', { name: 'New user' }).click()
    const d = page.getByRole('dialog', { name: 'New user' })
    await d.getByLabel('Username').fill('carla')
    await d.getByLabel('Display name').fill('Carla Bianchi')
    await d.getByLabel('Email', { exact: true }).fill('carla@example.org')
    await d.getByLabel('Initial password').fill(PASSWORD)
    await d.getByRole('button', { name: 'Create user' }).click()
    await expect(page.getByText('The tenant has reached one of its quotas').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await nav(page, 'Tenant settings').click()
    await section(page, 'Managed by the platform')
    await expect(page.getByText('People 1').first()).toBeVisible()
    await logout(page)

    // a person of Alfa: their usage and what is left in the tenant
    await login(page, 'Alfa Municipality', 'anna', 'password-e2e-789')
    await page.goto('./#/t/alfa/account/usage')
    await expect(page.getByText('What is left in the tenant', { exact: true })).toBeVisible()
    await expect(page.locator('[data-quota="storage"]')).toContainText('1.0 GB')
    await accessible(page, 'account usage')
    await logout(page)

    // back as before
    await adminLogin(page)
    for (const [tenant, quota] of [['City of Beta', 'people'], ['City of Alfa', 'storage']]) {
      await nav(page, 'Tenants').click()
      await page.getByRole('row', { name: new RegExp(tenant) }).getByRole('link').first().click()
      await page.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Quotas' }).click()
      await page.locator(`[data-quota="${quota}"]`).getByRole('button', { name: 'Restore' }).click()
      await page.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByText('Quotas of the tenant saved').first()).toBeVisible()
    }
  })

})
