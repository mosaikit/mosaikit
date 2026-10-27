import { expect, test } from '@playwright/test'
import { PASSWORD, NEW_PASSWORD, adminLogin, fresh, login, logout, appearanceTab, nav, accessible } from './support'

// Settings on three levels and the languages of the platform. Runs in order after the previous file (the state of the installation is shared).

test.describe.serial('05-settings', () => {
  test('settings on three levels: platform, tenant, person', async ({ page }) => {
    // two sign-ins of the Administrator: the second may wait for a new code of the second factor
    test.setTimeout(240_000)
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0a7"/></svg>'
    // the Administrator: a stricter minimum, the name of the platform, a logo, the welcome text decided
    // for every tenant, the sites that may embed public pages
    await adminLogin(page)
    await nav(page, 'System').click()
    await page.getByRole('link', { name: 'Passwords and sessions' }).click()
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeHidden()
    await page.getByLabel('Minimum length of the password').fill('12')
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Settings saved').last()).toBeVisible()
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeHidden()
    await accessible(page, 'system, passwords and sessions')

    await appearanceTab(page, 'Identity and texts')
    await page.getByLabel('Upload: Logo for light backgrounds').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) })
    await expect(page.getByText('Image saved').last()).toBeVisible()
    await expect(page.locator('[data-image="logo_light"] img')).toBeVisible()
    // an SVG with a script is refused
    await page.getByLabel('Upload: Logo for dark backgrounds').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg><script>alert(1)</script></svg>') })
    await expect(page.getByText('SVG with scripts or external references: not accepted')).toBeVisible()
    await page.getByLabel('Name', { exact: true }).fill('Atlas Platform')
    await page.getByLabel('Welcome text', { exact: true }).fill('Welcome to the Atlas Platform')
    await page.getByRole('switch', { name: 'Tenants may customize it: Welcome text' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Settings saved').last()).toBeVisible()
    await accessible(page, 'system, identity and texts')

    await page.getByRole('link', { name: 'Embedding' }).click()
    for (const site of ['https://www.alfa.example', 'https://intranet.example']) {
      await page.getByPlaceholder('https://www.example.com').fill(site)
      await page.getByRole('button', { name: 'Add', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Settings saved').last()).toBeVisible()

    await page.getByRole('link', { name: 'Keys of outside services' }).click()
    const tr = page.locator('[data-key="translate"]')
    await tr.getByRole('button', { name: 'Add Translation service' }).click()
    await tr.getByLabel('Key for Translation service').fill('sk-platform-key-7777')
    await tr.getByRole('button', { name: 'Save' }).click()
    await expect(tr).toContainText('••••7777')
    await tr.getByRole('switch', { name: /Shared with every tenant/ }).click()
    await expect(page.getByText('Key shared').last()).toBeVisible()
    expect(await page.locator('body').innerText()).not.toContain('sk-platform-key')
    await accessible(page, 'system, keys')
    await logout(page)

    // the sign-in page: the name of the platform, the welcome text decided by the platform
    await fresh(page)
    await expect(page.getByRole('region', { name: 'Atlas Platform' })).toBeVisible()
    await page.getByRole('combobox', { name: 'Tenant' }).click()
    await page.getByRole('option', { name: 'City of Alfa' }).click()
    await expect(page.getByText('Welcome to the Atlas Platform')).toBeVisible()

    // the Tenant Manager: only stricter than the platform, locks, a name of its own
    await login(page, 'City of Alfa', 'manager', PASSWORD)
    await nav(page, 'Tenant settings').click()
    await page.getByRole('link', { name: 'Passwords and sessions' }).click()
    const min = page.locator('[data-setting="security.password_min"]')
    await expect(min).toContainText('Platform minimum: 12')
    await expect(min).toContainText('Inherited')
    await page.getByLabel('Minimum length of the password').fill('11')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('The tenant may only be stricter than the platform')).toBeVisible()
    await page.getByLabel('Minimum length of the password').fill('14')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Settings saved').last()).toBeVisible()
    await expect(min).toContainText('Customized')
    await min.getByRole('button', { name: 'Restore' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(min).toContainText('Inherited')
    await accessible(page, 'tenant settings, passwords and sessions')

    await page.getByRole('link', { name: 'Managed by the platform' }).click()
    await expect(page.getByText('Welcome text', { exact: true })).toBeVisible()
    await expect(page.getByText('Tenants may not customize it.').first()).toBeVisible()
    await accessible(page, 'tenant settings, managed by the platform')

    await appearanceTab(page, 'Identity and texts')
    await page.getByLabel('Name', { exact: true }).fill('Alfa Municipality')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Settings saved').last()).toBeVisible()
    await page.getByLabel('Upload: Logo for dark backgrounds').setInputFiles({ name: 'alfa.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) })
    await expect(page.getByText('Image saved').last()).toBeVisible()
    await accessible(page, 'tenant settings, identity')
    // the band shows the name of the tenant
    await expect(page.getByText('Alfa Municipality').first()).toBeVisible()

    // the tenant offers one of the platform's sites for embedding
    await page.getByRole('link', { name: 'Embedding' }).click()
    await page.getByRole('checkbox', { name: 'https://www.alfa.example' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Settings saved').last()).toBeVisible()
    await logout(page)

    // its sign-in page: its name and logo
    await fresh(page, '#/login/alfa')
    const hero = page.getByRole('region', { name: 'Alfa Municipality' })
    await expect(hero).toBeVisible()
    await expect(hero.locator('img')).toHaveAttribute('src', /logo\/logo_dark/)

    // a person: a key of their own, masked; the rule of the password of the tenant (the sign-in
    // page lists the tenant with its name of the identity)
    await login(page, 'Alfa Municipality', 'anna', NEW_PASSWORD)
    await page.getByRole('button', { name: /person menu/ }).click()
    await page.getByRole('menuitem', { name: 'Account' }).click()
    await page.getByRole('link', { name: 'Keys', exact: true }).click()
    const mine = page.locator('[data-key="translate"]')
    await expect(mine).toContainText('In use: the key of the platform')
    await mine.getByRole('button', { name: 'Add Translation service' }).click()
    await mine.getByLabel('Key for Translation service').fill('my-own-key-4321')
    await mine.getByRole('button', { name: 'Save' }).click()
    await expect(mine).toContainText('••••4321')
    await expect(mine).toContainText('In use: your key')
    expect(await page.locator('body').innerText()).not.toContain('my-own-key')
    await accessible(page, 'account, keys')
    await page.getByRole('link', { name: 'Sign-in and security' }).click()
    await expect(page.getByText('At least 12 characters, not all the same.')).toBeVisible()
    await logout(page)

    // back to the defaults of the platform (the other tests do not depend on them)
    await adminLogin(page)
    await nav(page, 'System').click()
    await page.getByRole('link', { name: 'Passwords and sessions' }).click()
    await page.getByLabel('Minimum length of the password').fill('10')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Settings saved').last()).toBeVisible()
    await logout(page)
  })

  test('languages of the platform: only English, then both again', async ({ page }) => {
    // two sign-ins of the Administrator: the second may wait for a new code of the second factor
    test.setTimeout(240_000)
    await adminLogin(page)
    await nav(page, 'System').click()
    await appearanceTab(page, 'Languages and formats')
    await page.getByRole('checkbox', { name: 'Italiano' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Settings saved').last()).toBeVisible()
    // one language: nothing to choose in the bar
    await expect(page.getByRole('button', { name: /Language:/ })).toBeHidden()
    await accessible(page, 'system, languages')
    await logout(page)
    // and nothing to choose on the sign-in page, even for a browser that asks for Italian
    await fresh(page)
    await page.evaluate(() => localStorage.setItem('msk_lang', 'it'))
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Language' })).toBeHidden()
    await adminLogin(page)
    await nav(page, 'System').click()
    await appearanceTab(page, 'Languages and formats')
    await page.getByRole('checkbox', { name: 'Italiano' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Settings saved').last()).toBeVisible()
    await expect(page.getByRole('button', { name: /Language:/ })).toBeVisible()
    await logout(page)
  })

})
