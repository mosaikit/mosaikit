import { expect, test } from '@playwright/test'
import { PASSWORD, BASE, adminLogin, login, logout, appearanceTab, nav, accessible } from './support'

// Search, help, own profile, QA follow-ups. Runs in order after the previous file (the state of the installation is shared).

test.describe.serial('10-search-profile-qa', () => {
  test('search, help, high contrast and the theme editor', async ({ page }) => {
    // the Tenant Manager of Alfa writes a note only they can see
    await login(page, 'Alfa Municipality', 'manager', PASSWORD)
    await nav(page, 'Notes').click()
    const frame = page.frameLocator('iframe.plugin-frame')
    await expect(frame.getByRole('heading', { name: 'Notes' })).toBeVisible()
    await frame.locator('[data-key="title"]').fill('Quarterly inspection')
    await frame.locator('[data-key="body"]').fill('The pump of the north well needs a new seal')
    await frame.getByRole('button', { name: 'Save' }).click()
    await expect(frame.locator('tbody tr.row', { hasText: 'Quarterly inspection' })).toBeVisible()

    // search with the keyboard ("/"), a word of the text, the pill of the app, arrows and Enter
    await nav(page, 'Tenant overview').click()
    await page.keyboard.press('/')
    const box = page.getByRole('combobox')
    await expect(box).toBeFocused()
    await box.fill('north well')
    const results = page.getByRole('dialog', { name: 'Search results' })
    await expect(results.getByRole('tab', { name: /^Notes/ })).toContainText('1')
    await expect(results.getByRole('option', { name: /Quarterly inspection/ })).toBeVisible()
    await expect(results.getByRole('option', { name: /Quarterly inspection/ })).toContainText('north well')
    await accessible(page, 'search results')
    await results.getByRole('tab', { name: /^Notes/ }).click()
    await box.press('ArrowDown')
    await box.press('Enter')
    await expect(page).toHaveURL(/#\/t\/alfa\/(p\/com\.mosaikit\.notes|item)\//)
    // the last search is remembered
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('option', { name: 'north well' })).toBeVisible()
    await page.keyboard.press('Escape')

    // the guided tour of the Home: a dot on the help until it is seen, then never again
    await nav(page, 'Tenant overview').click()
    const help = page.getByRole('button', { name: 'Help', exact: true })
    await expect(help).toHaveAttribute('data-fresh', 'true')
    await help.click()
    await page.getByRole('menuitem', { name: /Guided tour of this page/ }).click()
    await expect(page.getByRole('dialog').filter({ hasText: 'Step 1 of' })).toBeVisible()
    await accessible(page, 'guided tour')
    for (let i = 0; i < 6 && (await page.getByRole('button', { name: 'Next' }).count()); i++) await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(help).not.toHaveAttribute('data-fresh', 'true')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Help', exact: true })).not.toHaveAttribute('data-fresh', 'true')

    // keyboard shortcuts ("?") and what is new in this version
    await page.keyboard.press('?')
    const keys = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(keys).toContainText('Go to the Home')
    await accessible(page, 'keyboard shortcuts')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    await page.getByRole('menuitem', { name: /What is new/ }).click()
    await expect(page.getByRole('dialog', { name: /What is new/ })).toContainText('The shell')
    await page.keyboard.press('Escape')
    // "g" then "n": the notifications
    await page.keyboard.press('g')
    await page.keyboard.press('n')
    await expect(page).toHaveURL(/#\/t\/alfa\/notifications/)

    // high contrast, for oneself: it stays after a reload
    await page.goto('./#/t/alfa/account/appearance')
    await page.getByRole('switch', { name: 'High contrast' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more')
    await accessible(page, 'high contrast')
    await page.getByRole('switch', { name: 'High contrast' }).click()
    await expect(page.locator('html')).not.toHaveAttribute('data-contrast', 'more')
    await logout(page)

    // Anna does not find the note of the manager
    await login(page, 'Alfa Municipality', 'anna', 'password-e2e-789')
    await page.getByRole('button', { name: /Search everywhere/ }).click()
    await page.getByRole('combobox').fill('north well')
    await expect(page.getByText('No results for «north well».')).toBeVisible()
    await page.keyboard.press('Escape')
    await logout(page)

    // the Administrator makes a theme: pale colours do not read, Save waits for "Fix it for me"
    await adminLogin(page)
    await nav(page, 'System').click()
    await appearanceTab(page, 'Theme and mode')
    await page.getByRole('button', { name: 'New theme' }).click()
    const ed = page.getByRole('dialog', { name: 'New theme' })
    await ed.getByLabel('Name').fill('Lagoon')
    await ed.getByRole('textbox', { name: 'Main colour', exact: true }).fill('#8fd8c8')
    await expect(ed.getByRole('button', { name: 'Save the theme' })).toBeDisabled()
    await ed.getByRole('button', { name: 'Fix it for me' }).click()
    await expect(ed.getByText('Everything reads')).toBeVisible()
    await accessible(page, 'theme editor')
    await ed.getByRole('button', { name: 'Save the theme' }).click()
    await expect(page.getByText('Theme saved: Lagoon').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Lagoon/ }).first()).toBeVisible()
    await logout(page)

    // the Tenant Manager of Alfa uses it for the tenant, then goes back to the theme of the platform
    await login(page, 'Alfa Municipality', 'manager', PASSWORD)
    await nav(page, 'Tenant settings').click()
    await appearanceTab(page, 'Theme and mode')
    await page.getByRole('button', { name: /^Lagoon/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-preset', /^c-/)
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())).not.toBe('#5b5fc7')
    await accessible(page, 'custom theme of the tenant')
    await page.getByRole('button', { name: 'Restore the theme of the platform' }).click()
    await expect(page.locator('html')).not.toHaveAttribute('data-preset', /^c-/)
    await logout(page)
  })

  test('own profile, access requests in the person menu, invite in People, guides and what is new in Italian', async ({ page }) => {
    await login(page, 'Alfa Municipality', 'manager', PASSWORD)
    // the requests to one's own items, from the person menu
    await page.getByRole('button', { name: /person menu/ }).click()
    await page.getByRole('menuitem', { name: 'Access requests' }).click()
    await expect(page.getByRole('heading', { name: 'Access requests' })).toBeVisible()

    // inviting is the main action of People
    await nav(page, 'Manage').click()
    await page.getByRole('button', { name: 'Invite people' }).click()
    await expect(page.getByRole('dialog', { name: 'Invite a person of another tenant' })).toBeVisible()
    await page.keyboard.press('Escape')

    // the own name and picture (a real 1x1 PNG); the band shows them at once
    await page.getByRole('button', { name: /person menu/ }).click()
    await page.getByRole('menuitem', { name: 'Account' }).click()
    await page.getByLabel('Display name').fill('Marta Alfieri')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Name saved').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /person menu/ })).toContainText('Marta Alfieri')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    await page.locator('input[type="file"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png })
    await expect(page.getByText('Picture saved').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /person menu/ }).locator('img')).toBeVisible()
    await page.locator('input[type="file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') })
    await expect(page.getByText(/only SVG, PNG or WebP|Only SVG, PNG or WebP/i).first()).toBeVisible()
    await accessible(page, 'account, profile with a picture')
    await page.getByRole('button', { name: 'Remove the picture' }).click()
    await expect(page.getByRole('button', { name: /person menu/ }).locator('img')).toHaveCount(0)

    // the guides of the roles, inside the app
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Guide of Mosaikit' }).click()
    const guide = page.getByRole('dialog', { name: 'Guide of Mosaikit' })
    await expect(guide.getByRole('heading', { name: /Guide for the Tenant Manager/ })).toBeVisible()
    await guide.getByRole('tab', { name: 'Administrator' }).click()
    await expect(guide.getByRole('heading', { name: /Guide for the Administrator/ })).toBeVisible()
    await accessible(page, 'guide')
    await page.keyboard.press('Escape')

    // in Italian: what is new and the guide in Italian
    await page.evaluate(() => localStorage.setItem('msk_lang', 'it'))
    await page.reload()
    await page.getByRole('button', { name: 'Aiuto', exact: true }).click()
    await page.getByRole('menuitem', { name: /Novità della versione/ }).click()
    await expect(page.getByRole('dialog', { name: /Novità della versione/ })).toContainText('La shell')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Aiuto', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Guida di Mosaikit' }).click()
    await expect(page.getByRole('dialog', { name: 'Guida di Mosaikit' }).getByRole('heading', { name: /Guida per il Tenant Manager/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.evaluate(() => localStorage.setItem('msk_lang', 'en'))
    await page.reload()

  })

  test('QA follow-ups: many people at once, suspended sign-in, Home, mail error, service detail, contact', async ({ page, request }) => {
    await login(page, 'Alfa Municipality', 'manager', PASSWORD)
    // Home: the sections of the mockup and the greeting
    await nav(page, 'Tenant overview').click()
    for (const name of ['Pick up where you left off', 'Due soon', 'For you']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await accessible(page, 'home')

    // CSV: a preview with the problems, then only the good rows are created, with a link each
    await nav(page, 'Manage').click()
    await page.getByRole('button', { name: 'Import from CSV' }).click()
    const imp = page.getByRole('dialog', { name: 'Import from CSV' })
    await imp.getByLabel('CSV file').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from('username,name,email,role\ncarla,Carla Neri,carla@example.org,user\nx y,Bad,,\n') })
    await expect(imp.getByRole('cell', { name: 'Invalid username' })).toBeVisible()
    await accessible(page, 'import dialog')
    await imp.getByRole('button', { name: 'Create 1 people' }).click()
    await expect(imp.getByRole('status')).toContainText('1 done, 0 not done')
    await imp.getByRole('button', { name: 'Close', exact: true }).first().click()
    await expect(page.getByRole('row', { name: /carla/ })).toBeVisible()

    // several invitations: one outcome per line, nothing created for addresses that do not exist
    await page.getByRole('button', { name: 'Invite several people' }).click()
    const inv = page.getByRole('dialog', { name: 'Invite several people' })
    await inv.getByLabel('People', { exact: true }).fill('nobody\nghost@alfa')
    await inv.getByRole('button', { name: 'Send 2 invitations' }).click()
    await expect(inv.getByRole('status')).toContainText('0 done, 2 not done')
    await inv.getByRole('button', { name: 'Close', exact: true }).first().click()

    // suspended in the only tenant: no sign-in, with its own code and never a raw error; then back
    await page.getByRole('button', { name: 'Actions for anna' }).click()
    await page.getByRole('menuitem', { name: 'Suspend in the tenant' }).click()
    await expect(page.getByText('Suspended in the tenant').first()).toBeVisible()
    // anna is also a guest of another tenant: the session opens and holds only that one; the home tenant
    // is not offered (a separate client, so the session of the manager stays)
    const resp = await request.post(BASE + '/api/auth/login', { data: { tenant: 'alfa', username: 'anna', password: 'password-e2e-789' } })
    expect(resp.status()).toBe(200)
    const me = await (await request.get(BASE + '/api/session')).json()
    expect(me.memberships.map((m: { slug: string }) => m.slug)).not.toContain('alfa')
    await page.getByRole('button', { name: 'Actions for anna' }).click()
    await page.getByRole('menuitem', { name: 'Reactivate in the tenant' }).click()
    await expect(page.getByText('Active again').first()).toBeVisible()

    // Monitoring: the mail server is not set or down, with a side panel for the row
    await logout(page)
    await adminLogin(page)
    await nav(page, 'Monitoring').click()
    await page.getByRole('button', { name: 'Emails' }).click()
    const side = page.getByRole('dialog', { name: 'Emails' })
    await expect(side).toContainText('Waiting in the queue')
    await accessible(page, 'monitoring side panel')
    await page.keyboard.press('Escape')

    // details of a tenant: contact person and registration data
    await nav(page, 'Tenants').click()
    await page.getByRole('row', { name: /City of Alfa/ }).getByRole('link').first().click()
    await page.getByLabel('Contact person').fill('Maria Bianchi')
    await page.getByLabel('Registration data (VAT number, tax code)').fill('IT01234567890')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Details saved').first()).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Contact person')).toHaveValue('Maria Bianchi')
    await logout(page)
  })

})
