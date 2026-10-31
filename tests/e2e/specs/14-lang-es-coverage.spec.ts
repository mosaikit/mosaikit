import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { adminLogin, createTenant, fresh, nav, PASSWORD } from './support.ts'

// Spanish coverage (docs/manual-tests.md, LANG-01): the whole shell in Spanish, no English left on the main pages.
// The texts inside plugin iframes are not covered by the language plugin (known limit) and are not scanned.

const SLUG = 'es-cov'
const OUT = new URL('../test-results/lang-es/', import.meta.url)

// Words that only an English sentence has; a Spanish text never contains them as a whole word.
const ENGLISH = /(?<!\p{L})(the|and|your|you|with|from|for|are|this|that|will|have|not|new|add|save|cancel|of|to|is|by|on)(?!\p{L})/iu
// Names of things the people typed or the seed made, brands and technical terms that stay as they are.
const ALLOWED = /^(automatic message, do not reply.|mosaikit|plugins?|tenant|admin|manager|notes?|tasks?|ctrl k|oidc|smtp|pkce|csv|svg|png|webp|es|en|it|gb|ok)$/i

// Data, not UI: the names of the tenants the other specs (and this one) made, wherever they show up, and keys
// (long base64 strings, different on every run) whose random letters can spell an English word.
const DATA = /(City|Town) of [A-Z][a-z]+|Ciudad ES|[A-Za-z0-9+/_-]{20,}={0,2}/g

async function lines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>()
    for (const l of document.body.innerText.split('\n')) out.add(l.trim())
    document.querySelectorAll('[aria-label],[placeholder],[title]').forEach((e) => {
      for (const a of ['aria-label', 'placeholder', 'title']) {
        const v = e.getAttribute(a)
        if (v) out.add(v.trim())
      }
    })
    return [...out].filter(Boolean)
  })
}

const same: string[] = []
async function scan(page: Page, name: string, found: string[]) {
  await page.waitForTimeout(700)
  if (process.env.LANG_EXPLORE) {
    const es = await lines(page)
    await page.evaluate(() => localStorage.setItem('msk_lang', 'en'))
    await page.reload()
    await page.waitForTimeout(900)
    const en = new Set(await lines(page))
    same.push(...es.filter((l) => en.has(l) && /[A-Za-z]{4}/.test(l)).map((l) => `${name}: ${l}`))
    await page.evaluate(() => localStorage.setItem('msk_lang', 'es'))
    await page.reload()
    await page.waitForTimeout(900)
  }
  fs.mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: new URL(`${name}.png`, OUT).pathname.replace(/^\/([A-Za-z]:)/, '$1') })
  for (const l of await lines(page)) if (ENGLISH.test(l.replace(DATA, '')) && !ALLOWED.test(l)) found.push(`${name}: ${l}`)
}

async function spanish(page: Page) {
  await page.evaluate(() => localStorage.setItem('msk_lang', 'es'))
  await page.reload()
}

test.describe.serial('Spanish covers the whole shell', () => {
  const found: string[] = []

  test('Administrator pages', async ({ page }) => {
    await adminLogin(page)
    await nav(page, 'Tenants').click()
    await createTenant(page, SLUG, 'Ciudad ES')
    await spanish(page)
    for (const [name, hash] of [
      ['admin-overview', '#/admin'],
      ['admin-tenants', '#/admin/tenants'],
      ['admin-people', '#/admin/people'],
      ['admin-plugins', '#/admin/plugins'],
      ['admin-plugin', '#/admin/plugin/com.mosaikit.notes'],
      ['admin-system', '#/admin/system'],
      ['admin-keys', '#/admin/system/keys'],
      ['admin-email', '#/admin/system/email'],
      ['admin-admins', '#/admin/system/admins'],
      ['admin-backup', '#/admin/system/backup'],
      ['admin-quotas', '#/admin/system/quotas'],
      ['admin-monitoring', '#/admin/system/monitoring'],
      ['admin-log', '#/admin/system/log'],
    ] as const) {
      await page.goto('./' + hash)
      await scan(page, name, found)
    }
  })

  test('Tenant Manager pages', async ({ page }) => {
    await fresh(page)
    await page.getByLabel('Username').fill('manager')
    const select = page.getByRole('combobox', { name: 'Tenant' })
    if (await select.count()) {
      await select.click()
      await page.getByRole('option', { name: 'Ciudad ES' }).click()
    }
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('button', { name: /person menu/ })).toBeVisible()
    await spanish(page)
    for (const [name, hash] of [
      ['home', ''],
      ['overview', '/overview'],
      ['manage', '/manage'],
      ['groups', '/manage/groups'],
      ['profiles', '/manage/profiles'],
      ['pending', '/manage/pending'],
      ['plugins', '/plugins'],
      ['shares', '/shares'],
      ['usage', '/usage'],
      ['log', '/log'],
      ['settings', '/settings'],
      ['trash', '/trash'],
      ['account', '/account'],
      ['account-security', '/account/security'],
      ['account-appearance', '/account/appearance'],
      ['account-usage', '/account/usage'],
      ['account-notifications', '/account/notifications'],
      ['notes', '/app/com.mosaikit.notes'],
    ] as const) {
      await page.goto(`./#/t/${SLUG}${hash}`)
      await scan(page, `tenant-${name}`, found)
    }
    // the dialogs and menus of the top bar
    await page.getByRole('button', { name: /Ayuda/ }).first().click()
    await scan(page, 'tenant-help-menu', found)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /Notificaciones/ }).first().click()
    await scan(page, 'tenant-notifications', found)
  })

  test('nothing left in English', async () => {
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(new URL('english-left.txt', OUT), found.join('\n'))
    fs.writeFileSync(new URL('same-in-both.txt', OUT), same.join('\n'))
    expect(found).toEqual([])
  })
})
