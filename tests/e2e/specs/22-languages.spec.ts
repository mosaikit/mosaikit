import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { PASSWORD, accessible, login } from './support'

// The language plugins of the repository (docs/manual-tests.md, LANG-02): each one is offered, the page takes its language and its
// direction (Arabic is written from right to left), and the shell speaks it: the texts of the pages come from its `host.json`.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../mosaikit-plugins')
const LANGS = [
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'fr', name: 'Français' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'ar', name: 'العربية' },
  { code: 'zh', name: '中文' },
  { code: 'ru', name: 'Русский' },
]
const texts = (code: string): Record<string, string> => JSON.parse(fs.readFileSync(path.join(ROOT, `lang-${code}`, 'lang', 'host.json'), 'utf8'))

test.describe.serial('Language plugins', () => {
  test('every language is installed, sets the language and direction of the page and translates the shell', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    // the language button of the top bar shows the short code of the language ("EN", "ES"...)
    const button = page.getByRole('button', { name: /^[A-Z]{2} · / })
    for (const { code, name } of LANGS) {
      const t = texts(code)
      await button.click()
      await page.getByText(name, { exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('lang', code)
      await expect(page.locator('html')).toHaveAttribute('dir', code === 'ar' ? 'rtl' : 'ltr')
      // a text of the shell that is on the page in every language: the title of the account page
      await page.goto('./#/t/alfa/account')
      await expect(page.getByRole('heading', { name: t['Account'] ?? 'Account' }).first()).toBeVisible()
      await accessible(page, 'shell in ' + code)
      await button.click()
      await page.getByText('English', { exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    }
  })

  test('the language menu offers each language by its own name', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await page.getByRole('button', { name: /Language/ }).click()
    for (const { name } of LANGS) await expect(page.getByText(name, { exact: true })).toBeVisible()
  })
})
