import { expect, test, type Page } from '@playwright/test'
import { openPlugin, signIn } from '@mosaikit/plugin-testing'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'

// Embedded pages (docs/architecture.md §8.15; manual checks EMB-01..03) in a real browser: a plugin that declares
// `[permissions] embeds` shows the page `[[embeds]]` of another plugin in a frame of its own page. Two small plugins are made
// at setup in development folders and loaded by a server of its own in the developer profile (as spec 20): the "board"
// (the host) and the "maps" (the provider, whose logic is the proxy of tests/fixtures/embeds/proxy.wat: it runs the SQL the
// page sends it with the rights of the ticket). `cargo xtask e2e` passes the executable in E2E_SERVER_BIN.

const SERVER_BIN = process.env.E2E_SERVER_BIN ?? ''
let PORT = 0
let APP = ''
let PLUGINS = ''
// the developer profile gives each plugin its own origin (a host of its own on the plugin port)
const originOf = (id: string) => `http://${id.replaceAll('.', '-')}.localhost:${PORT + 1}`
const BOARD = 'com.test.embboard'
const MAPS = 'com.test.embmaps'

test.describe.configure({ mode: 'serial' })
test.skip(!SERVER_BIN || !fs.existsSync(SERVER_BIN), 'E2E_SERVER_BIN: the server executable is not available')

let root = ''
let server: ChildProcess | undefined

const common = (id: string, label: string) => `id = "${id}"
name = "${label}"
version = "0.1.0"
description = "Plugin of the test of embedded pages"

[requires]
mosaikit = ">=1.0, <2"
api = 1

[contribution]
icon = "🧪"
label = "${label}"

[ui]
entry = "index.html"
`

const mapsManifest = `${common(MAPS, 'Embed maps')}
[[resources]]
name = "items"
label = "Chart"
title_field = "title"
fields = [{ key = "title", label = "Title", kind = "text", required = true }]

[permissions]
hooks = []
files = false
content = false
network = []
frame_src = []
run_commands = ["info", "other"]

[[embeds]]
name = "viewer"
entry = "embed.html"
contract = "test-embed/1"
resource_kind = "items"
commands = ["info"]
`

const boardManifest = `${common(BOARD, 'Embed board')}
[[resources]]
name = "boards"
label = "Board"
title_field = "title"
fields = [{ key = "title", label = "Title", kind = "text", required = true }, { key = "chart", label = "Chart id", kind = "text" }]

[permissions]
hooks = []
files = false
content = false
network = []
frame_src = []
embeds = ["${MAPS}"]
`

