import { expect, test } from '@playwright/test'
import { PASSWORD, BASE, adminLogin, login, logout, nav, accessible } from './support'

// Plugins of a tenant, extension tabs. Runs in order after the previous file (the state of the installation is shared).

test.describe.serial('07-plugins', () => {
  test('plugins: available to a tenant, turned on by its Tenant Manager, an extension and the icons', async ({ page }) => {
    test.setTimeout(240_000)
    // the Administrator: kinds, the page of a plugin, what it asks, its tenants and extensions
    await adminLogin(page)
    await nav(page, 'Plugins').click()
    await expect(page.getByRole('row', { name: /Note review/ })).toContainText('Extension')
    await page.getByRole('radio', { name: /Extensions/ }).click()
    await expect(page.getByRole('row', { name: /Notes/ })).toHaveCount(0)
    await accessible(page, 'plugins, extensions only')
    await page.getByRole('link', { name: /Note review/ }).click()
    await page.getByRole('link', { name: 'What it asks' }).click()
    await expect(page.getByText('What it adds')).toBeVisible()
    await expect(page.getByText('Reviewed', { exact: true })).toBeVisible()
    await accessible(page, 'what a plugin asks')
    await page.goto('./#/admin/plugin/com.mosaikit.notes/extensions')
    await expect(page.getByRole('link', { name: 'Note review' })).toBeVisible()
    // Notes no longer available to Beta: its Tenant Manager is told, its people no longer see it
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: /^Tenants/ }).click()
    await page.getByRole('switch', { name: 'Available to City of Beta' }).click()
    await expect(page.getByText('Availability updated')).toBeVisible()
    await accessible(page, 'tenants of a plugin')
    await page.getByRole('row', { name: /City of Beta/ }).getByRole('link').click()
    await expect(page.getByRole('row', { name: /^Notes/ })).toContainText('not available')
    await accessible(page, 'plugins of a tenant')
    await logout(page)

    await login(page, 'City of Beta', 'manager', PASSWORD)
    await expect(nav(page, 'Notes')).toHaveCount(0)
    await nav(page, 'Plugins').click()
    await expect(page.getByRole('row', { name: /^Notes/ })).toHaveCount(0)
    await expect(page.getByRole('row', { name: /^Note review/ })).toContainText('Turn on Notes first')
    await page.getByRole('button', { name: /^Notifications/ }).click()
    await expect(page.getByRole('dialog')).toContainText('Notes is no longer available to the tenant')
    await page.keyboard.press('Escape')
    await logout(page)

    // the Tenant Manager of Alfa turns Tasks off and on again: the sidebar follows, with the icon of the manifest
    await login(page, 'Alfa Municipality', 'manager', PASSWORD)
    await nav(page, 'Plugins').click()
    await page.getByRole('radio', { name: /Apps/ }).click()
    await accessible(page, 'plugins of the tenant')
    await page.getByRole('switch', { name: 'Tasks on in the tenant' }).click()
    await expect(page.getByText('Turned off for the tenant')).toBeVisible()
    await expect(nav(page, 'Tasks')).toHaveCount(0)
    await page.getByRole('switch', { name: 'Tasks on in the tenant' }).click()
    await expect(nav(page, 'Tasks')).toBeVisible()
    await expect(nav(page, 'Tasks').locator('svg.lucide-square-check-big')).toHaveCount(1)

    // the extension in Notes: its field as a column and in the detail, its action
    await nav(page, 'Notes').click()
    const frame = page.frameLocator('iframe.plugin-frame')
    await expect(frame.getByRole('heading', { name: 'Notes' })).toBeVisible()
    await frame.locator('[data-key="title"]').first().fill('Plan to review')
    await frame.getByRole('button', { name: 'Save' }).click()
    const row = frame.locator('.msk-item', { hasText: 'Plan to review' })
    await expect(row).toBeVisible()
    await expect(frame.locator('fieldset', { hasText: 'Note review' })).toBeVisible()
    await frame.getByRole('button', { name: 'Mark as reviewed' }).click()
    await expect(row).toContainText('✓')
    await expect(frame.locator('[data-ext="com.mosaikit.note-review"][data-key="reviewed_by"]')).toHaveValue(/manager|Manager/)
    await logout(page)

    // back as before: Notes available to Beta
    await adminLogin(page)
    await page.goto('./#/admin/plugin/com.mosaikit.notes/tenants')
    await page.getByRole('row', { name: /City of Beta/ }).getByRole('button', { name: 'Restore' }).click()
    await expect(page.getByRole('switch', { name: 'Available to City of Beta' })).toBeChecked()
  })

  test('the tab of an extension in the detail of a note: its page, its data, the level of the person', async ({ page }) => {
    test.setTimeout(180_000)
    await login(page, 'Alfa Municipality', 'manager', PASSWORD)
    // the extension has pages of its own but it is not an app: not in the sidebar
    await expect(nav(page, 'Note review')).toHaveCount(0)
    await nav(page, 'Notes').click()
    const frame = page.frameLocator('iframe.plugin-frame')
    await frame.getByRole('button', { name: /New/ }).click()
    await frame.locator('[data-key="title"]').first().fill('Note with a tab')
    await frame.getByRole('button', { name: 'Save' }).click()
    const row = frame.locator('.msk-item', { hasText: 'Note with a tab' })
    await expect(row).toBeVisible()
    await expect(frame.getByRole('tablist', { name: 'Sections of the item' })).toBeVisible()
    await frame.getByRole('tab', { name: 'Review' }).click()
    await expect(frame.getByRole('tab', { name: 'Review' })).toHaveAttribute('aria-selected', 'true')

    // the page of the extension, drawn by the host over the tab, in a frame without an origin of its own
    const tabFrame = page.locator('iframe.ext-tab-frame')
    await expect(tabFrame).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox')
    const tab = page.frameLocator('iframe.ext-tab-frame')
    await expect(tab.getByRole('heading', { name: 'Review of «Note with a tab»' })).toBeVisible()
    await expect(tab.getByText('Not reviewed yet')).toBeVisible()
    await tab.getByLabel('Comment (optional)').fill('Looks right')
    await tab.getByRole('button', { name: 'Mark as reviewed' }).click()
    await expect(tab.getByText(/^Reviewed by /)).toBeVisible()
    await expect(tab.getByRole('listitem').filter({ hasText: 'Looks right' })).toBeVisible()
    // the note saw the change: its column shows it
    await expect(row).toContainText('✓')
    await accessible(page, 'tab of an extension')
    // back to the fields of the note: the tab closes
    await frame.getByRole('tab', { name: 'Detail' }).click()
    await expect(tabFrame).toHaveCount(0)
    await expect(frame.locator('[data-key="title"]').first()).toHaveValue('Note with a tab')

    // shared read only with Anna: she sees the reviews, she cannot review
    const shared = await page.evaluate(async ([base, title]) => {
      const s = await (await fetch(`${base}/api/session`)).json()
      const headers = { 'content-type': 'application/json', 'x-csrf-token': s.csrf }
      const notes = await (await fetch(`${base}/api/t/alfa/p/com.mosaikit.notes/r/notes`)).json()
      const note = notes.rows.find((r: { values: { title: string } }) => r.values.title === title)
      const members = await (await fetch(`${base}/api/t/alfa/manage/members`)).json()
      const anna = (Array.isArray(members) ? members : members.members).find((m: { username: string }) => m.username === 'anna')
      const r = await fetch(`${base}/api/t/alfa/resources/${note.id}/grants`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ principal_type: 'user', principal_id: anna.user_id ?? anna.id, level: 'read' }),
      })
      return r.status
    }, [BASE, 'Note with a tab'] as const)
    expect(shared).toBe(200)
    await logout(page)

    await login(page, 'Alfa Municipality', 'anna', 'password-e2e-789')
    await nav(page, 'Notes').click()
    const annaRow = frame.locator('.msk-item', { hasText: 'Note with a tab' })
    await expect(annaRow).toContainText('read only')
    await annaRow.click()
    await frame.getByRole('tab', { name: 'Review' }).click()
    await expect(tab.getByText('only who can edit the note reviews it')).toBeVisible()
    await expect(tab.getByRole('listitem').filter({ hasText: 'Looks right' })).toBeVisible()
    await expect(tab.getByRole('button', { name: 'Mark as reviewed' })).toHaveCount(0)
    await logout(page)
  })

})
