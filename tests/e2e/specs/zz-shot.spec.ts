import { test } from '@playwright/test'
import { PASSWORD, login } from './support'

const out = (n: string) => `C:/tmp/mosaikit/card-${n}.png`

test('card shots', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1200, height: 717 })
  await page.emulateMedia({ colorScheme: 'light' })
  await login(page, 'Devt', 'mgr', PASSWORD)
  await page.setViewportSize({ width: 1200, height: 717 })
  await page.reload()
  await page.waitForTimeout(5000)
  await page.screenshot({ path: out('layout') })
  await page.getByRole('link', { name: 'Notes', exact: true }).first().click()
  await page.waitForTimeout(4000)
  await page.screenshot({ path: out('layout-page') })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('./')
  await page.waitForTimeout(5000)
  await page.screenshot({ path: out('layout-dark') })
})
