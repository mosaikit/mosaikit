// The automated twins of docs/manual-tests.md (tests/manual): helpers shared by the checks. One check per id of the
// manual tests; each returns { status, note } and the spec turns it into a Playwright test.
//
// The instance is started and seeded by `cargo xtask manual-tests`, which passes its addresses in the
// environment (E2E_BASE_URL, E2E_PLUGIN_ORIGIN, E2E_IDP_URL) and the folder of the run (MANUAL_RUN_DIR):
// the state shared by the checks (second factor of the Administrator, ids of the seeded people, data one
// check leaves for a later one) lives there in state.json, so it survives a restart of the worker.

import { createHmac, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { chromium, request, type APIRequestContext, type Browser, type BrowserContextOptions, type Frame, type Page } from '@playwright/test'

export const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:18080/mosaikit/'
export const ORIGIN = new URL(BASE).origin
export const PLUGIN_ORIGIN = new URL(process.env.E2E_PLUGIN_ORIGIN ?? 'http://127.0.0.1:18081').origin
export const IDP = new URL(process.env.E2E_IDP_URL ?? 'http://127.0.0.1:18082').origin
/** the port of the app, to recognise its addresses (e.g. after a redirect of the identity provider) */
export const APP_PORT_RE = new RegExp(`:${new URL(BASE).port}\\b`)
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password'
export const PASSWORD = 'password-prova-1'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** the root of the repository (the installation of the run is in `.dev/manual`) */
export const ROOT = path.resolve(HERE, '../..')
/** raw outputs of the run (git-ignored): state, generated fixtures, downloads, Playwright JSON */
export const RUN_DIR = process.env.MANUAL_RUN_DIR ?? path.resolve(HERE, '../results/raw/manual')
/** one screenshot per check */
export const SHOTS = process.env.MANUAL_SHOTS ?? path.resolve(HERE, '../results/raw/manual-screens')
const STATE = path.join(RUN_DIR, 'state.json')
fs.mkdirSync(SHOTS, { recursive: true })

export type Status = 'PASS' | 'FAIL' | 'NOT VERIFIABLE'
export interface Result {
  status: Status
  note?: string
}
export interface Ctx {
  b: Browser
  pages: Record<string, Page>
  /** data one check leaves for a later one (saved in state.json after every check) */
  data: Record<string, any>
}
export interface Check {
  id: string
  run(ctx: Ctx): Promise<Result | void>
}

export function state(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'))
  } catch {
    return {}
  }
}
export function save(s: Record<string, any>) {
  fs.mkdirSync(RUN_DIR, { recursive: true })
  fs.writeFileSync(STATE, JSON.stringify({ ...state(), ...s }, null, 2))
}

/** A small file of tests/fixtures/manual, or a big one generated in the run folder. */
export function fixture(name: string): string {
  const big: Record<string, number> = { 'big.png': 700_000, 'big3mb.bin': 3 * 1024 * 1024 }
  if (name in big) {
    const f = path.join(RUN_DIR, 'fixtures', name)
    if (!fs.existsSync(f)) {
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, name.endsWith('.bin') ? Buffer.alloc(big[name], 7) : randomBytes(big[name]))
    }
    return f
  }
  return path.resolve(HERE, '../fixtures/manual', name)
}
/** A file written by a check (downloads), in the run folder. */
export function out(name: string): string {
  const d = path.join(RUN_DIR, 'files')
  fs.mkdirSync(d, { recursive: true })
  return path.join(d, name)
}

export function totp(secret: string, step = Math.floor(Date.now() / 30000)): string {
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

/** A TOTP code of a step never used before (the server refuses a reused step). */
export async function freshCode(): Promise<string> {
  const s = state()
  let step = Math.floor(Date.now() / 30000)
  if (step <= (s.lastStep ?? 0)) {
    await new Promise((r) => setTimeout(r, (s.lastStep + 1) * 30000 - Date.now() + 600))
    step = s.lastStep + 1
  }
  save({ lastStep: step })
  return totp(s.adminSecret, step)
}

export interface Api {
  ctx: APIRequestContext
  call(method: string, url: string, body?: unknown): Promise<any>
}

/** API session keeping cookies and CSRF. */
export async function api(): Promise<Api> {
  const ctx = await request.newContext({ baseURL: ORIGIN })
  let csrf = ''
  const call = async (method: string, url: string, body?: unknown) => {
    const r = await ctx.fetch(url, {
      method,
      headers: { 'X-CSRF-Token': csrf, 'content-type': 'application/json' },
      data: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await r.text()
    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      /* not JSON */
    }
    if (json && json.csrf) csrf = json.csrf
    if (!r.ok()) throw new Error(`${method} ${url} -> ${r.status()} ${text.slice(0, 300)}`)
    return json
  }
  return { ctx, call }
}

export async function apiAdmin(): Promise<Api> {
  const a = await api()
  const r = await a.call('POST', '/mosaikit/api/auth/admin/login', { username: 'admin', password: ADMIN_PASSWORD })
  if (r.pending === 'totp') await a.call('POST', '/mosaikit/api/auth/totp/verify', { code: await freshCode() })
  else if (r.pending) throw new Error('the second factor of the Administrator is not set up: the seed did not run')
  return a
}

export async function apiUser(tenant: string, username: string, password = PASSWORD): Promise<Api> {
  const a = await api()
  await a.call('POST', '/mosaikit/api/auth/login', { tenant, username, password })
  return a
}

/** Edge on Windows (as the user's browser), Chromium elsewhere or with E2E_CHANNEL=chromium. */
export async function browser(): Promise<Browser> {
  const channel = process.env.E2E_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium')
  const b = await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless: !process.env.E2E_HEADED })
  // every context, also those a check opens itself: a missing element fails the check within seconds
  // instead of waiting for the timeout of the test
  const newContext = b.newContext.bind(b)
  b.newContext = async (o?: BrowserContextOptions) => {
    const c = await newContext(o)
    c.setDefaultTimeout(20_000)
    c.setDefaultNavigationTimeout(30_000)
    return c
  }
  return b
}

