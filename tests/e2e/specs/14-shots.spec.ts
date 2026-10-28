import fs from 'node:fs'
import { test } from '@playwright/test'
import { PASSWORD, adminLogin, login } from './support'

const OUT = 'C:/dev/mosaikit-temp/shots2'
fs.mkdirSync(OUT, { recursive: true })
const log: string[] = []

test('shots', async ({ page }) => {
  const sizes = [['desktop', 1440, 700], ['phone', 390, 800]] as const
  const visit = async (name: string, hash: string) => {
    for (const [sz, w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('./' + hash)
      await page.waitForTimeout(1800)
      const m = await page.evaluate(() => {
        const ls = document.querySelector('[data-listscroll]')
        const th = document.querySelector('thead th')
        const hd = document.querySelector('.msk-page-header')
        return {
          pageScroll: document.documentElement.scrollHeight - innerHeight,
          list: !!ls,
          listOverflow: ls ? ls.scrollHeight - ls.clientHeight : null,
          thSticky: th ? getComputedStyle(th).position : null,
          headTop: hd ? Math.round(hd.getBoundingClientRect().top) : null,
        }
      })
      log.push(`${name} ${sz} ${JSON.stringify(m)}`)
      await page.screenshot({ path: `${OUT}/${name}-${sz}.png` })
    }
  }
  await adminLogin(page)
  await visit('admin-people', '#/admin/people')
  await visit('admin-plugins', '#/admin/plugins')
  await visit('admin-log', '#/admin/log')
  await visit('admin-tenants', '#/admin/tenants')
  // sidebar scrollbar: a short window, the mouse away and over the sidebar
  await page.setViewportSize({ width: 1440, height: 330 })
  await page.goto('./#/admin')
  await page.waitForTimeout(1200)
  await page.mouse.move(800, 200)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/sidebar-away.png`, clip: { x: 0, y: 0, width: 200, height: 330 } })
  await page.mouse.move(30, 200)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/sidebar-hover.png`, clip: { x: 0, y: 0, width: 200, height: 330 } })
  const sc = await page.evaluate(() => {
    const e = document.querySelector('[data-sidebar="content"]') as HTMLElement
    return { scrollH: e.scrollHeight, clientH: e.clientHeight, color: getComputedStyle(e).scrollbarColor, ov: getComputedStyle(e).overflowY }
  })
  log.push('sidebar ' + JSON.stringify(sc))
  await page.mouse.wheel(0, 200)
  await page.waitForTimeout(300)
  log.push('sidebar scrollTop after wheel ' + (await page.evaluate(() => (document.querySelector('[data-sidebar="content"]') as HTMLElement).scrollTop)))
  await page.context().clearCookies()
  await login(page, 'Overview Tenant', 'mgr', PASSWORD)
  await visit('mgr-people', '#/t/ovw/manage')
  await visit('mgr-log', '#/t/ovw/log')
  await visit('mgr-trash', '#/t/ovw/trash')
  await visit('mgr-plugins', '#/t/ovw/plugins')
  await visit('mgr-notes', '#/t/ovw/p/com.mosaikit.notes')
  await visit('mgr-maps', '#/t/ovw/p/com.mosaikit.maps')
  await visit('mgr-sites', '#/t/ovw/p/com.mosaikit.static-site')
  await visit('mgr-files', '#/t/ovw/p/com.mosaikit.files')
  await visit('mgr-home', '#/t/ovw')
  fs.writeFileSync(`${OUT}/metrics.txt`, log.join('\n'))
})
