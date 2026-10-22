import { createHmac } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Full scenario in the shell: administrator (second factor, plugins, tenants, top bar, theme)
// -> Tenant Manager (people, theme of the tenant, invitation) -> member (Account, plugin in the iframe,
// sharing, public link, notification of an invitation) -> Tenant Manager (shares, usage).
// Then isolation of the iframe, language, phone, the theme of the sign-in page, a server that does not
// answer, accessibility (axe) and contrast of the themes. The interface is in English (the default).

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password'
const PASSWORD = 'password-e2e-123'
const NEW_PASSWORD = 'password-e2e-456'
// the app is served under a base path (url = "http://127.0.0.1:18080/mosaikit")
const BASE = process.env.E2E_BASE_PATH ?? '/mosaikit'

/** TOTP code (RFC 6238, SHA-1, 6 digits) of a base32 secret. */
function totp(secret: string, step = Math.floor(Date.now() / 30000)): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/\s|=/g, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)))
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', key).update(msg).digest()
  const off = h[h.length - 1] & 0x0f
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

let adminSecret = ''
/** step of the last code used: the server never accepts the same code twice */
let lastStep = 0

/** A code of a step never used before (waits for the next step if needed). */
async function freshCode(page: Page): Promise<string> {
  let step = Math.floor(Date.now() / 30000)
  if (step <= lastStep) {
    await page.waitForTimeout((lastStep + 1) * 30000 - Date.now() + 500)
    step = lastStep + 1
  }
  lastStep = step
  return totp(adminSecret, step)
}

/** English and no state of previous tests. */
async function fresh(page: Page, hash = '') {
  await page.goto('./' + hash)
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('msk_lang', 'en')
  })
  await page.goto('./' + hash)
}

