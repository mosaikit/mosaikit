import fs from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

// Helpers shared by the spec files (one per area, run in order by one worker: see playwright.config.ts).

export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password'
export const PASSWORD = 'password-e2e-123'
export const NEW_PASSWORD = 'password-e2e-456'
// the app is served under a base path (url = "http://127.0.0.1:18080/mosaikit"); `cargo xtask e2e` picks the
// first free pair of ports and passes them in E2E_BASE_URL and E2E_PLUGIN_ORIGIN
export const BASE = process.env.E2E_BASE_PATH ?? '/mosaikit'
export const APP_ORIGIN = new URL(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:18080/mosaikit/').origin
export const PLUGIN_ORIGIN = new URL(process.env.E2E_PLUGIN_ORIGIN ?? 'http://127.0.0.1:18081').origin

/** TOTP code (RFC 6238, SHA-1, 6 digits) of a base32 secret. */
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

// The second factor of the administrator is registered once per run (global-setup.ts empties this file);
// it is kept on disk so that it survives the restart of the worker after a failed test.
export const ADMIN_STATE = path.join(import.meta.dirname, '..', 'test-results', 'admin-state.json')
function loadAdmin(): { secret: string; step: number } {
  try {
    return JSON.parse(fs.readFileSync(ADMIN_STATE, 'utf8'))
  } catch {
    return { secret: '', step: 0 }
  }
}
function saveAdmin(secret: string, step: number) {
  fs.mkdirSync(path.dirname(ADMIN_STATE), { recursive: true })
  fs.writeFileSync(ADMIN_STATE, JSON.stringify({ secret, step }))
}
let adminSecret = loadAdmin().secret
/** step of the last code used: the server never accepts the same code twice */
let lastStep = loadAdmin().step

/** A code of a step never used before (waits for the next step if needed). */
export async function freshCode(page: Page): Promise<string> {
  let step = Math.floor(Date.now() / 30000)
  if (step <= lastStep) {
    await page.waitForTimeout((lastStep + 1) * 30000 - Date.now() + 500)
    step = lastStep + 1
  }
  lastStep = step
  saveAdmin(adminSecret, step)
  return totp(adminSecret, step)
}

/** English and no state of previous tests. */
export async function fresh(page: Page, hash = '') {
  await page.goto('./' + hash)
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('msk_lang', 'en')
  })
  await page.goto('./' + hash)
}

export async function login(page: Page, tenant: string, user: string, password: string) {
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
export async function adminLogin(page: Page) {
  await fresh(page, '#/admin')
  await expect(page.getByRole('heading', { name: 'Administrator access' })).toBeVisible()
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  const first = !adminSecret
  if (first) {
    await expect(page.getByRole('img', { name: 'QR code to scan with the app' })).toBeVisible()
    adminSecret = ((await page.locator('code').first().textContent()) ?? '').replace(/\s/g, '')
    saveAdmin(adminSecret, lastStep)
    await page.getByLabel('Code shown by the app').fill(await freshCode(page))
    await page.getByRole('button', { name: 'Turn on and sign in' }).click()
    await expect(page.getByLabel('Recovery codes').locator('li')).toHaveCount(10)
    await page.getByRole('button', { name: 'I saved the codes: continue' }).click()
  } else {
    await page.getByLabel('Code', { exact: true }).fill(await freshCode(page))
    await page.getByRole('button', { name: 'Confirm' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible()
  // the platform offers exactly the languages it names: the one of the language plugin is named once for the whole run
  if (first) {
    const status = await page.evaluate(async () => {
      const s = await (await fetch('api/session')).json()
      const r = await fetch('api/admin/settings', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrf }, body: JSON.stringify({ values: { 'lang.enabled': ['en', 'it', 'es'] } }) })
      return r.status
    })
    expect(status).toBe(200)
  }
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /person menu/ }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
}

/** A tab of Identity and appearance (System or Tenant settings). */
export async function appearanceTab(page: Page, tab: string) {
  await page.getByRole('link', { name: 'Identity and appearance' }).click()
  await page.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: tab, exact: true }).click()
}

/** A section of a page with sections (Usage, System, Tenant settings…). */
export async function section(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name, exact: true }).click()
}

/** An item of the sidebar (icon bar or open panel). */
export const nav = (page: Page, name: string) => page.locator('[data-sidebar="sidebar"]').getByRole('link', { name, exact: true })

/** "New tenant" in its four steps (local sign-in, no trial); back on the list of the tenants. */
export async function createTenant(page: Page, slug: string, name: string) {
  await page.getByRole('button', { name: 'New tenant' }).first().click()
  const d = page.getByRole('dialog', { name: 'New tenant' })
  await d.getByLabel('Name', { exact: true }).fill(name)
  await d.getByLabel('Identifier').fill(slug)
  await d.getByRole('button', { name: 'Next' }).click()
  await d.getByRole('button', { name: 'Next' }).click()
  await d.getByLabel('Username of the Tenant Manager').fill('manager')
  await d.getByLabel('Email of the Tenant Manager').fill(`manager@${slug}.example.org`)
  await d.getByLabel('Initial password').fill(PASSWORD)
  await d.getByRole('button', { name: 'Next' }).click()
  await d.getByRole('button', { name: 'Create the tenant' }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await nav(page, 'Tenants').click()
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()
}

/** No serious or critical WCAG 2.1 AA violation (axe). */
export async function accessible(page: Page, where: string) {
  // a menu or a list that is closing hides the page for a moment (aria-hidden): measure after it is gone
  await page.waitForFunction(() => !document.querySelector('[data-aria-hidden="true"]'), undefined, { timeout: 3000 }).catch(() => {})
  // toasts fade in and out: measured half-transparent they would fail colour contrast by chance
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('[data-sonner-toaster]').analyze()
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(' ') + ' ' + n.html.slice(0, 300) + ' => ' + n.failureSummary).join(' | ')}`)).toEqual([])
}

/** Waits until no CSS transition is running (colours after a change of theme): 5 frames without one (5 s at most: an endless spinner must not stall). */
export async function colorsSettled(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const end = performance.now() + 5000
        let idle = 0
        const tick = () => {
          const running = document.getAnimations().some((a) => a.constructor.name === 'CSSTransition' && a.playState === 'running')
          idle = running ? 0 : idle + 1
          if (idle >= 5 || performance.now() > end) resolve()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )
}
