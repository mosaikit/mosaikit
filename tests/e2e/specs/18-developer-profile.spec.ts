import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'

// The developer profile (docs/plugin-devkit-plan.md, phase 4; manual checks DK-12..14). The spec starts a
// server of its own in the profile, on SQLite and on a free pair of ports, loads a
// small plugin from a folder and changes the files of the folder while the page is open: the UI, the
// manifest and a migration reload by themselves. `cargo xtask e2e` passes the executable in E2E_SERVER_BIN.

const SERVER_BIN = process.env.E2E_SERVER_BIN ?? ''
let PORT = 0
let APP = ''
const ID = 'com.test.devloop'
const PASSWORD = 'mosaikit-dev'

test.describe.configure({ mode: 'serial' })
test.skip(!SERVER_BIN || !fs.existsSync(SERVER_BIN), 'E2E_SERVER_BIN: the server executable is not available')

let root = ''
let folder = ''
let server: ChildProcess | undefined

const manifest = (label: string) => `id = "${ID}"
name = "Devloop"
version = "0.1.0"
description = "Plugin of the developer profile test"

[requires]
mosaikit = ">=1.0, <2"
api = 1

[contribution]
icon = "🧪"
label = "${label}"

[[resources]]
name = "item"
label = "Item"
title_field = "title"
fields = [{ key = "title", label = "Title", kind = "text", required = true }]

[ui]
entry = "index.html"

[permissions]
hooks = []
files = false
content = false
network = []
frame_src = []
`

// a page that asks the host for the list of its items, as the bridge of the plugin API does (a script of its own: the
// CSP of a plugin page allows no inline script)
const html = (text: string) => `<!doctype html><meta charset="utf-8"><title>devloop</title><h1 id="v">${text}</h1><script src="app.js"></script>`
const script = `window.parent.postMessage({ msk: 1, id: 'c1', op: 'crud.list', args: { resource: 'item' } }, '*')
`

/** A pair of free ports (the app and the plugins), well away from the ones of the run. */
async function freePair(): Promise<number> {
  const free = (port: number) =>
    new Promise<boolean>((resolve) => {
      const s = net.createServer()
      s.once('error', () => resolve(false))
      s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
    })
  for (let i = 0; i < 100; i++) {
    const p = 30000 + Math.floor(Math.random() * 20000) * 1
    if ((await free(p)) && (await free(p + 1))) return p
  }
  throw new Error('no free pair of ports')
}

async function waitHealth(url: string) {
  const end = Date.now() + 80_000
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`the server does not answer on ${url}`)
}

test.beforeAll(async () => {
  PORT = await freePair()
  APP = `http://127.0.0.1:${PORT}/`
  root = fs.mkdtempSync(path.join(process.env.MOSAIKIT_TEMP ?? os.tmpdir(), 'devprofile-'))
  folder = path.join(root, 'plugin')
  fs.mkdirSync(path.join(folder, 'migrations'), { recursive: true })
  fs.mkdirSync(path.join(folder, 'ui', 'dist'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'plugin.toml'), manifest('Devloop'))
  fs.writeFileSync(path.join(folder, 'migrations', '001_counts.sql'), 'create view item_count as select tenant_id, count(*) as n from item group by tenant_id;\n')
  fs.writeFileSync(path.join(folder, 'ui', 'dist', 'index.html'), html('version one'))
  fs.writeFileSync(path.join(folder, 'ui', 'dist', 'app.js'), script)
  const toml = (p: string) => `'${p}'`
  fs.writeFileSync(
    path.join(root, 'mosaikit.toml'),
    `url = "http://127.0.0.1:${PORT}"\nlisten = "127.0.0.1:${PORT}"\nplugin_listen = "127.0.0.1:${PORT + 1}"\ndata_dir = ${toml(path.join(root, 'data'))}\ndeveloper_profile = true\n\n[dev]\nplugins = [${toml(folder)}]\n`,
  )
  const env = { ...process.env }
  for (const k of ['MOSAIKIT_DATABASE_URL', 'DATABASE_URL', 'MOSAIKIT_URL', 'MOSAIKIT_PLUGIN_URL', 'MOSAIKIT_ADMIN_PASSWORD', 'MOSAIKIT_ALLOW_UNSIGNED']) delete env[k]
  server = spawn(SERVER_BIN, ['--config', path.join(root, 'mosaikit.toml'), 'serve'], {
    env,
    stdio: ['ignore', fs.openSync(path.join(root, 'server.log'), 'w'), fs.openSync(path.join(root, 'server.err.log'), 'w')],
  })
  await waitHealth(`${APP}api/health`)
})

test.afterAll(() => {
  server?.kill()
  // the folder of the run goes with it (logs stay when a test failed: they are under MOSAIKIT_TEMP)
  if (root && !process.env.E2E_KEEP_DEV_PROFILE) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 })
})