async function login(page: Page, tenant: string, user: string, password: string) {
  await fresh(page)
  await expect(page.getByLabel('Username')).toBeVisible()
  // the menu of the tenants appears only if there is more than one
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

/** Administrator access: the first time it registers the second factor, then it asks for the code. */
async function adminLogin(page: Page) {
  await fresh(page, '#/admin')
  await expect(page.getByRole('heading', { name: 'Administrator access' })).toBeVisible()
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  if (!adminSecret) {
    await expect(page.getByRole('img', { name: 'QR code to scan with the app' })).toBeVisible()
    adminSecret = ((await page.locator('code').first().textContent()) ?? '').replace(/\s/g, '')
    await page.getByLabel('Code shown by the app').fill(await freshCode(page))
    await page.getByRole('button', { name: 'Turn on and sign in' }).click()
    await expect(page.getByLabel('Recovery codes').locator('li')).toHaveCount(10)
    await page.getByRole('button', { name: 'I saved the codes: continue' }).click()
  } else {
    await page.getByLabel('Code', { exact: true }).fill(await freshCode(page))
    await page.getByRole('button', { name: 'Confirm' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible()
}

async function logout(page: Page) {
  await page.getByRole('button', { name: /person menu/ }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
}

/** A tab of Identity and appearance (System or Tenant settings). */
async function appearanceTab(page: Page, tab: string) {
  await page.getByRole('link', { name: 'Identity and appearance' }).click()
  await page.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: tab, exact: true }).click()
}

/** An item of the sidebar (icon bar or open panel). */
const nav = (page: Page, name: string) => page.locator('[data-sidebar="sidebar"]').getByRole('link', { name, exact: true })

async function createTenant(page: Page, slug: string, name: string) {
  await page.getByRole('button', { name: 'New tenant' }).click()
  const d = page.getByRole('dialog', { name: 'New tenant' })
  await d.getByLabel('Identifier').fill(slug)
  await d.getByLabel('Name', { exact: true }).fill(name)
  await d.getByLabel('Username of the Tenant Manager').fill('manager')
  await d.getByLabel('Initial password').fill(PASSWORD)
  await d.getByRole('button', { name: 'Create the tenant' }).click()
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()
}

/** No serious or critical WCAG 2.1 AA violation (axe). */
async function accessible(page: Page, where: string) {
  // toasts fade in and out: measured half-transparent they would fail colour contrast by chance
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('[data-sonner-toaster]').analyze()
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(' ') + ' ' + n.html.slice(0, 300) + ' => ' + n.failureSummary).join(' | ')}`)).toEqual([])
}

test.describe.serial('platform', () => {
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
    await nav(page, 'Tenant').click()
    await createTenant(page, 'alfa', 'City of Alfa')
    await createTenant(page, 'beta', 'City of Beta')
    await page.getByRole('link', { name: 'City of Alfa' }).click()
    await page.getByRole('link', { name: 'Users and managers' }).click()
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
    await d.getByLabel('Initial password').fill(PASSWORD)
    await d.getByRole('button', { name: 'Create user' }).click()
    await expect(page.getByRole('row', { name: /Anna Rossi/ })).toBeVisible()
    // the action bar appears only with a selection
    await expect(page.getByRole('group', { name: 'Actions on the selection' })).toBeHidden()
    await page.getByRole('row', { name: /Anna Rossi/ }).getByRole('checkbox').click()
    await expect(page.getByRole('group', { name: 'Actions on the selection' })).toBeVisible()
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
    await page.getByRole('link', { name: /Pending/ }).click()
    await page.getByRole('button', { name: 'Invite' }).click()
    const inv = page.getByRole('dialog', { name: 'Invite a person of another tenant' })
    await inv.getByLabel('Home tenant').fill('alfa')
    await inv.getByLabel('Username').fill('anna')
    await inv.getByRole('button', { name: 'Send the invitation' }).click()
    await expect(page.getByRole('row', { name: /anna/ })).toBeVisible()
    await logout(page)
  })

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
    await expect(page.getByText('Notes by tag')).toBeVisible()
    await expect(page.getByRole('table', { name: /Notes by tag/ })).toContainText('personal')
    await accessible(page, 'usage')
    await logout(page)
  })

  test('the iframe of the plugin does not reach the app', async ({ page }) => {
    await login(page, 'City of Alfa', 'anna', NEW_PASSWORD)
    await nav(page, 'Notes').click()
    const frameEl = page.locator('iframe.plugin-frame')
    await expect(frameEl).toHaveAttribute('src', new RegExp(`^http://127\\.0\\.0\\.1:18081${BASE}/ui/`))
    const frame = page.frames().find((f) => f.url().includes(`:18081${BASE}/ui/`))!
    // a different origin: no session cookie, no DOM of the parent
    expect(await frame.evaluate(() => document.cookie)).not.toContain('msk_session')
    const parentAccess = await frame.evaluate(() => {
      try {
        return String(window.parent.document.title)
      } catch {
        return 'blocked'
      }
    })
    expect(parentAccess).toBe('blocked')
    // a direct call to the API of the app from the iframe fails (CORS and CSRF)
    const direct = await frame.evaluate(async (base) => {
      try {
        const r = await fetch(`http://127.0.0.1:18080${base}/api/session`, { credentials: 'include' })
        return String(r.status)
      } catch {
        return 'blocked'
      }
    }, BASE)
    expect(direct).toBe('blocked')
    await logout(page)
  })

  test('language: English by default, Italian in the whole frame, translated server errors', async ({ page }) => {
    await fresh(page)
    await page.evaluate(() => localStorage.removeItem('msk_lang'))
    await page.reload()
    // a browser that does not ask for Italian gets English
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await page.getByRole('combobox', { name: 'Language' }).click()
    await page.getByRole('option', { name: 'Italiano' }).click()
    await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'it')
    // the error arrives with its code and reads in the chosen language
    await page.getByRole('combobox', { name: 'Tenant' }).click()
    await page.getByRole('option', { name: 'City of Alfa' }).click()
    await page.getByLabel('Utente').fill('anna')
    await page.getByLabel('Password').fill('wrong-pass-123')
    await page.getByRole('button', { name: 'Accedi' }).click()
    await expect(page.getByRole('alert')).toHaveText('Utente o password non corretti')
    await page.getByLabel('Password').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Accedi' }).click()
    await expect(page.getByText('Il tuo spazio')).toBeVisible()
    await expect(page.getByRole('button', { name: /menu della persona/ })).toBeVisible()
    // no English phrase of the frame left in the page
    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(/\b(Your space|Shared by me|Tenant management|Sign out|Notifications)\b/)
    // the plugin receives the language of the shell, and the texts of its manifest are in Italian:
    // name in the sidebar, title, label of the value of the tag
    await nav(page, 'Note').click()
    const frame = page.frameLocator('iframe.plugin-frame')
    await expect(frame.getByPlaceholder('Filtra…')).toBeVisible()
    await expect(frame.getByRole('heading', { name: 'Note' })).toBeVisible()
    await expect(frame.locator('tbody tr.row', { hasText: 'Meeting minutes' })).toContainText('personale')
  })

  test('phone: the sidebar becomes a drawer', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 820 } })
    const page = await ctx.newPage()
    await login(page, 'City of Alfa', 'manager', PASSWORD)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Open or close the sidebar' }).first().click()
    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    await expect(drawer).toBeVisible()
    await drawer.getByRole('link', { name: 'Manage', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Manage' })).toBeVisible()
    await accessible(page, 'phone')
    await ctx.close()
  })

  test('sign-in: the theme of the tenant as soon as the tenant is known', async ({ page }) => {
    // the platform goes back to the default theme, Beta chooses Tessera for itself
    await adminLogin(page)
    await nav(page, 'System').click()
    await appearanceTab(page, 'Theme and mode')
    await page.getByRole('button', { name: /^Mosaikit/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'mosaikit')
    await logout(page)
    await login(page, 'City of Beta', 'manager', PASSWORD)
    await nav(page, 'Tenant settings').click()
    await appearanceTab(page, 'Theme and mode')
    await page.getByRole('button', { name: /^Tessera/ }).click()
    await expect(page.getByText('Customized', { exact: true })).toBeVisible()
    await logout(page)
    // a first visit: the theme of the platform, then the one of the chosen tenant
    await fresh(page)
    await expect(page.getByRole('combobox', { name: 'Tenant' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'mosaikit')
    await page.getByRole('combobox', { name: 'Tenant' }).click()
    await page.getByRole('option', { name: 'City of Beta' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'tessera')
    await page.getByRole('combobox', { name: 'Tenant' }).click()
    await page.getByRole('option', { name: 'City of Alfa' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'mosaikit')
    // the address names the tenant
    await fresh(page, '#/login/beta')
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'tessera')
  })

  test('sign-in: a server that does not answer is never "no tenant" nor a bare HTTP status', async ({ page }) => {
    await fresh(page)
    await page.route('**/api/auth/tenants', (r) => r.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' }))
    await page.reload()
    await expect(page.getByRole('status').filter({ hasText: 'The server is not responding. Trying again…' })).toBeVisible()
    const text = await page.locator('body').innerText()
    expect(text).not.toContain('502')
    expect(text).not.toContain('HTTP')
    expect(text).not.toContain('No tenant available')
    // the server answers again: the form appears by itself
    await page.unroute('**/api/auth/tenants')
    await expect(page.getByRole('combobox', { name: 'Tenant' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('The server is not responding')).toBeHidden()
  })

  test('themes: contrast of the bar and of the buttons (WCAG AA), light and dark', async ({ page }) => {
    await fresh(page)
    const ratios = await page.evaluate(() => {
      const rgb = (c: string) => {
        const el = document.createElement('i')
        el.style.color = c
        document.body.appendChild(el)
        const m = getComputedStyle(el).color.match(/[\d.]+/g)!.map(Number)
        el.remove()
        return m
      }
      const lum = (c: string) => {
        const [r, g, b] = rgb(c).map((v) => {
          const s = v / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const ratio = (a: string, b: string) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
        return (x + 0.05) / (y + 0.05)
      }
      const root = document.documentElement
      const out: Record<string, number> = {}
      for (const preset of ['mosaikit', 'italia', 'tessera'])
        for (const dark of [false, true]) {
          root.dataset.preset = preset
          root.classList.toggle('dark', dark)
          const v = (n: string) => getComputedStyle(root).getPropertyValue(n).trim()
          const k = `${preset}${dark ? ' dark' : ''}`
          out[`${k}: bar`] = ratio(v('--band-foreground'), v('--band'))
          out[`${k}: button`] = ratio(v('--primary-foreground'), v('--primary'))
          out[`${k}: text`] = ratio(v('--foreground'), v('--background'))
          out[`${k}: secondary text`] = ratio(v('--muted-foreground'), v('--background'))
        }
      return out
    })
    for (const [k, r] of Object.entries(ratios)) expect(r, k).toBeGreaterThanOrEqual(4.5)
  })

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
