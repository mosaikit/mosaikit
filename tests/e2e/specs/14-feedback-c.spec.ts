import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test, type Page } from '@playwright/test'
import { ADMIN_PASSWORD, PASSWORD, adminLogin, freshCode, login, nav } from './support'

// Feedback C (docs/manual-tests.md, section "Feedback C"): email of the Administrators, brochure of the plugins,
// the mail server page, the translation of a note with a key of an outside service. Runs after the files before it:
// the tenant "City of Beta" and its Tenant Manager `manager` exist, and the Administrator has an email
// (`MOSAIKIT_ADMIN_EMAIL` of `cargo xtask e2e`).

async function api(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ([m, p, b]) => {
      const s = await (await fetch('api/session')).json()
      const r = await fetch(p as string, { method: m as string, headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrf }, body: b === undefined ? undefined : JSON.stringify(b) })
      return { status: r.status, json: await r.json().catch(() => null) }
    },
    [method, path, body] as const,
  )
}

const PLUGINS = ['notes', 'tasks', 'maps', 'static-site', 'files', 'contacts', 'note-review', 'layout-project', 'layout-suite', 'layout-tabs', 'layout-workspace', 'lang-es']

test.describe.serial('14-feedback-c', () => {
  test('FC: administrators, brochure, mail server, translation', async ({ page, browser }) => {
    test.setTimeout(420_000)
    await adminLogin(page)

    await test.step('FC-01 the Administrator has an email and changes it from Account with the password and a code', async () => {
      await page.getByRole('button', { name: /person menu/ }).click()
      await page.getByRole('menuitem', { name: 'Account' }).click()
      await expect(page.locator('#me-email')).toHaveText('admin@example.test')
      const dlg = page.getByRole('dialog', { name: 'Your email address' })
      await page.getByRole('button', { name: 'Change email' }).click()
      await dlg.getByLabel('Email').fill('root@example.test')
      await dlg.getByLabel('Current password').fill('wrong-password-1')
      await dlg.getByLabel('Code of the authenticator app').fill(await freshCode(page))
      await dlg.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByText('The current password is not correct').first()).toBeVisible()
      await dlg.getByLabel('Current password').fill(ADMIN_PASSWORD)
      await dlg.getByLabel('Code of the authenticator app').fill(await freshCode(page))
      await dlg.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByText('Email saved').first()).toBeVisible()
      await expect(page.locator('#me-email')).toHaveText('root@example.test')
    })

    await test.step('FC-02 an Administrator edits another Administrator; email required and unique', async () => {
      await page.goto('./#/admin/system/admins')
      await page.getByRole('button', { name: 'New Administrator' }).click()
      const created = page.getByRole('dialog', { name: 'New Administrator' })
      await expect(created.getByLabel('Email')).toBeVisible()
      await created.getByLabel('Username').fill('bis')
      await created.getByLabel('Name', { exact: true }).fill('Bis Admin')
      await created.getByLabel('Email').fill('root@example.test')
      await created.getByLabel('Initial password').fill('password-e2e-123')
      await created.getByRole('button', { name: 'Create' }).click()
      await expect(page.getByText('already used by another account').first()).toBeVisible()
      await created.getByLabel('Email').fill('bis@example.test')
      await created.getByRole('button', { name: 'Create' }).click()
      await expect(page.getByRole('row', { name: /bis/ })).toContainText('bis@example.test')
      // the other Administrator's row: name and email, the email refused when another account has it
      const bis = page.getByRole('row', { name: /bis/ })
      await bis.getByRole('button', { name: /Actions for/ }).click()
      await page.getByRole('menuitem', { name: 'Edit name and email' }).click()
      const dlg = page.getByRole('dialog', { name: /Data of/ })
      await dlg.getByLabel('Email').fill('root@example.test')
      await dlg.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByText('already used by another account').first()).toBeVisible()
      await dlg.getByLabel('Name', { exact: true }).fill('Bis Admin Two')
      await dlg.getByLabel('Email').fill('bis2@example.test')
      await dlg.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByRole('row', { name: /Bis Admin Two/ })).toContainText('bis2@example.test')
      // the email of an Administrator cannot be emptied
      await bis.getByRole('button', { name: /Actions for/ }).click()
      await page.getByRole('menuitem', { name: 'Edit name and email' }).click()
      await dlg.getByLabel('Email').fill('')
      await dlg.getByRole('button', { name: 'Save' }).click()
      await expect(dlg).toBeVisible()
      expect(await dlg.getByLabel('Email').evaluate((e: HTMLInputElement) => e.validity.valueMissing)).toBe(true)
      await page.keyboard.press('Escape')
    })

    await test.step('FC-04 the brochure: gallery, lightbox, phone width', async () => {
      await page.goto('./#/admin/plugin/com.mosaikit.notes')
      const brochure = page.getByTestId('plugin-brochure')
      await expect(brochure.getByRole('heading', { name: 'Notes', level: 2 })).toBeVisible()
      await expect(brochure).toContainText('Publisher')
      await expect(brochure).toContainText('Permissions and requirements')
      await page.getByRole('button', { name: 'Enlarge the picture' }).click()
      const box = page.getByTestId('plugin-lightbox')
      await expect(box.locator('img')).toBeVisible()
      await expect(box).toContainText('Picture 1 of 3')
      await page.keyboard.press('ArrowRight')
      await expect(box).toContainText('Picture 2 of 3')
      await page.keyboard.press('Escape')
      await expect(box).toHaveCount(0)
      // every official plugin: pictures that load, and nothing wider than the screen at phone width
      await page.setViewportSize({ width: 390, height: 844 })
      for (const id of PLUGINS) {
        await page.goto(`./#/admin/plugin/com.mosaikit.${id}`)
        await expect(page.getByTestId('plugin-brochure')).toBeVisible()
        const pic = page.getByTestId('plugin-gallery').locator('img').first()
        await expect(pic, id).toBeVisible()
        expect(await pic.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), id).toBe(true)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${id} fits the phone width`).toBe(true)
      }
      // light and dark, desktop and phone: pictures of the page kept with the results of the run
      for (const mode of ['light', 'dark']) {
        await page.evaluate((m) => {
          const t = JSON.parse(localStorage.getItem('msk_theme') ?? '{}')
          t.mode = m
          localStorage.setItem('msk_theme', JSON.stringify(t))
        }, mode)
        for (const [w, h] of [[1280, 900], [390, 844]]) {
          await page.setViewportSize({ width: w, height: h })
          await page.goto('./#/admin/plugin/com.mosaikit.notes')
          await page.reload()
          await expect(page.getByTestId('plugin-brochure')).toBeVisible()
          await page.waitForTimeout(500)
          await page.screenshot({ path: test.info().outputPath(`brochure-${mode}-${w}.png`), fullPage: true })
        }
      }
      await page.evaluate(() => {
        const t = JSON.parse(localStorage.getItem('msk_theme') ?? '{}')
        t.mode = 'light'
        localStorage.setItem('msk_theme', JSON.stringify(t))
      })
      await page.setViewportSize({ width: 1280, height: 720 })
    })

    await test.step('FC-05 the mail server page tells what is missing and how to set it up', async () => {
      const r = await api(page, 'PUT', 'api/admin/email', { host: '', port: 587, security: 'starttls', username: '', sender: '', footer: '' })
      expect(r.status).toBe(200)
      await page.goto('./#/admin/system/email')
      await page.reload()
      const setup = page.getByTestId('mail-setup')
      await expect(setup).toContainText('Missing: the SMTP server, the sender')
      await expect(page.getByText('Available once the mail server is saved.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Send a test' })).toBeDisabled()
      await setup.getByRole('button', { name: 'Set up' }).click()
      await expect(page.getByLabel('SMTP server')).toBeFocused()
      await setup.getByRole('button', { name: 'Fill in for a local test server' }).click()
      await expect(page.getByLabel('SMTP server')).toHaveValue('localhost')
      await expect(page.getByLabel('Port', { exact: true })).toHaveValue('1025')
      await expect(setup).toContainText('--profile mail')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByText('Ready', { exact: true })).toBeVisible()
      await expect(page.getByTestId('mail-setup')).toHaveCount(0)
    })

    await test.step('FC-06 Notes translates a note with the key and the address of the service', async () => {
      // a translation service of the test: records the requests, answers like LibreTranslate
      const seen: { auth: string | undefined; body: string }[] = []
      const server = http.createServer((req, res) => {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          seen.push({ auth: req.headers.authorization, body })
          res.setHeader('content-type', 'application/json')
          const q: string[] = JSON.parse(body).q
          res.end(JSON.stringify({ translatedText: q.map((x) => `[it] ${x}`) }))
        })
      })
      await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
      const port = (server.address() as AddressInfo).port
      try {
        const mgr = await browser.newPage({ baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:18080/mosaikit/' })
        await login(mgr, 'City of Beta', 'manager', PASSWORD)
        await nav(mgr, 'Notes').click()
        const frame = mgr.frameLocator('iframe.plugin-frame')
        await expect(frame.getByRole('heading', { name: 'Notes' })).toBeVisible()
        await frame.locator('[data-key="title"]').fill('Good news')
        await frame.locator('[data-key="body"]').fill('The park opens on Monday')
        await frame.getByRole('button', { name: 'Save' }).click()
        await frame.locator('tbody tr.row', { hasText: 'Good news' }).click()
        // no key yet: a clear message, and nothing was sent
        await frame.getByRole('button', { name: 'Translate note' }).click()
        await expect(frame.getByText('No translation key is set')).toBeVisible()
        expect(seen).toHaveLength(0)

        // the Administrator sets the key and the address (shared with the tenants)
        expect((await api(page, 'PUT', 'api/admin/keys/translate', { value: 'sk-e2e-translate', shared: true })).status).toBe(200)
        expect((await api(page, 'PUT', 'api/admin/keys/translate-endpoint', { value: `http://127.0.0.1:${port}`, shared: true })).status).toBe(200)
        await frame.getByRole('button', { name: 'Translate note' }).click()
        await expect(frame.getByText('[it] The park opens on Monday')).toBeVisible()
        await expect(frame.getByText('[it] Good news')).toBeVisible()
        expect(seen).toHaveLength(1)
        expect(seen[0].auth).toBe('Bearer sk-e2e-translate')
        expect(JSON.parse(seen[0].body)).toMatchObject({ q: ['Good news', 'The park opens on Monday'], target: 'en' })
        // the key never reached the browser of the Tenant Manager
        expect(await mgr.content()).not.toContain('sk-e2e-translate')
        await mgr.close()
      } finally {
        await new Promise((ok) => server.close(ok))
        await api(page, 'DELETE', 'api/admin/keys/translate')
        await api(page, 'DELETE', 'api/admin/keys/translate-endpoint')
      }
    })
  })
})