async function signIn(page: Page, user: string) {
  await page.goto(APP)
  await page.evaluate(() => localStorage.setItem('msk_lang', 'en'))
  await page.goto(APP)
  await page.getByLabel('Username').fill(user)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: /person menu/ })).toBeVisible()
}

test('the banner is there before and after signing in, and the test users are listed', async ({ page }) => {
  await page.goto(APP)
  const banner = page.getByTestId('dev-banner')
  await expect(banner).toContainText('Developer profile')
  await expect(banner).toContainText('alice')
  await expect(banner).toContainText(PASSWORD)
  // the server says it too
  const health = await (await fetch(`${APP}api/health`)).json()
  expect(health.developer).toBe(true)
  await signIn(page, 'alice')
  await expect(page.getByTestId('dev-banner')).toBeVisible()
  // the tenant is reachable: the sample content is there (the welcome notification)
  await page.goto(`${APP}#/t/dev/notifications`)
  await expect(page.getByText('Welcome to the developer profile').first()).toBeVisible()
})

test('the UI, the manifest and the migrations reload from the folder', async ({ page }) => {
  await signIn(page, 'alice')
  await page.goto(`${APP}#/t/dev/p/${ID}`)
  const frame = page.frameLocator('iframe.plugin-frame')
  await expect(frame.locator('#v')).toHaveText('version one')
  // the UI: a file of the folder changes, the frame reloads by itself
  fs.writeFileSync(path.join(folder, 'ui', 'dist', 'index.html'), html('version two'))
  await expect(frame.locator('#v')).toHaveText('version two', { timeout: 20_000 })
  // the manifest as the server reads it follows the file
  await page.getByRole('button', { name: 'Developer tools' }).click()
  const manifestTab = page.getByRole('tab', { name: 'Manifest' })
  await manifestTab.click()
  await expect(page.getByTestId('dev-manifest')).toContainText('"label": "Devloop"')
  fs.writeFileSync(path.join(folder, 'plugin.toml'), manifest('Hot label'))
  await expect(page.getByTestId('dev-manifest')).toContainText('"label": "Hot label"', { timeout: 20_000 })
})

test('host calls with timings and errors, permissions, and the switch of test users', async ({ page }) => {
  await signIn(page, 'alice')
  await page.goto(`${APP}#/t/dev/p/${ID}`)
  await expect(page.frameLocator('iframe.plugin-frame').locator('#v')).toBeVisible()
  await page.getByRole('button', { name: 'Developer tools' }).click()
  await page.getByRole('tab', { name: 'Host calls' }).click()
  const calls = page.getByTestId('dev-calls')
  await expect(calls).toContainText('crud.list')
  await expect(calls.locator('tbody tr').first()).toContainText('ok')
  await page.getByRole('tab', { name: 'Permissions' }).click()
  await expect(page.getByTestId('dev-perms')).toContainText('User')
  // the four test users; Bob signs in without a password
  await page.getByRole('tab', { name: 'Test users' }).click()
  const users = page.getByTestId('dev-users')
  for (const u of ['admin', 'manager', 'alice', 'bob']) await expect(users).toContainText(u)
  await page.getByRole('button', { name: 'Switch to bob' }).click()
  await expect.poll(async () => (await (await page.request.get(`${APP}api/session`)).json()).user?.username).toBe('bob')
  await expect(page.getByTestId('dev-banner')).toBeVisible()
})

test('a changed migration asks before it deletes the data, and the reset button does the same on demand', async ({ page }) => {
  await signIn(page, 'alice')
  await page.goto(`${APP}#/t/dev/p/${ID}`)
  await expect(page.frameLocator('iframe.plugin-frame').locator('#v')).toBeVisible()
  // a migration that ran changes: the reload is refused and the shell asks to run them again
  fs.writeFileSync(path.join(folder, 'migrations', '001_counts.sql'), 'create view item_count as select tenant_id, count(*) + 1 as n from item group by tenant_id;\n')
  const ask = page.getByRole('alertdialog')
  await expect(ask).toContainText('changed after they ran', { timeout: 20_000 })
  await ask.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByText(/Data of .* deleted/).first()).toBeVisible()
  // the reset on demand, with its confirmation (and a no)
  await page.getByRole('button', { name: 'Developer tools' }).click()
  await page.getByRole('tab', { name: 'Data' }).click()
  await page.getByRole('button', { name: 'Reset the data of this plugin' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Reset the data of this plugin' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByText(/Data of .* deleted/).first()).toBeVisible()
})

test('the developer tools open on an empty state while no plugin is open', async ({ page }) => {
  await signIn(page, 'manager')
  await page.getByRole('button', { name: 'Developer tools' }).click()
  await page.getByRole('tab', { name: 'Manifest' }).click()
  await expect(page.getByTestId('dev-panel').getByTestId('empty-compact')).toContainText('Open a plugin')
})
