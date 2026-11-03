# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 17-documents-preview.spec.ts >> 17-documents-preview >> a folder with more than 100 files is drawn a page at a time (infinite scroll), the selection keeps to all of it
- Location: specs\17-documents-preview.spec.ts:104:3

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: locator('iframe.plugin-frame').contentFrame().locator('.fm-foot .msk-count')
Expected pattern: /^100 of \d+ items$/
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toHaveText" locator('iframe.plugin-frame').contentFrame().locator('.fm-foot .msk-count') with timeout 15000ms
  - waiting for locator('iframe.plugin-frame').contentFrame().locator('.fm-foot .msk-count')

```

```yaml
- button "Skip to the content"
- list:
  - listitem:
    - link "Tenant overview":
      - /url: "#/t/docsco"
      - text: Overview
- list:
  - listitem:
    - link "Contacts":
      - /url: "#/t/docsco/p/com.mosaikit.contacts"
  - listitem:
    - link "Documents":
      - /url: "#/t/docsco/p/com.mosaikit.files"
  - listitem:
    - link "Maps":
      - /url: "#/t/docsco/p/com.mosaikit.maps"
  - listitem:
    - link "Notes":
      - /url: "#/t/docsco/p/com.mosaikit.notes"
    - button "Open the pages of Notes"
  - listitem:
    - link "Sites":
      - /url: "#/t/docsco/p/com.mosaikit.static-site"
  - listitem:
    - link "Tasks":
      - /url: "#/t/docsco/p/com.mosaikit.tasks"
- list:
  - listitem:
    - link "Manage":
      - /url: "#/t/docsco/manage"
  - listitem:
    - link "Plugins":
      - /url: "#/t/docsco/plugins"
  - listitem:
    - link "Shares":
      - /url: "#/t/docsco/shares"
  - listitem:
    - link "Usage":
      - /url: "#/t/docsco/usage"
  - listitem:
    - link "Log":
      - /url: "#/t/docsco/log"
- list:
  - listitem:
    - link "Tenant settings":
      - /url: "#/t/docsco/settings"
      - text: Settings
- main:
  - button "Open or close the sidebar"
  - text: DC Docs Co
  - button "Search everywhere Ctrl K"
  - 'button "EN · Language: English"': EN
  - button "Mode"
  - button "Help"
  - button "Notifications"
  - button "mgr Tenant Manager person menu"
  - iframe