// CSP of a plugin page: no inline script, so the pages and their scripts are files. Module scripts, as the build of a plugin makes
// them: the frame of an embedded page has no origin of its own, and only a script fetched with CORS gets past the
// `cross-origin-resource-policy: same-site` of the files of a UI (a classic script is blocked there).
const page = (title: string, script: string) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>${title}</title><body><h1>${title}</h1><div id="out"></div><script type="module" src="${script}"></script></body></html>`

// The embedded page: it reads its ticket from its address, reads the resource through its own plugin, tries what it must not
// be able to do and tells the host (window.parent.postMessage, under the contract of the embed).
const embedJs = `const q = new URLSearchParams(location.search)
const [ticket, plugin, api] = [q.get('embed'), q.get('plugin'), q.get('api')]
const out = document.getElementById('out')
const line = (id, text) => { const d = document.createElement('div'); d.id = id; d.textContent = text; out.appendChild(d) }
const report = { window_origin: window.origin }
async function call(command, args) {
  const r = await fetch(api + '/api/run/' + ticket + '/call/' + plugin + '/' + command, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args),
  })
  return { status: r.status, body: await r.json() }
}
async function main() {
  try { void window.parent.document.title; report.parent = 'readable' } catch (e) { report.parent = e.name }
  try { void localStorage.length; report.storage = 'readable' } catch (e) { report.storage = e.name }
  try { void document.cookie; report.cookie = 'readable' } catch (e) { report.cookie = e.name }
  line('origin', 'origin ' + window.origin)
  line('parent', 'parent ' + report.parent)
  const ok = await call('info', { op: 'db.query', req: { sql: 'select title from items', params: [] } })
  report.titles = (ok.body.ok || []).map((r) => r.title)
  line('titles', 'titles ' + report.titles.join(','))
  const denied = await call('other', { op: 'db.query', req: { sql: 'select title from items', params: [] } })
  report.denied = denied.body.code
  line('denied', 'denied ' + denied.status + ' ' + denied.body.code)
  const nobody = await fetch(api + '/api/run/' + ticket + '/call/com.mosaikit.notes/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  report.other_plugin = nobody.status
  line('other-plugin', 'other plugin ' + nobody.status)
  window.parent.postMessage({ kind: 'embed-report', report }, '*')
}
main().catch((e) => line('error', 'error ' + e))
`

// The page of the host: it reads its board, asks the platform for the frame of the chart and shows it in a sandboxed frame.
const boardJs = `const pending = new Map()
let n = 0
const out = document.getElementById('out')
const line = (id, text) => { const d = document.createElement('div'); d.id = id; d.textContent = text; out.appendChild(d) }
function call(op, args) {
  return new Promise((resolve, reject) => {
    const id = 'c' + ++n
    pending.set(id, { resolve, reject })
    window.parent.postMessage({ msk: 1, id, op, args }, '*')
  })
}
let frame = null
window.addEventListener('message', (ev) => {
  const m = ev.data
  if (m && m.msk === 1 && pending.has(m.id)) {
    const p = pending.get(m.id)
    pending.delete(m.id)
    if (m.err) p.reject(new Error(m.err + (m.code ? ' [' + m.code + ']' : ''))); else p.resolve(m.ok)
  } else if (m && m.kind === 'embed-report' && frame && ev.source === frame.contentWindow) {
    line('report', JSON.stringify(m.report))
  }
})
async function main() {
  const list = await call('crud.list', { resource: 'boards' })
  const rows = list.rows || list
  const chart = rows[0].values.chart
  const ask = (a) => call('embed.url', a).then((v) => ({ v }), (e) => ({ e: String(e.message) }))
  // refused by the platform: a page that does not exist, a plugin the host does not declare
  line('no-page', 'no-page ' + ((await ask({ plugin: '${MAPS}', name: 'nope', resource: chart })).e || 'allowed'))
  line('no-plugin', 'no-plugin ' + ((await ask({ plugin: 'com.mosaikit.notes', name: 'viewer', resource: chart })).e || 'allowed'))
  const got = await ask({ plugin: '${MAPS}', name: 'viewer', resource: chart })
  if (!got.v) { line('error', 'error ' + got.e); return }
  line('contract', 'contract ' + got.v.contract)
  frame = document.createElement('iframe')
  frame.id = 'emb'
  frame.title = 'Embedded chart'
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.src = got.v.url
  line('frame-url', got.v.url)
  document.body.appendChild(frame)
}
main().catch((e) => line('error', 'error ' + e))
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
    const p = 30000 + Math.floor(Math.random() * 20000)
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

/** A development folder of a plugin: manifest, UI files and, for the maps, the compiled logic where the loader looks for it. */
function makePlugin(dir: string, id: string, manifest: string, files: Record<string, string>, wasm?: Buffer) {
  fs.mkdirSync(path.join(dir, 'ui', 'dist'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'plugin.toml'), manifest)
  fs.writeFileSync(path.join(dir, 'ui', 'dist', 'index.html'), page(id, 'index.js'))
  fs.writeFileSync(path.join(dir, 'ui', 'dist', 'index.js'), '')
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'ui', 'dist', name), content)
  if (wasm) {
    // the loader takes `<crate>.wasm` from the target of the workspace of the folder
    const crate = id.split('.').pop()!
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), `[package]\nname = "${crate}"\nversion = "0.1.0"\n\n[workspace]\n`)
    const target = path.join(dir, 'target', 'wasm32-unknown-unknown', 'debug')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, `${crate}.wasm`), wasm)
  }
}

test.beforeAll(async () => {
  PORT = await freePair()
  APP = `http://127.0.0.1:${PORT}/`
  PLUGINS = `http://127.0.0.1:${PORT + 1}`
  root = fs.mkdtempSync(path.join(process.env.MOSAIKIT_TEMP ?? os.tmpdir(), 'embeds-'))
  const wasm = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'fixtures', 'embeds', 'proxy.wasm'))
  const maps = path.join(root, 'maps')
  const board = path.join(root, 'board')
  makePlugin(maps, MAPS, mapsManifest, { 'embed.html': page('Embedded chart', 'embed.js'), 'embed.js': embedJs }, wasm)
  makePlugin(board, BOARD, boardManifest, { 'index.html': page('Board', 'board.js'), 'board.js': boardJs })
  const toml = (p: string) => `'${p}'`
  fs.writeFileSync(
    path.join(root, 'mosaikit.toml'),
    `url = "http://127.0.0.1:${PORT}"\nlisten = "127.0.0.1:${PORT}"\nplugin_listen = "127.0.0.1:${PORT + 1}"\ndata_dir = ${toml(path.join(root, 'data'))}\ndeveloper_profile = true\n\n[dev]\nplugins = [${toml(maps)}, ${toml(board)}]\n`,
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
  if (root && !process.env.E2E_KEEP_DEV_PROFILE) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 })
})

/** A call to the API with the session of the page. */
async function api(page: Page, method: 'POST' | 'GET', p: string, data?: unknown) {
  const me = (await (await page.request.get(`${APP}api/session`)).json()) as { csrf: string }
  const r = await page.request.fetch(`${APP}${p}`, { method, headers: { 'x-csrf-token': me.csrf }, data })
  expect(r.ok(), await r.text()).toBe(true)
  return (await r.json()) as Record<string, any>
}

