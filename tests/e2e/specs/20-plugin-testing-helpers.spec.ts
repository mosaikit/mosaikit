import { expect, test } from '@playwright/test'
import { expectAccessible, openPlugin, signIn } from '@mosaikit/plugin-testing'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'

// The helpers of `@mosaikit/plugin-testing` (docs/plugin-devkit-plan.md, phase 5; manual check DK-17..20): sign in as a test
// user, open a plugin page and check it with axe, against a server of its own in the developer profile (as spec 18).
// `cargo xtask e2e` passes the executable in E2E_SERVER_BIN.

const SERVER_BIN = process.env.E2E_SERVER_BIN ?? ''
let PORT = 0
let APP = ''
const ID = 'com.test.helpers'

test.describe.configure({ mode: 'serial' })
test.skip(!SERVER_BIN || !fs.existsSync(SERVER_BIN), 'E2E_SERVER_BIN: the server executable is not available')

let root = ''
let folder = ''
let server: ChildProcess | undefined

const manifest = (label: string) => `id = "${ID}"
name = "Helpers"
version = "0.1.0"
description = "Plugin of the test of the plugin-testing helpers"

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
  root = fs.mkdtempSync(path.join(process.env.MOSAIKIT_TEMP ?? os.tmpdir(), 'helpers-'))
  folder = path.join(root, 'plugin')
  fs.mkdirSync(path.join(folder, 'ui', 'dist'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'plugin.toml'), manifest('Helpers'))
  fs.writeFileSync(path.join(folder, 'ui', 'dist', 'index.html'), html('helpers'))
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

test('signIn and openPlugin: a test user reaches the page of the plugin', async ({ page }) => {
  await signIn(page, APP, 'alice')
  const frame = await openPlugin(page, APP, ID)
  await expect(frame.locator('#v')).toHaveText('helpers')
})

test('expectAccessible passes on the shell and on the page of the plugin', async ({ page }) => {
  await signIn(page, APP, 'alice')
  await expectAccessible(page)
  await openPlugin(page, APP, ID)
  await expectAccessible(page)
})

test('expectAccessible fails with the list of the violations', async ({ page }) => {
  await page.setContent('<!doctype html><html lang="en"><title>t</title><main><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></main></html>')
  await expect(expectAccessible(page)).rejects.toThrow(/image-alt/)
})

test('the About dialog of the person menu shows the base the product runs on', async ({ page }) => {
  await signIn(page, APP, 'alice')
  await page.getByRole('button', { name: /person menu/ }).click()
  await page.getByRole('menuitem', { name: 'About' }).click()
  await expect(page.getByRole('dialog')).toContainText('Powered by Mosaikit')
  await expectAccessible(page)
})