- region "Notifications alt+T"
```

# Test source

```ts
  14  |     [method, path, body] as const,
  15  |   )
  16  | 
  17  | // 1x1 red PNG
  18  | const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')
  19  | const PDF = Buffer.from(
  20  |   '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  21  |     '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
  22  |     '4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 20 100 Td (Hello PDF) Tj ET\nendstream endobj\n' +
  23  |     '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n',
  24  | )
  25  | 
  26  | test.describe.serial('17-documents-preview', () => {
  27  |   test('image, text and PDF previews render in the details panel and in the viewer', async ({ page }) => {
  28  |     test.setTimeout(180_000)
  29  |     await adminLogin(page)
  30  |     const made = await API(page, 'POST', 'api/admin/tenants', { slug: 'docsco', name: 'Docs Co', manager_username: 'mgr', manager_email: 'mgr@docsco.example.org', manager_password: PASSWORD })
  31  |     expect(made.status).toBeLessThan(410)
  32  |     await page.context().clearCookies()
  33  |     await login(page, 'Docs Co', 'mgr', PASSWORD)
  34  |     await page.setViewportSize({ width: 1440, height: 900 })
  35  |     await page.goto('./#/t/docsco/p/com.mosaikit.files')
  36  |     const frame = page.frameLocator('iframe.plugin-frame')
  37  |     await frame.locator('input[type="file"]').setInputFiles([
  38  |       { name: 'pic.png', mimeType: 'image/png', buffer: PNG },
  39  |       { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello text preview') },
  40  |       { name: 'doc.pdf', mimeType: 'application/pdf', buffer: PDF },
  41  |     ])
  42  |     const row = (n: string) => frame.locator('.fm-main').getByText(n, { exact: true }).first()
  43  |     await expect(row('doc.pdf')).toBeVisible()
  44  |     const side = frame.locator('.fm-side')
  45  | 
  46  |     // image: a loaded picture, not a broken one
  47  |     await row('pic.png').click()
  48  |     // selection bar: icon-only buttons with an accessible name and a tooltip; the count stays as text
  49  |     const bar = frame.locator('.fm-bar')
  50  |     await expect(bar.locator('.count')).toHaveText('1 item selected')
  51  |     const bb = bar.locator('button[data-tip]')
  52  |     expect(await bb.count()).toBeGreaterThan(3)
  53  |     for (const b of await bb.all()) {
  54  |       expect((await b.textContent())!.trim()).toBe('')
  55  |       expect(await b.getAttribute('aria-label')).toBeTruthy()
  56  |     }
  57  |     await bar.getByRole('button', { name: 'Download' }).hover()
  58  |     await expect.poll(() => bar.getByRole('button', { name: 'Download' }).evaluate((e) => getComputedStyle(e, '::after').opacity)).toBe('1')
  59  |     await expect(bar.getByRole('button', { name: 'Open in tab' })).toBeVisible()
  60  |     // flat surfaces, list and panel are one block with one border
  61  |     const geo = await frame.locator('.fm-body').evaluate((b) => {
  62  |       const g = (q: string) => getComputedStyle(document.querySelector(q)!)
  63  |       const bs = getComputedStyle(b)
  64  |       return { radius: [bs.borderRadius, g('.fm-main').borderRadius, g('.fm-side').borderRadius, g('.fm-bar').borderRadius, g('.fm-crumbs').borderRadius], gap: bs.columnGap, mainBorder: g('.fm-main').borderLeftWidth + g('.fm-main').borderRightWidth, sideLeft: g('.fm-side').borderLeftWidth, sideRight: g('.fm-side').borderRightWidth, hMain: b.querySelector('.fm-main')!.getBoundingClientRect().height, hSide: b.querySelector('.fm-side')!.getBoundingClientRect().height }
  65  |     })
  66  |     expect(geo.radius.every((r) => r === '0px')).toBe(true)
  67  |     expect(geo.gap).toBe('0px')
  68  |     expect(geo.mainBorder).toBe('0px0px')
  69  |     expect(geo.sideLeft).toBe('1px')
  70  |     expect(geo.sideRight).toBe('0px')
  71  |     expect(Math.abs(geo.hMain - geo.hSide)).toBeLessThan(2)
  72  |     const img = side.locator('.pv img')
  73  |     await expect(img).toBeVisible()
  74  |     await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBe(1)
  75  | 
  76  |     await row('note.txt').click()
  77  |     await expect(side.locator('.pv-text')).toContainText('hello text preview')
  78  | 
  79  |     // PDF: the panel shows its own rendering (pdf.js canvas with ink), not a blank frame
  80  |     await row('doc.pdf').click()
  81  |     const canvas = side.locator('.pv canvas')
  82  |     await expect(canvas).toBeVisible({ timeout: 20_000 })
  83  |     await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 !== 3 && v < 200)), { timeout: 20_000 }).toBe(true)
  84  | 
  85  |     // the full viewer
  86  |     await side.getByRole('button', { name: 'Open', exact: true }).click()
  87  |     const vc = frame.locator('.fm-lb canvas').first()
  88  |     await expect(vc).toBeVisible({ timeout: 20_000 })
  89  |     await expect.poll(() => vc.evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 !== 3 && v < 200)), { timeout: 20_000 }).toBe(true)
  90  |     await page.keyboard.press('Escape')
  91  |     // few rows: no scrollbar in the table; many rows: it shows
  92  |     const table = frame.locator('.fm-table')
  93  |     await expect(table).not.toHaveAttribute('data-scrolls', /.*/)
  94  |     await frame.locator('input[type="file"]').setInputFiles(Array.from({ length: 30 }, (_, i) => ({ name: `bulk-${String(i).padStart(2, '0')}.txt`, mimeType: 'text/plain', buffer: Buffer.from('x') })))
  95  |     await expect(table).toHaveAttribute('data-scrolls', '')
  96  |     await frame.locator('.fm-table tbody tr').first().click()
  97  | 
  98  |     // the panel never scrolls sideways and the actions fit its width
  99  |     const over = await side.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, btn: [...e.querySelectorAll('.acts button')].filter((b) => b.getBoundingClientRect().right > e.getBoundingClientRect().right + 0.5).length }))
  100 |     expect(over.sw).toBeLessThanOrEqual(over.cw)
  101 |     expect(over.btn).toBe(0)
  102 |   })
  103 | 
  104 |   test('a folder with more than 100 files is drawn a page at a time (infinite scroll), the selection keeps to all of it', async ({ page }) => {
  105 |     test.setTimeout(180_000)
  106 |     await login(page, 'Docs Co', 'mgr', PASSWORD)
  107 |     await page.setViewportSize({ width: 1440, height: 900 })
  108 |     await page.goto('./#/t/docsco/p/com.mosaikit.files')
  109 |     const frame = page.frameLocator('iframe.plugin-frame')
  110 |     await frame.locator('input[type="file"]').setInputFiles(Array.from({ length: 110 }, (_, i) => ({ name: `page-${String(i).padStart(3, '0')}.txt`, mimeType: 'text/plain', buffer: Buffer.from('x') })))
  111 |     const rows = frame.locator('.fm-table tbody tr.it')
  112 |     const count = frame.locator('.fm-foot .msk-count')
  113 |     // the first page only, with its foot
> 114 |     await expect(count).toHaveText(/^100 of \d+ items$/)
      |                         ^ Error: expect(locator).toHaveText(expected) failed
  115 |     const total = Number(/of (\d+) items/.exec((await count.textContent())!)![1])
  116 |     expect(total).toBeGreaterThan(110)
  117 |     await expect(rows).toHaveCount(100)
  118 |     // scrolling to the end brings the next page, then «N of N» and no more button
  119 |     await frame.locator('.fm-table tbody').evaluate((e) => (e.scrollTop = e.scrollHeight))
  120 |     await expect(rows).toHaveCount(total)
  121 |     await expect(count).toHaveText(`${total} of ${total} items`)
  122 |     await expect(frame.locator('.fm-foot button')).toHaveCount(0)
  123 |     // Ctrl+A selects the whole folder, also after a page that was not drawn
  124 |     await rows.first().click()
  125 |     await page.keyboard.press('Control+a')
  126 |     await expect(frame.locator('.fm-bar .count')).toHaveText(`${total} items selected`)
  127 |     // the grid view draws pages too
  128 |     await page.keyboard.press('Escape')
  129 |     await frame.getByRole('button', { name: /Grid/ }).first().click()
  130 |     await expect(frame.locator('.fm-card')).toHaveCount(100)
  131 |     await expect(frame.locator('.fm-foot .msk-count')).toHaveText(`100 of ${total} items`)
  132 |     await frame.locator('.fm-main').evaluate((e) => (e.scrollTop = e.scrollHeight))
  133 |     await expect(frame.locator('.fm-card')).toHaveCount(total)
  134 |   })
  135 | })
  136 | 
```