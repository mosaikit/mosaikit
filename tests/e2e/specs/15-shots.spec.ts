import fs from 'node:fs'
import { test } from '@playwright/test'
import { PASSWORD, login } from './support'

const OUT = 'C:/dev/mosaikit-temp/shots3'
fs.mkdirSync(OUT, { recursive: true })

test('plugin pages vs host', async ({ page }) => {
  await page.context().clearCookies()
  await login(page, 'Overview Tenant', 'mgr', PASSWORD)
  for (const [sz, w, h] of [['desktop', 1440, 700], ['phone', 390, 800]] as const) {
    await page.setViewportSize({ width: w, height: h })
    for (const [name, hash] of [['host-manage', '#/t/ovw/manage'], ['sites', '#/t/ovw/p/com.mosaikit.static-site'], ['maps', '#/t/ovw/p/com.mosaikit.maps'], ['files', '#/t/ovw/p/com.mosaikit.files']]) {
      await page.goto('./' + hash)
      await page.waitForTimeout(2500)
      await page.screenshot({ path: `${OUT}/${name}-${sz}.png` })
    }
  }
})
