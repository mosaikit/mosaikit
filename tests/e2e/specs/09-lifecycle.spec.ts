import { expect, test } from '@playwright/test'
import { PASSWORD, BASE, adminLogin, fresh, login, logout, nav, accessible } from './support'

// Lifecycle and operations of a tenant. Runs in order after the previous file (the state of the installation is shared).

test.describe.serial('09-lifecycle', () => {
  test('lifecycle and operations: new tenant in four steps, trial, export, archive, delete, maintenance, backups, monitoring', async ({ page, browser }) => {
    test.setTimeout(300_000)
    await adminLogin(page)
    await nav(page, 'Tenants').click()

    // new tenant in four steps, with a trial period
    await page.getByRole('button', { name: 'New tenant' }).first().click()
    const d = page.getByRole('dialog', { name: 'New tenant' })
    await d.getByLabel('Name', { exact: true }).fill('Town of Delta')
    await expect(d.getByLabel('Identifier')).toHaveValue('town-of-delta')
    await d.getByLabel('Identifier').fill('delta')
    await d.getByRole('switch', { name: 'Trial period' }).click()
    const until = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10)
    await d.getByLabel('End of the trial').fill(until)
    await accessible(page, 'new tenant, step 1')
    await d.getByRole('button', { name: 'Next' }).click()
    await expect(d.getByRole('radio', { name: /Local accounts/ })).toHaveAttribute('aria-checked', 'true')
    await d.getByRole('button', { name: 'Next' }).click()
    await d.getByLabel('Username of the Tenant Manager').fill('boss')
    await d.getByLabel('Email of the Tenant Manager').fill('boss@example.org')
    await d.getByLabel('Initial password').fill(PASSWORD)
    await d.getByRole('button', { name: 'Next' }).click()
    await expect(d).toContainText('The platform prepares by itself')
    await accessible(page, 'new tenant, summary')
    await d.getByRole('button', { name: 'Create the tenant' }).click()
    await expect(page.getByRole('heading', { name: 'Town of Delta', exact: true })).toBeVisible()
    await expect(page.getByText(/on trial until/).first()).toBeVisible()
    await accessible(page, 'tenant details with lifecycle')

    // export: a zip to download
    await page.getByRole('button', { name: 'Export the tenant' }).click()
    const link = page.getByRole('link', { name: /delta-.*\.zip/ })
    await expect(link).toBeVisible()
    const download = page.waitForEvent('download')
    await link.click()
    expect((await download).suggestedFilename()).toMatch(/^delta-.*\.zip$/)

    // archive: confirmed, then reactivated from the menu
    await page.getByRole('button', { name: 'Archive the tenant' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByText('archived', { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Reactivate the tenant' }).click()
    await expect(page.getByText(/on trial until/).first()).toBeVisible()

    // maintenance: the notice for everybody, only the Administrators sign in
    await nav(page, 'System').click()
    await page.getByRole('link', { name: 'Maintenance' }).click()
    await page.getByRole('switch', { name: 'Maintenance mode' }).click()
    await page.getByLabel('Notice for everybody').fill('Upgrade, back at 10')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Maintenance mode is on' })).toBeVisible()
    await accessible(page, 'maintenance')
    const other = await browser.newPage({ baseURL: page.url().replace(/#.*$/, '') })
    await fresh(other)
    await expect(other.getByRole('status').filter({ hasText: 'The platform is under maintenance' })).toContainText('Upgrade, back at 10')
    const select = other.getByRole('combobox', { name: 'Tenant' })
    if (await select.count()) {
      await select.click()
      await other.getByRole('option', { name: 'Town of Delta' }).click()
    }
    await other.getByLabel('Username').fill('boss')
    await other.getByLabel('Password').fill(PASSWORD)
    await other.getByRole('button', { name: 'Sign in' }).click()
    await expect(other.getByText('The platform is under maintenance: only the Administrators sign in')).toBeVisible()
    await page.getByRole('switch', { name: 'Maintenance mode' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Maintenance mode is on' })).toBeHidden()
    await other.getByRole('button', { name: 'Sign in' }).click()
    await expect(other.getByRole('button', { name: /person menu/ })).toBeVisible()
    await other.close()

    // backup: run now, listed, the tenants inside
    await page.getByRole('link', { name: 'Backup and restore' }).click()
    await page.getByRole('button', { name: 'Run now' }).click()
    const done = page.getByRole('row').filter({ hasText: /complete|tenants only/ }).first()
    await expect(done).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('button', { name: 'Run now' })).toBeEnabled()
    await accessible(page, 'backups')
    await done.getByRole('button', { name: 'Restore a tenant' }).click()
    await expect(page.getByRole('dialog', { name: 'Restore a tenant' })).toContainText('Town of Delta')
    await page.keyboard.press('Escape')

    // one item from the backup: deleted for good after it, found by its title, back with its id and the
    // values of its extension (the history of the reviews)
    const mgr = await (await browser.newContext()).newPage()
    await login(mgr, 'Alfa Municipality', 'manager', PASSWORD)
    const manager = async (what: 'delete' | 'check') =>
      mgr.evaluate(
        async ([base, what]) => {
          const s = await (await fetch(`${base}/api/session`)).json()
          const headers = { 'content-type': 'application/json', 'x-csrf-token': s.csrf }
          const notes = await (await fetch(`${base}/api/t/alfa/p/com.mosaikit.notes/r/notes`)).json()
          const note = notes.rows.find((r: { values: { title: string } }) => r.values.title === 'Note with a tab')
          if (what === 'check') {
            if (!note) return 'missing'
            const v = await (await fetch(`${base}/api/t/alfa/p/com.mosaikit.notes/ext/notes/values`, { method: 'POST', headers, body: JSON.stringify({ ids: [note.id] }) })).json()
            return String(v[note.id]?.['com.mosaikit.note-review']?.history ?? '')
          }
          await fetch(`${base}/api/t/alfa/p/com.mosaikit.notes/r/notes/${note.id}`, { method: 'DELETE', headers })
          return String((await fetch(`${base}/api/t/alfa/trash/${note.id}`, { method: 'DELETE', headers })).status)
        },
        [BASE, what] as const,
      )
    expect(await manager('delete')).toBe('200')
    expect(await manager('check')).toBe('missing')
    await done.getByRole('button', { name: 'Restore an item' }).click()
    const ri = page.getByRole('dialog', { name: 'Restore an item' })
    await ri.getByLabel('Tenant').selectOption('alfa')
    await ri.getByLabel('Title').fill('Note with a tab')
    await ri.getByRole('button', { name: 'Search' }).click()
    const line = ri.getByRole('row', { name: /Note with a tab/ })
    await expect(line).toContainText('No longer in the tenant')
    await accessible(page, 'restore an item')
    await line.getByRole('button', { name: 'Restore «Note with a tab»' }).click()
    await ri.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(page.getByText('«Note with a tab» restored')).toBeVisible()
    await expect(line).toContainText('In the tenant')
    expect(await manager('check')).toContain('Looks right')
    // still in the tenant: only as a copy or in place of the current one, by choice
    await line.getByRole('button', { name: 'Restore «Note with a tab»' }).click()
    await expect(ri.getByRole('radio', { name: /As a copy/ })).toBeChecked()
    await expect(ri.getByRole('radio', { name: /In place of the current one/ })).toBeVisible()
    await accessible(page, 'restore an item still in the tenant')
    await ri.getByRole('button', { name: 'Back' }).click()
    await page.keyboard.press('Escape')
    await mgr.close()

    // monitoring: every section
    await nav(page, 'Monitoring').click()
    await expect(page.getByRole('row', { name: /Database/ })).toContainText('ok')
    await accessible(page, 'monitoring status')
    for (const [section, check] of [
      ['Performance', 'Requests'],
      ['Errors', 'Server errors'],
      ['Tenants', 'Town of Delta'],
      ['Capacity', 'Disk of the data'],
      ['Alerts', 'Conditions'],
    ]) {
      await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: section, exact: true }).click()
      await expect(page.getByText(check).first()).toBeVisible()
      await accessible(page, `monitoring ${section}`)
    }

    // delete with the address typed: the tenant is gone
    await nav(page, 'Tenants').click()
    await page.getByRole('link', { name: 'Town of Delta' }).click()
    await page.getByRole('button', { name: 'Delete the tenant' }).click()
    const del = page.getByRole('dialog', { name: 'Delete Town of Delta for good?' })
    await expect(del.getByRole('button', { name: 'Delete for good' })).toBeDisabled()
    await accessible(page, 'delete a tenant')
    await del.getByLabel('Type delta to confirm').fill('delta')
    await del.getByRole('button', { name: 'Delete for good' }).click()
    // the page goes to the list of the tenants once the server has answered: wait for that, or the next goto races it
    await expect(page.getByText('Tenant Town of Delta deleted').first()).toBeVisible()
    await expect(page).toHaveURL(/#\/admin\/tenants$/)
    await expect(page.getByRole('row', { name: /Town of Delta/ })).toBeHidden()
    // the overview: services and to do
    await page.goto('./#/admin')
    await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'To do' })).toBeVisible()
    await accessible(page, 'overview with services')
    await logout(page)
  })

})