test('EMB-01 the board shows the chart of the other plugin in a sandboxed frame, which reads the chart with its ticket', async ({ page }) => {
  await signIn(page, APP, 'alice')
  const chart = await api(page, 'POST', `api/t/dev/p/${MAPS}/r/items`, { values: { title: 'Harbour chart' } })
  await api(page, 'POST', `api/t/dev/p/${MAPS}/r/items`, { values: { title: 'Other chart' } })
  await api(page, 'POST', `api/t/dev/p/${BOARD}/r/boards`, { values: { title: 'Board', chart: chart.id } })

  const host = await openPlugin(page, APP, BOARD)
  // the platform refuses what the board did not declare or the plugin does not offer
  await expect(host.locator('#no-page')).toContainText('[not_found]')
  await expect(host.locator('#no-plugin')).toContainText('[permission_denied]')
  await expect(host.locator('#contract')).toHaveText('contract test-embed/1')

  // the frame: the page of the maps on its origin with the ticket, sandboxed with scripts and nothing else
  const iframe = host.locator('#emb')
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
  const url = new URL((await host.locator('#frame-url').textContent())!)
  expect(url.origin).toBe(originOf(MAPS))
  expect(originOf(MAPS)).not.toBe(originOf(BOARD))
  expect(url.pathname).toBe(`/ui/${MAPS}/embed.html`)
  expect(url.searchParams.get('resource')).toBe(chart.id)
  expect(url.searchParams.get('api')).toBe(new URL(APP).origin)
  expect(url.searchParams.get('embed')).toMatch(/^[0-9a-f]{48}$/)

  // the page loaded and read the chart (only the one of the ticket, not the other one) through its plugin
  const emb = host.frameLocator('#emb')
  await expect(emb.locator('#titles')).toHaveText('titles Harbour chart')
  // it has no origin of its own: it cannot read the page that frames it, nor storage or cookies
  await expect(emb.locator('#origin')).toHaveText('origin null')
  await expect(emb.locator('#parent')).toHaveText('parent SecurityError')
  // and it reached the platform from there: the CSP of its page lets it (connect-src has the origin of the platform)
  const head = await page.request.get(`${PLUGINS}/ui/${MAPS}/embed.html`, { headers: { host: new URL(originOf(MAPS)).host } })
  const csp = head.headers()['content-security-policy'] ?? ''
  expect(csp).toMatch(new RegExp(`connect-src[^;]*${new URL(APP).origin.replace(/[.]/g, '[.]')}`))
  expect(csp).toContain('frame-ancestors')

  // what the frame told the host (it can only post a message): its own report of what it could and could not do
  const report = JSON.parse((await host.locator('#report').textContent())!)
  expect(report).toMatchObject({ window_origin: 'null', parent: 'SecurityError', storage: 'SecurityError', cookie: 'SecurityError', titles: ['Harbour chart'] })
})

test('EMB-03 the ticket of the frame is for its commands and its plugin only', async ({ page }) => {
  // the board and the chart of the first test
  await signIn(page, APP, 'alice')
  const host = await openPlugin(page, APP, BOARD)
  const emb = host.frameLocator('#emb')
  // a command of its plugin outside the embed, and another plugin: refused
  await expect(emb.locator('#denied')).toHaveText('denied 403 run_wrong_command')
  await expect(emb.locator('#other-plugin')).toHaveText('other plugin 403')
  // the same ticket, outside the browser: the commands and plugins it does not name stay closed, a made-up one is no ticket
  const ticket = new URL((await host.locator('#frame-url').textContent())!).searchParams.get('embed')!
  const call = (t: string, plugin: string, cmd: string) =>
    page.request.post(`${APP}api/run/${t}/call/${plugin}/${cmd}`, { data: { op: 'db.query', req: { sql: 'select title from items', params: [] } } })
  expect((await call(ticket, MAPS, 'info')).status()).toBe(200)
  expect((await call(ticket, MAPS, 'other')).status()).toBe(403)
  expect((await call(ticket, BOARD, 'info')).status()).toBe(403)
  const forged = ticket.slice(0, 47) + (ticket.endsWith('0') ? '1' : '0')
  expect((await call(forged, MAPS, 'info')).status()).toBe(401)
})

test('EMB-02 a person who cannot see the chart gets no frame', async ({ page, browser }) => {
  await signIn(page, APP, 'alice')
  const chart = await api(page, 'POST', `api/t/dev/p/${MAPS}/r/items`, { values: { title: 'Private chart' } })
  // bob has the board but the chart is alice's: not found, and no ticket is made
  const ctx = await browser.newContext()
  const bob = await ctx.newPage()
  await signIn(bob, APP, 'bob')
  const me = (await (await bob.request.get(`${APP}api/session`)).json()) as { csrf: string }
  const r = await bob.request.post(`${APP}api/t/dev/p/${BOARD}/embed/url`, {
    headers: { 'x-csrf-token': me.csrf },
    data: { plugin: MAPS, name: 'viewer', resource: chart.id },
  })
  expect(r.status()).toBe(404)
  expect(await r.text()).not.toContain('embed=')
  await ctx.close()
})