export type CPage = Page & { errors: string[] }
/** A page in a fresh context. */
export async function page(b: Browser, opts: BrowserContextOptions = {}): Promise<CPage> {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-US', baseURL: BASE, ...opts })
  const p = (await ctx.newPage()) as CPage
  p.errors = []
  p.on('pageerror', (e) => p.errors.push(e.message))
  return p
}
export async function fresh(p: Page, hash = '', lang = 'en') {
  await p.goto(BASE + hash)
  await p.evaluate((l) => {
    localStorage.clear()
    localStorage.setItem('msk_lang', l)
  }, lang)
  await p.goto(BASE + hash)
  await p.reload()
}
export async function login(p: Page, tenantName: string, user: string, password = PASSWORD, lang = 'en') {
  await fresh(p, '', lang)
  await p.getByLabel(lang === 'it' ? 'Utente' : 'Username').waitFor({ timeout: 20000 })
  const sel = p.getByRole('combobox', { name: 'Tenant' })
  if (await sel.count()) {
    await sel.click()
    await p.getByRole('option', { name: tenantName }).click()
  }
  await p.getByLabel(lang === 'it' ? 'Utente' : 'Username').fill(user)
  await p.getByLabel('Password').fill(password)
  await p.getByRole('button', { name: lang === 'it' ? 'Accedi' : 'Sign in' }).click()
  await p
    .getByRole('button', { name: /person menu|menu della persona|Menu di|Menu of/i })
    .first()
    .waitFor({ timeout: 20000 })
}
export async function adminLogin(p: Page, lang = 'en') {
  await fresh(p, '#/admin', lang)
  await p.getByLabel(lang === 'it' ? 'Utente' : 'Username').waitFor({ timeout: 20000 })
  await p.getByLabel(lang === 'it' ? 'Utente' : 'Username').fill('admin')
  await p.getByLabel('Password').fill(ADMIN_PASSWORD)
  await p.getByRole('button', { name: lang === 'it' ? 'Accedi' : 'Sign in' }).click()
  await p.getByLabel(lang === 'it' ? 'Codice' : 'Code', { exact: true }).fill(await freshCode())
  await p.getByRole('button', { name: lang === 'it' ? 'Conferma' : 'Confirm' }).click()
  await p.getByRole('heading', { name: lang === 'it' ? /Panoramica/ : 'Platform overview' }).waitFor({ timeout: 20000 })
}
export async function shot(p: Page, id: string, opts: { wait?: number; full?: boolean } = {}) {
  await p.waitForTimeout(opts.wait ?? 400)
  await p.screenshot({ path: path.join(SHOTS, `${id}.png`), fullPage: !!opts.full })
}

/** A signed-in page per actor, cached in ctx.pages (admin, or a username). */
export async function as(ctx: Ctx, who: string, lang = 'en'): Promise<CPage> {
  const key = who + ':' + lang
  if (ctx.pages[key] && !ctx.pages[key].isClosed()) return ctx.pages[key] as CPage
  const p = await page(ctx.b)
  const TEN: Record<string, string> = { 'l.verdi': 'Regione Lazio' }
  if (who === 'admin') await adminLogin(p, lang)
  else await login(p, TEN[who] ?? 'Comune di Roma', who, PASSWORD, lang)
  ctx.pages[key] = p
  return p
}

/** Turns a plugin on for Comune di Roma (the Tenant Manager's switch): turning Notes off turns its extension off
 * with it, and an extension that was uninstalled and installed again starts off, so a check that needs the
 * extension makes sure of it. */
export async function ensureOn(...plugins: string[]) {
  const m = await apiUser('comune-roma', 'e.ricci')
  for (const id of plugins) await m.call('PUT', `/mosaikit/api/t/comune-roma/manage/plugins/${id}/on`, { on: true })
}

/** The frame of the plugin UI on the page. */
export async function pluginFrame(p: Page, part = ''): Promise<Frame> {
  for (let i = 0; i < 40; i++) {
    const f = p.frames().find((x) => x.url().startsWith(PLUGIN_ORIGIN + '/') && x.url().includes(part))
    if (f) {
      await f.waitForLoadState('load').catch(() => {})
      await p.waitForTimeout(800)
      return f
    }
    await p.waitForTimeout(500)
  }
  throw new Error('no plugin frame')
}

/** A solid grey PNG (`grey` 0-255), e.g. an image for the band. */
export function png(width: number, height: number, grey: number): Buffer {
  const crc = (b: Buffer) => {
    let c = ~0
    for (const x of b) {
      c ^= x
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    return ~c >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(t))
    return Buffer.concat([len, t, sum])
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0)
  head.writeUInt32BE(height, 4)
  head[8] = 8 // bit depth
  head[9] = 0 // grey
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width, grey)])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
