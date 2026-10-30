import { expect, test, type Page } from '@playwright/test'
import { PASSWORD, adminLogin, login } from './support'

// Documents (com.mosaikit.files): the preview of a file in the details panel and in the full viewer, inside the sandboxed
// frame of the plugin and under its CSP. Self-contained: it makes its own tenant.

const API = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([method, path, body]) => {
      const s = await (await fetch('api/session')).json()
      const r = await fetch(path as string, { method: method as string, headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrf }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: r.status, json: await r.json().catch(() => null) }
    },
    [method, path, body] as const,
  )

// 1x1 red PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
    '4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 20 100 Td (Hello PDF) Tj ET\nendstream endobj\n' +
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n',
)

test.describe.serial('17-documents-preview', () => {
  test('image, text and PDF previews render in the details panel and in the viewer', async ({ page }) => {
    test.setTimeout(180_000)
    await adminLogin(page)
    const made = await API(page, 'POST', 'api/admin/tenants', { slug: 'docsco', name: 'Docs Co', manager_username: 'mgr', manager_email: 'mgr@docsco.example.org', manager_password: PASSWORD })
    expect(made.status).toBeLessThan(410)
    await page.context().clearCookies()
    await login(page, 'Docs Co', 'mgr', PASSWORD)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('./#/t/docsco/p/com.mosaikit.files')
    const frame = page.frameLocator('iframe.plugin-frame')
    await frame.locator('input[type="file"]').setInputFiles([
      { name: 'pic.png', mimeType: 'image/png', buffer: PNG },
      { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello text preview') },
      { name: 'doc.pdf', mimeType: 'application/pdf', buffer: PDF },
    ])
    const row = (n: string) => frame.locator('.fm-main').getByText(n, { exact: true }).first()
    await expect(row('doc.pdf')).toBeVisible()
    const side = frame.locator('.fm-side')

    // image: a loaded picture, not a broken one
    await row('pic.png').click()
    // selection bar: icon-only buttons with an accessible name and a tooltip; the count stays as text
    const bar = frame.locator('.fm-bar')
    await expect(bar.locator('.count')).toHaveText('1 item selected')
    const bb = bar.locator('button[data-tip]')
    expect(await bb.count()).toBeGreaterThan(3)
    for (const b of await bb.all()) {
      expect((await b.textContent())!.trim()).toBe('')
      expect(await b.getAttribute('aria-label')).toBeTruthy()
    }
    await bar.getByRole('button', { name: 'Download' }).hover()
    await expect.poll(() => bar.getByRole('button', { name: 'Download' }).evaluate((e) => getComputedStyle(e, '::after').opacity)).toBe('1')
    await expect(bar.getByRole('button', { name: 'Open in tab' })).toBeVisible()
    // flat surfaces, list and panel are one block with one border
    const geo = await frame.locator('.fm-body').evaluate((b) => {
      const g = (q: string) => getComputedStyle(document.querySelector(q)!)
      const bs = getComputedStyle(b)
      return { radius: [bs.borderRadius, g('.fm-main').borderRadius, g('.fm-side').borderRadius, g('.fm-bar').borderRadius, g('.fm-crumbs').borderRadius], gap: bs.columnGap, mainBorder: g('.fm-main').borderLeftWidth + g('.fm-main').borderRightWidth, sideLeft: g('.fm-side').borderLeftWidth, sideRight: g('.fm-side').borderRightWidth, hMain: b.querySelector('.fm-main')!.getBoundingClientRect().height, hSide: b.querySelector('.fm-side')!.getBoundingClientRect().height }
    })
    expect(geo.radius.every((r) => r === '0px')).toBe(true)
    expect(geo.gap).toBe('0px')
    expect(geo.mainBorder).toBe('0px0px')
    expect(geo.sideLeft).toBe('1px')
    expect(geo.sideRight).toBe('0px')
    expect(Math.abs(geo.hMain - geo.hSide)).toBeLessThan(2)
    const img = side.locator('.pv img')
    await expect(img).toBeVisible()
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBe(1)

    await row('note.txt').click()
    await expect(side.locator('.pv-text')).toContainText('hello text preview')

    // PDF: the panel shows its own rendering (pdf.js canvas with ink), not a blank frame
    await row('doc.pdf').click()
    const canvas = side.locator('.pv canvas')
    await expect(canvas).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 !== 3 && v < 200)), { timeout: 20_000 }).toBe(true)

    // the full viewer
    await side.getByRole('button', { name: 'Open', exact: true }).click()
    const vc = frame.locator('.fm-lb canvas').first()
    await expect(vc).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => vc.evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 !== 3 && v < 200)), { timeout: 20_000 }).toBe(true)
    await page.keyboard.press('Escape')
    // few rows: no scrollbar in the table; many rows: it shows
    const table = frame.locator('.fm-table')
    await expect(table).not.toHaveAttribute('data-scrolls', /.*/)
    await frame.locator('input[type="file"]').setInputFiles(Array.from({ length: 30 }, (_, i) => ({ name: `bulk-${String(i).padStart(2, '0')}.txt`, mimeType: 'text/plain', buffer: Buffer.from('x') })))
    await expect(table).toHaveAttribute('data-scrolls', '')
    await frame.locator('.fm-table tbody tr').first().click()

    // the panel never scrolls sideways and the actions fit its width
    const over = await side.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, btn: [...e.querySelectorAll('.acts button')].filter((b) => b.getBoundingClientRect().right > e.getBoundingClientRect().right + 0.5).length }))
    expect(over.sw).toBeLessThanOrEqual(over.cw)
    expect(over.btn).toBe(0)
  })

  test('a folder with more than 100 files is drawn a page at a time (infinite scroll), the selection keeps to all of it', async ({ page }) => {
    test.setTimeout(180_000)
    await login(page, 'Docs Co', 'mgr', PASSWORD)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('./#/t/docsco/p/com.mosaikit.files')
    const frame = page.frameLocator('iframe.plugin-frame')
    await frame.locator('input[type="file"]').setInputFiles(Array.from({ length: 110 }, (_, i) => ({ name: `page-${String(i).padStart(3, '0')}.txt`, mimeType: 'text/plain', buffer: Buffer.from('x') })))
    const rows = frame.locator('.fm-table tbody tr.it')
    const count = frame.locator('.fm-foot .msk-count')
    // the first page only, with its foot
    await expect(count).toHaveText(/^100 of \d+ items$/)
    const total = Number(/of (\d+) items/.exec((await count.textContent())!)![1])
    expect(total).toBeGreaterThan(110)
    await expect(rows).toHaveCount(100)
    // scrolling to the end brings the next page, then «N of N» and no more button
    await frame.locator('.fm-table tbody').evaluate((e) => (e.scrollTop = e.scrollHeight))
    await expect(rows).toHaveCount(total)
    await expect(count).toHaveText(`${total} of ${total} items`)
    await expect(frame.locator('.fm-foot button')).toHaveCount(0)
    // Ctrl+A selects the whole folder, also after a page that was not drawn
    await rows.first().click()
    await page.keyboard.press('Control+a')
    await expect(frame.locator('.fm-bar .count')).toHaveText(`${total} items selected`)
    // the grid view draws pages too
    await page.keyboard.press('Escape')
    await frame.getByRole('button', { name: /Grid/ }).first().click()
    await expect(frame.locator('.fm-card')).toHaveCount(100)
    await expect(frame.locator('.fm-foot .msk-count')).toHaveText(`100 of ${total} items`)
    await frame.locator('.fm-main').evaluate((e) => (e.scrollTop = e.scrollHeight))
    await expect(frame.locator('.fm-card')).toHaveCount(total)
  })
})
