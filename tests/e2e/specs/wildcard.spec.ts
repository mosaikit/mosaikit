import { expect, test, type Page } from '@playwright/test'

// One origin per plugin (plugin_url with a wildcard host). `cargo xtask e2e` runs it on a second installation
// (also alone: `cargo xtask e2e --wildcard`), which serves the plugins on http://<plugin>.localhost:<port> and the public links on
// http://public.localhost:<port> (the browser resolves *.localhost to the computer itself), without the
// second factor of the Administrator (it has its own tests in 01-admin-and-manager.spec.ts).

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password'
const PASSWORD = 'password-e2e-123'
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:18080/mosaikit/'
const PORT = new URL(process.env.E2E_PLUGIN_ORIGIN ?? 'http://localhost:18081').port
const BASE = new URL(BASE_URL).pathname.replace(/\/$/, '')
const host = (label: string) => `http://${label}.localhost:${PORT}`

const nav = (page: Page, name: string) => page.locator('[data-sidebar="sidebar"]').getByRole('link', { name, exact: true })

test('every plugin UI has an origin of its own', async ({ page }) => {
  // the tenant, through the API of the Administrator
  const api = page.request
  const admin = await api.post(`${BASE_URL}api/auth/admin/login`, { data: { username: 'admin', password: ADMIN_PASSWORD } })
  expect(admin.ok(), await admin.text()).toBeTruthy()
  const csrf = (await admin.json()).csrf as string
  const t = await api.post(`${BASE_URL}api/admin/tenants`, {
    headers: { 'x-csrf-token': csrf },
    data: { slug: 'wild', name: 'Wild City', manager_username: 'manager', manager_email: 'manager@wild.example.org', manager_password: PASSWORD },
  })
  expect(t.ok(), await t.text()).toBeTruthy()
  await api.post(`${BASE_URL}api/auth/logout`, { headers: { 'x-csrf-token': csrf } })

  await page.goto(BASE_URL)
  await page.evaluate(() => localStorage.setItem('msk_lang', 'en'))
  await page.goto(BASE_URL)
  await page.getByLabel('Username').fill('manager')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: /person menu/ })).toBeVisible()

  // Notes on the host of Notes: it works through the bridge as usual
  await nav(page, 'Notes').click()
  const notesUi = `${host('com-mosaikit-notes')}${BASE}/ui/com.mosaikit.notes/`
  await expect(page.locator('iframe.plugin-frame')).toHaveAttribute('src', new RegExp(`^${notesUi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  const frame = page.frameLocator('iframe.plugin-frame')
  await expect(frame.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible()
  await frame.getByRole('button', { name: /New/ }).first().click()
  await frame.locator('[data-key="title"]').fill('Wildcard note')
  await frame.getByRole('button', { name: 'Save' }).click()
  await expect(frame.locator('.msk-item', { hasText: 'Wildcard note' })).toBeVisible()

  // from the page of Notes, the UI of Tasks is another origin: framed, it cannot be read nor scripted
  const notes = page.frames().find((f) => f.url().startsWith(notesUi))!
  const reach = await notes.evaluate(async (tasks) => {
    const f = document.createElement('iframe')
    f.src = tasks
    document.body.appendChild(f)
    await new Promise((r) => f.addEventListener('load', r, { once: true }))
    try {
      return String(f.contentWindow!.document.title)
    } catch {
      return 'blocked'
    }
  }, `${host('com-mosaikit-tasks')}${BASE}/ui/com.mosaikit.tasks/`)
  expect(reach).toBe('blocked')
  // and the server does not serve the UI of Tasks on the host of Notes
  // (the request goes out of Node, which does not resolve *.localhost: the host name is sent as a header)
  const wrong = await page.request.get(`http://127.0.0.1:${PORT}${BASE}/ui/com.mosaikit.tasks/`, { headers: { host: `com-mosaikit-notes.localhost:${PORT}` } })
  expect(wrong.status()).toBe(404)

  // a public link opens on the public host
  const csrf2 = await page.evaluate(async (base) => (await (await fetch(`${base}api/session`)).json()).csrf as string, BASE_URL)
  const list = await page.request.get(`${BASE_URL}api/t/wild/p/com.mosaikit.notes/r/notes`)
  const rows = ((await list.json()) as { rows: { id: string }[] }).rows
  const link = await page.request.post(`${BASE_URL}api/t/wild/resources/${rows[0].id}/links`, { headers: { 'x-csrf-token': csrf2 }, data: {} })
  expect(link.ok(), await link.text()).toBeTruthy()
  const url = (await link.json()).url as string
  expect(url.startsWith(`${host('public')}${BASE}/p/`)).toBeTruthy()
  const pub = await page.context().newPage()
  await pub.goto(url)
  await expect(pub.getByText('Wildcard note').first()).toBeVisible()
})
