import http from 'node:http'
import type { AddressInfo } from 'node:net'
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
  // the menu of the tenants appears once the list has arrived (only when there is more than one)
  const select = page.getByRole('combobox', { name: 'Tenant' })
  await expect(select.or(page.getByText('to the tenant'))).toBeVisible()
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
    await expect(select.or(page.getByText('to the tenant'))).toBeVisible()
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

  test('R1-A-04 static sites by address in a frame, the ones that forbid framing in a new tab, cards and thumbnails', async ({ page, context }) => {
    // two sites of "the Internet" on this computer: one open to framing with an og:image, one that forbids it
    const RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')
    const serve = (headers: Record<string, string>, html: string) =>
      new Promise<http.Server>((resolve) => {
        const srv = http.createServer((req, res) => {
          if (req.url === '/pic.png') {
            res.writeHead(200, { 'content-type': 'image/png' })
            res.end(RED)
            return
          }
          res.writeHead(200, { 'content-type': 'text/html', ...headers })
          res.end(html)
        })
        srv.listen(0, '127.0.0.1', () => resolve(srv))
      })
    const free = await serve({}, '<title>Free page</title><meta property="og:image" content="/pic.png"><h1>Hello from the free site</h1>')
    const closed = await serve({ 'x-frame-options': 'DENY' }, '<title>Closed page</title><h1>Closed site</h1><img src="/pic.png">')
    const tag = Date.now().toString(36)
    const [freeName, closedName] = [`Free ${tag}`, `Closed ${tag}`]
    const addr = (s: http.Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}/`
    try {
      await login(page, BASE_URL, 'City of Beta', 'manager', PASSWORD)
      await nav(page, 'Static sites').click()
      const frame = page.frameLocator('iframe.plugin-frame')
      await expect(frame.getByRole('heading', { name: 'Static sites' })).toBeVisible()
      // cards are the default view
      await expect(frame.locator('.cards')).toBeVisible()

      const create = async (name: string, address: string) => {
        await frame.getByRole('button', { name: '＋ New site' }).click()
        await frame.getByLabel('Web address').check()
        await frame.locator('#msks-name').fill(name)
        await frame.locator('#msks-url').fill(address)
        await frame.getByRole('button', { name: '💾 Save' }).click()
      }

      // a site by address: kept as an address (nothing uploaded), with the og:image as its thumbnail
      await create(freeName, addr(free))
      const card = frame.locator('article.card', { hasText: freeName })
      await expect(card.locator('img.thumb')).toBeVisible()
      await expect(card.locator('.cardmeta')).toContainText('127.0.0.1')
      // opened in the frame of Mosaikit
      await card.getByRole('button', { name: /Open$/ }).click()
      await expect(frame.locator('iframe.sframe').nth(1)).toHaveAttribute('src', addr(free))
      await expect(frame.frameLocator('iframe.sframe').nth(1).getByRole('heading', { name: 'Hello from the free site' })).toBeVisible()
      await frame.getByRole('button', { name: '⬅ List of sites' }).click()

      // a site that forbids framing: created with a warning, opened in a new tab, thumbnail = its first image
      await create(closedName, addr(closed))
      await expect(frame.locator('#msks-name')).toBeHidden()
      await expect(frame.getByRole('status').first()).toContainText('opens in a new tab')
      const closedCard = frame.locator('article.card', { hasText: closedName })
      await expect(closedCard.locator('img.thumb')).toBeVisible()
      const popup = context.waitForEvent('page')
      await closedCard.getByRole('button', { name: /Open$/ }).click()
      expect((await popup).url()).toBe(addr(closed))
      await expect(frame.getByText('does not allow being shown inside Mosaikit')).toBeVisible()
      await frame.getByRole('button', { name: '⬅ List of sites' }).click()

      // the thumbnail uploaded by the person wins over the one of the site
      await frame.locator('article.card', { hasText: freeName }).getByRole('button', { name: /Edit/ }).click()
      const before = await frame.locator('.thumbprev').getAttribute('src')
      await frame.locator('#msks-thumb').setInputFiles({ name: 'mine.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=', 'base64') })
      await expect(frame.locator('.thumbprev')).not.toHaveAttribute('src', before ?? '')
      await frame.getByRole('button', { name: '💾 Save' }).click()
      await expect(frame.locator('article.card', { hasText: freeName }).locator('img.thumb')).toBeVisible()

      // list view with thumbnails
      await frame.getByRole('button', { name: 'List', exact: true }).click()
      await expect(frame.locator('table.msk-table img.thumbsm').first()).toBeVisible()
      await expect(frame.locator('.cards')).toBeHidden()
      await frame.getByRole('button', { name: 'Cards', exact: true }).click()
      await expect(frame.locator('.cards')).toBeVisible()
    } finally {
      free.close()
      closed.close()
    }
  })

  test('R1-A-05 a site uploaded as a zip still opens, with a placeholder thumbnail', async ({ page }) => {
    // a zip with only an index.html, written without compression
    const crc = (b: Buffer) => {
      let c = ~0
      for (const x of b) {
        c ^= x
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
      }
      return ~c >>> 0
    }
    const name = Buffer.from('index.html')
    const body = Buffer.from('<h1>Zip site works</h1>')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc(body), 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc(body), 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(name.length, 28)
    const offset = local.length + name.length + body.length
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(1, 8)
    end.writeUInt16LE(1, 10)
    end.writeUInt32LE(central.length + name.length, 12)
    end.writeUInt32LE(offset, 16)
    const zip = Buffer.concat([local, name, body, central, name, end])

    const zipName = `Zip ${Date.now().toString(36)}`
    await login(page, BASE_URL, 'City of Beta', 'manager', PASSWORD)
    await nav(page, 'Static sites').click()
    const frame = page.frameLocator('iframe.plugin-frame')
    await frame.getByRole('button', { name: '＋ New site' }).click()
    await frame.locator('#msks-name').fill(zipName)
    await frame.locator('input[type=file][accept*=zip]').setInputFiles({ name: 'site.zip', mimeType: 'application/zip', buffer: zip })
    await frame.getByRole('button', { name: '💾 Save' }).click()
    const card = frame.locator('article.card', { hasText: zipName })
    await expect(card.locator('.thumb.placeholder')).toBeVisible()
    await card.getByRole('button', { name: /Open$/ }).click()
    await expect(frame.frameLocator('iframe.sframe').first().getByRole('heading', { name: 'Zip site works' })).toBeVisible()
  })

  test('R1-A-06 a language plugin adds a language to the sign-in page, with the texts of the host', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.evaluate(() => {
      localStorage.clear()
      localStorage.setItem('msk_lang', 'en')
    })
    await page.goto(BASE_URL)
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    // the languages installed as plugins are in the menu
    await page.getByRole('combobox', { name: 'Language' }).click()
    await expect(page.getByRole('option', { name: 'Italiano' })).toBeVisible()
    await page.getByRole('option', { name: 'Español' }).click()
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible()
    await expect(page.getByLabel('Contraseña')).toBeVisible()
    // texts the plugin does not have stay in English; the choice is remembered
    await page.reload()
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible()
    // the list is public: only the languages of plugins, with their texts
    const list = (await (await page.request.get(`${BASE_URL}api/languages`)).json()) as { code: string; name: string }[]
    expect(list).toContainEqual({ code: 'es', name: 'Español' })
    const es = (await (await page.request.get(`${BASE_URL}api/languages/es`)).json()) as { strings: Record<string, string> }
    expect(es.strings['Sign in']).toBe('Iniciar sesión')
    expect((await page.request.get(`${BASE_URL}api/languages/xx`)).status()).toBe(404)
  })
})
