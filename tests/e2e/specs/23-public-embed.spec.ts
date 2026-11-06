import { expect, test, type Page } from '@playwright/test'
import { signIn } from '@mosaikit/plugin-testing'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'

// An embedded page in a PUBLIC LINK view (docs/architecture.md §8.15; manual checks PUBEMB-01..05) in a real browser, with no
// session. Same two development plugins as spec 22, with what a public view needs: the board has a `public_view` page and the
// maps declare `[[public_commands]]`; the tenant allows public commands. The public page of the board runs in a frame of
// the viewer page of the link (`/p/<token>`), which answers its `embed.url` through `POST /p/<token>/embed` and gets a ticket
// `pe.<payload>.<hmac>` tied to the link. The frame of the embedded page is nested in the page of the board.
//
// maps: `info` is in the embed AND public (the only one that runs), `extent` is in the embed but not public, `tiles` is public
// but not in the embed, `other` is neither. The embed `pinned` asks for `same_origin`: a public view never gets it.

const SERVER_BIN = process.env.E2E_SERVER_BIN ?? ''
let PORT = 0
let APP = ''
const BOARD = 'com.test.pubboard'
const MAPS = 'com.test.pubmaps'

test.describe.configure({ mode: 'serial' })
test.skip(!SERVER_BIN || !fs.existsSync(SERVER_BIN), 'E2E_SERVER_BIN: the server executable is not available')

let root = ''
let server: ChildProcess | undefined

const common = (id: string, label: string) => `id = "${id}"
name = "${label}"
version = "0.1.0"
description = "Plugin of the test of embedded pages in a public link"

[requires]
mosaikit = ">=1.0, <2"
api = 1

[contribution]
icon = "🧪"
label = "${label}"
`

const mapsManifest = `${common(MAPS, 'Public maps')}
[ui]
entry = "index.html"

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
run_commands = ["info", "extent", "tiles", "other"]

[[public_commands]]
name = "info"
description = "Reads the charts of the link"

[[public_commands]]
name = "tiles"
description = "Public, but not offered to the embedded page"

[[embeds]]
name = "viewer"
entry = "embed.html"
contract = "test-embed/1"
resource_kind = "items"
commands = ["info", "extent"]

[[embeds]]
name = "pinned"
entry = "embed.html"
contract = "test-embed/1"
resource_kind = "items"
commands = ["info"]
same_origin = true
`

const boardManifest = `${common(BOARD, 'Public board')}
[ui]
entry = "index.html"
public_view = "public.html"

[[resources]]
name = "boards"
label = "Board"
title_field = "title"
fields = [{ key = "title", label = "Title", kind = "text", required = true }, { key = "chart", label = "Chart id", kind = "text" }]

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
embeds = ["${MAPS}"]
`

