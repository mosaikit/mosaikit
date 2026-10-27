import { expect, test } from '@playwright/test'
import { PASSWORD, NEW_PASSWORD, BASE, APP_ORIGIN, PLUGIN_ORIGIN, adminLogin, fresh, login, logout, appearanceTab, nav, accessible } from './support'

// Shell: plugin iframe isolation, language, phone, sign-in theme, offline server, contrast of the themes. Runs in order after the previous file (the state of the installation is shared).

test.describe.serial('04-shell-appearance', () => {
  test('the iframe of the plugin does not reach the app', async ({ page }) => {
    await login(page, 'City of Alfa', 'anna', NEW_PASSWORD)
    await nav(page, 'Notes').click()
    const frameEl = page.locator('iframe.plugin-frame')
    const uiPrefix = `${PLUGIN_ORIGIN}${BASE}/ui/`
    await expect(frameEl).toHaveAttribute('src', new RegExp(`^${uiPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    // the element gets its src before the frame navigates: wait for the frame itself
    await expect.poll(() => page.frames().some((f) => f.url().startsWith(uiPrefix))).toBe(true)
    const frame = page.frames().find((f) => f.url().startsWith(uiPrefix))!
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
        const r = await fetch(`${base}/api/session`, { credentials: 'include' })
        return String(r.status)
      } catch {
        return 'blocked'
      }
    }, APP_ORIGIN + BASE)
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
    await page.getByRole('combobox', { name: 'Organizzazione' }).click()
    await page.getByRole('option', { name: 'City of Alfa' }).click()
    await page.getByLabel('Utente').fill('anna')
    await page.getByLabel('Password').fill('wrong-pass-123')
    await page.getByRole('button', { name: 'Accedi' }).click()
    await expect(page.getByRole('alert')).toHaveText('Utente o password non corretti')
    await page.getByLabel('Password').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Accedi' }).click()
    await expect(page.getByText('Riprendi da dove eri rimasto')).toBeVisible()
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

})
