import { expect, test, type Page } from '@playwright/test'

// Review round 1: auth and plugins (docs/manual-tests.md, section "Review round 1 - auth and plugins").
// Runs after platform.spec.ts, which leaves the tenant "City of Beta" with its Tenant Manager `manager`.

const PASSWORD = 'password-e2e-123'
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:18080/mosaikit/'
const nav = (page: Page, name: string) => page.locator('[data-sidebar="sidebar"]').getByRole('link', { name, exact: true })

async function login(page: Page, base: string, tenant: string, user: string, password: string) {
  await page.goto(base)
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('msk_lang', 'en')
  })
  await page.goto(base)
  const select = page.getByRole('combobox', { name: 'Tenant' })
  if (await select.count()) {
    await select.click()
    await page.getByRole('option', { name: tenant }).click()
  }
  await page.getByLabel('Username').fill(user)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: /person menu/ })).toBeVisible()
}

test.describe.serial('review round 1: auth and plugins', () => {
  test('R1-A-01 plugins open when the app is reached by another name of the same computer', async ({ page }) => {
    // the app is configured as http://127.0.0.1:<port>: the same app opened as http://localhost:<port> must
    // still frame the UI of every plugin (the frame was refused: "refused to connect")
    const alias = BASE_URL.replace('127.0.0.1', 'localhost')
    await login(page, alias, 'City of Beta', 'manager', PASSWORD)
    for (const [name, heading] of [['Notes', 'Notes'], ['Tasks', 'Tasks'], ['Files', 'Files'], ['Static sites', 'Static sites'], ['Maps', 'Maps']]) {
      await nav(page, name).click()
      await expect(page.frameLocator('iframe.plugin-frame').getByRole('heading', { name: heading }).first()).toBeVisible()
    }
  })

  test('R1-A-02 email is required for local accounts: the forms mark it and the server refuses without', async ({ page }) => {
    await login(page, BASE_URL, 'City of Beta', 'manager', PASSWORD)
    await nav(page, 'Manage').click()
    await page.getByRole('button', { name: 'New user' }).click()
    const d = page.getByRole('dialog', { name: 'New user' })
    await expect(d.getByLabel('Email', { exact: true })).toHaveAttribute('required', '')
    await d.getByLabel('Username').fill('noemail')
    await d.getByLabel('Initial password').fill(PASSWORD)
    await d.getByRole('button', { name: 'Create user' }).click()
    // the browser stops the form: nothing was created
    await expect(d).toBeVisible()
    await page.keyboard.press('Escape')
    // the API says so as well
    const me = await page.request.get(`${BASE_URL}api/session`)
    const csrf = ((await me.json()) as { csrf: string }).csrf
    const r = await page.request.post(`${BASE_URL}api/t/beta/manage/members`, {
      headers: { 'x-csrf-token': csrf },
      data: { username: 'noemail', password: PASSWORD },
    })
    expect(r.status()).toBe(400)
    expect(await r.text()).toContain('email_required')
  })

  test('R1-A-03 forgot your password: the same answer whatever the account, and what to do without a mail server', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.evaluate(() => {
      localStorage.clear()
      localStorage.setItem('msk_lang', 'en')
    })
    await page.goto(BASE_URL)
    const select = page.getByRole('combobox', { name: 'Tenant' })
    if (await select.count()) {
      await select.click()
      await page.getByRole('option', { name: 'City of Beta' }).click()
    }
    await page.getByRole('button', { name: 'Forgot your password?' }).click()
    for (const who of ['manager', 'nobody-here']) {
      await page.getByLabel('Username or email address').fill(who)
      await page.getByRole('button', { name: 'Send the link' }).click()
      // no mail server in this installation: the page says so, for any name (no user enumeration)
      await expect(page.getByRole('status')).toContainText('cannot send email')
      await page.getByRole('button', { name: /Back to sign-in/ }).click()
      await page.getByRole('button', { name: 'Forgot your password?' }).click()
    }
  })
})