const page = (title: string, script: string) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>${title}</title><body><h1>${title}</h1><div id="out"></div><script type="module" src="${script}"></script></body></html>`

// The embedded page: it reads its ticket from its address and tries the four commands and another plugin. The button calls `info`
// again (after the link is revoked, or the policy changed) and writes the answer.
const embedJs = `const q = new URLSearchParams(location.search)
const [ticket, plugin, api] = [q.get('embed'), q.get('plugin'), q.get('api')]
const out = document.getElementById('out')
const line = (id, text) => { const d = document.getElementById(id) || document.createElement('div'); d.id = id; d.textContent = text; out.appendChild(d) }
const body = JSON.stringify({ op: 'db.query', req: { sql: 'select title from items', params: [] } })
async function call(command, p) {
  const r = await fetch(api + '/api/run/' + ticket + '/call/' + (p || plugin) + '/' + command, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  let j = {}
  try { j = await r.json() } catch (e) { /* no body */ }
  return { status: r.status, body: j }
}
const code = (r) => r.status + ' ' + (r.body.code || (r.body.ok ? 'ok' : 'error'))
async function main() {
  line('origin', 'origin ' + window.origin)
  line('ticket', 'ticket ' + String(ticket).slice(0, 3))
  const ok = await call('info')
  line('titles', 'titles ' + (ok.body.ok || []).map((r) => r.title).join(',') + ' [' + code(ok) + ']')
  line('extent', 'extent ' + code(await call('extent')))
  line('tiles', 'tiles ' + code(await call('tiles')))
  line('other', 'other ' + code(await call('other')))
  line('notes', 'notes ' + code(await call('info', 'com.mosaikit.notes')))
  const b = document.createElement('button')
  b.id = 'again'
  b.textContent = 'again'
  b.onclick = async () => line('again-result', 'again ' + code(await call('info')))
  document.body.appendChild(b)
}
main().catch((e) => line('error', 'error ' + e))
`

// The public page of the board (it runs in a frame of the viewer of the link): its resource comes from `public.get`, and the
// frames are asked from the platform through the viewer. The frame takes the `sandbox` the platform answers.
const publicJs = `const pending = new Map()
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
window.addEventListener('message', (ev) => {
  const m = ev.data
  if (m && m.msk === 1 && pending.has(m.id)) {
    const p = pending.get(m.id)
    pending.delete(m.id)
    if (m.err) p.reject(new Error(m.err + (m.code ? ' [' + m.code + ']' : ''))); else p.resolve(m.ok)
  }
})
const ask = (a) => call('embed.url', a).then((v) => ({ v }), (e) => ({ e: String(e.message) }))
function show(id, got) {
  const frame = document.createElement('iframe')
  frame.id = id
  frame.title = 'Embedded chart'
  frame.setAttribute('sandbox', got.v.sandbox)
  frame.src = got.v.url
  document.body.appendChild(frame)
}
async function main() {
  const rec = await call('public.get')
  line('title', 'board ' + rec.title)
  const chart = rec.values.chart
  line('no-page', 'no-page ' + ((await ask({ plugin: '${MAPS}', name: 'nope', resource: chart })).e || 'allowed'))
  line('no-plugin', 'no-plugin ' + ((await ask({ plugin: 'com.mosaikit.notes', name: 'viewer', resource: chart })).e || 'allowed'))
  const got = await ask({ plugin: '${MAPS}', name: 'viewer', resource: chart })
  if (!got.v) { line('error', 'error ' + got.e); return }
  line('sandbox', 'sandbox ' + got.v.sandbox)
  line('frame-url', got.v.url)
  show('emb', got)
  const pinned = await ask({ plugin: '${MAPS}', name: 'pinned', resource: chart })
  if (!pinned.v) { line('error', 'error ' + pinned.e); return }
  line('pinned-sandbox', 'pinned-sandbox ' + pinned.v.sandbox)
  show('emb2', pinned)
}
main().catch((e) => line('error', 'error ' + e))
`

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

function makePlugin(dir: string, id: string, manifest: string, files: Record<string, string>, wasm?: Buffer) {
  fs.mkdirSync(path.join(dir, 'ui', 'dist'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'plugin.toml'), manifest)
  fs.writeFileSync(path.join(dir, 'ui', 'dist', 'index.html'), page(id, 'index.js'))
  fs.writeFileSync(path.join(dir, 'ui', 'dist', 'index.js'), '')
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'ui', 'dist', name), content)
  if (wasm) {
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
  root = fs.mkdtempSync(path.join(process.env.MOSAIKIT_TEMP ?? os.tmpdir(), 'pubembed-'))
  const wasm = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'fixtures', 'embeds', 'proxy.wasm'))
  const maps = path.join(root, 'maps')
  const board = path.join(root, 'board')
  makePlugin(maps, MAPS, mapsManifest, { 'embed.html': page('Embedded chart', 'embed.js'), 'embed.js': embedJs }, wasm)
  makePlugin(board, BOARD, boardManifest, { 'index.html': page('Board', 'index.js'), 'public.html': page('Public board', 'public.js'), 'public.js': publicJs })
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
async function api(page: Page, method: 'POST' | 'GET' | 'PUT' | 'DELETE', p: string, data?: unknown) {
  const me = (await (await page.request.get(`${APP}api/session`)).json()) as { csrf: string }
  const r = await page.request.fetch(`${APP}${p}`, { method, headers: { 'x-csrf-token': me.csrf }, data })
  expect(r.ok(), await r.text()).toBe(true)
  const text = await r.text()
  return (text ? JSON.parse(text) : {}) as Record<string, any>
}

const state: { link?: string; linkId?: string; board?: string; chart?: string; other?: string; setup?: boolean } = {}

/** The public view, anonymous: a context of its own with nothing in it. */
async function openPublic(browser: import('@playwright/test').Browser) {
  const ctx = await browser.newContext()
  const pub = await ctx.newPage()
  await pub.goto(state.link!)
  const host = pub.frameLocator('iframe#v')
  return { ctx, pub, host, emb: host.frameLocator('#emb') }
}

/** The policy of the tenant is the Tenant Manager's. */
async function publicCommands(browser: import('@playwright/test').Browser, on: boolean) {
  const ctx = await browser.newContext()
  const m = await ctx.newPage()
  await signIn(m, APP, 'manager')
  const s = await api(m, 'GET', 'api/t/dev/manage/settings')
  s.public_commands_enabled = on
  await api(m, 'PUT', 'api/t/dev/manage/settings', s)
  await ctx.close()
}

test('PUBEMB-01 the public page of a board shows the embedded chart with no sign-in, in a frame without the origin of its plugin', async ({ page, browser }) => {
  await signIn(page, APP, 'alice')
  await publicCommands(browser, true)
  // the chart sits under the board, so the link of the board reaches it; the other chart does not
  state.board = (await api(page, 'POST', `api/t/dev/p/${BOARD}/r/boards`, { values: { title: 'Shared board' } })).id
  state.chart = (await api(page, 'POST', `api/t/dev/p/${BOARD}/r/items`, { values: { title: 'Harbour chart' }, parent: state.board })).id
  state.other = (await api(page, 'POST', `api/t/dev/p/${BOARD}/r/items`, { values: { title: 'Other chart' } })).id
  await api(page, 'POST', `api/t/dev/p/${MAPS}/r/items`, { values: { title: 'Private maps chart' } })
  await api(page, 'PUT', `api/t/dev/p/${BOARD}/r/boards/${state.board}`, { values: { title: 'Shared board', chart: state.chart } })
  const link = await api(page, 'POST', `api/t/dev/resources/${state.board}/links`, {})
  state.link = link.url
  state.linkId = link.id

  const { ctx, pub, host, emb } = await openPublic(browser)
  // no session at all
  expect((await pub.request.get(`${APP}api/session`)).status()).toBeGreaterThanOrEqual(400)
  await expect(host.locator('#title')).toHaveText('board Shared board')
  // the viewer answers `embed.url`: the platform refuses a page that does not exist and a plugin the board does not declare
  await expect(host.locator('#no-page')).toContainText('[not_found]')
  await expect(host.locator('#no-plugin')).toContainText('[permission_denied]')
  const url = new URL((await host.locator('#frame-url').textContent())!)
  expect(url.pathname).toBe(`/ui/${MAPS}/embed.html`)
  expect(url.searchParams.get('resource')).toBe(state.chart)
  expect(url.searchParams.get('embed')).toMatch(/^pe[.][0-9a-f]+[.][0-9a-f]{64}$/)

  // the frame: scripts and nothing else, even for the embed that asks for the origin of its plugin
  await expect(host.locator('#emb')).toHaveAttribute('sandbox', 'allow-scripts')
  await expect(host.locator('#emb2')).toHaveAttribute('sandbox', 'allow-scripts')
  await expect(host.locator('#sandbox')).toHaveText('sandbox allow-scripts')
  await expect(host.locator('#pinned-sandbox')).toHaveText('pinned-sandbox allow-scripts')
  await expect(host.frameLocator('#emb2').locator('#origin')).toHaveText('origin null')
  // the embedded page loaded with the ticket of the link and read the shared tree only
  await expect(emb.locator('#origin')).toHaveText('origin null')
  await expect(emb.locator('#ticket')).toHaveText('ticket pe.')
  // the rows of the maps themselves (alice's charts, which no link shares) stay out of reach of the visitor: the call runs, with no rows
  await expect(emb.locator('#titles')).toHaveText('titles  [200 ok]')
  await ctx.close()
})

/** What the viewer script of the link does for `embed.url`: `POST embed` from the page of the link (its own address, no session). */
const ask = (pub: Page, resource: string, name = 'viewer') =>
  pub.evaluate(
    async ([plugin, n, res]) => {
      const r = await fetch('embed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plugin, name: n, resource: res }) })
      return r.status
    },
    [MAPS, name, resource],
  )

test('PUBEMB-02 a public view cannot ask for a chart outside the link', async ({ browser }) => {
  const { ctx, pub } = await openPublic(browser)
  // the chart under the link is shown; a chart of the same plugin outside it, the board (another kind) and an unknown id are not found
  expect(await ask(pub, state.chart!)).toBe(200)
  expect(await ask(pub, state.other!)).toBe(404)
  expect(await ask(pub, state.board!)).toBe(404)
  expect(await ask(pub, '00000000-0000-4000-8000-000000000000')).toBe(404)
  // the second embed of the maps gets a ticket too (the sandbox it gets is checked in PUBEMB-01)
  expect(await ask(pub, state.chart!, 'pinned')).toBe(200)
  await ctx.close()
})

test('PUBEMB-03 the ticket of a public frame runs only commands that are in the embed and public', async ({ browser }) => {
  const { ctx, host, emb } = await openPublic(browser)
  await expect(emb.locator('#titles')).toContainText('[200 ok]')
  // in the embed, not public / public, not in the embed / neither / another plugin
  await expect(emb.locator('#extent')).toHaveText('extent 403 command_not_public')
  await expect(emb.locator('#tiles')).toHaveText('tiles 403 run_wrong_command')
  await expect(emb.locator('#other')).toHaveText('other 403 run_wrong_command')
  await expect(emb.locator('#notes')).toHaveText('notes 403 run_wrong_plugin')
  // the same ticket outside the browser, and a ticket altered
  const ticket = new URL((await host.locator('#frame-url').textContent())!).searchParams.get('embed')!
  const run = (t: string, cmd: string) =>
    ctx.request.post(`${APP}api/run/${t}/call/${MAPS}/${cmd}`, { data: { op: 'db.query', req: { sql: 'select title from items', params: [] } } }).then((r) => r.status())
  expect(await run(ticket, 'info')).toBe(200)
  expect(await run(ticket, 'extent')).toBe(403)
  expect(await run(ticket.slice(0, -1) + (ticket.endsWith('0') ? '1' : '0'), 'info')).toBe(401)
  await ctx.close()
})

test('PUBEMB-05 the tenant turning public commands off stops the embedded page, and on again restores it', async ({ page, browser }) => {
  await signIn(page, APP, 'alice')
  const { ctx, emb } = await openPublic(browser)
  await expect(emb.locator('#titles')).toContainText('[200 ok]')
  await publicCommands(browser, false)
  await emb.locator('#again').click()
  await expect(emb.locator('#again-result')).toHaveText('again 403 public_commands_off')
  await publicCommands(browser, true)
  await emb.locator('#again').click()
  await expect(emb.locator('#again-result')).toHaveText('again 200 ok')
  await ctx.close()
})

test('PUBEMB-04 once the link is revoked the embedded page stops working and the public page is gone', async ({ page, browser }) => {
  await signIn(page, APP, 'alice')
  const { ctx, pub, emb } = await openPublic(browser)
  await expect(emb.locator('#titles')).toContainText('[200 ok]')
  await api(page, 'DELETE', `api/t/dev/links/${state.linkId}`)
  await emb.locator('#again').click()
  await expect(emb.locator('#again-result')).toHaveText('again 401 run_ticket_invalid')
  // no new frame either, and the page of the link is not valid any more on reload
  expect(await ask(pub, state.chart!)).toBe(404)
  await pub.reload()
  await expect(pub.locator('iframe#v')).toHaveCount(0)
  await ctx.close()
})
