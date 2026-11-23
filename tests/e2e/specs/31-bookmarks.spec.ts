import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Bookmarks (docs/manual-tests.md, BKM-01..08): the grid with an empty state, a bookmark with tags, search, the tag filter, the
// favourites, the address that gets https://, an address that is refused, edit and delete.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const bookmark = (frame: FrameLocator, title: string) => frame.locator('[data-testid=bookmark]', { hasText: title }).first()

async function save(frame: FrameLocator, o: { url: string; title?: string; note?: string; tags?: string[]; favorite?: boolean; opens?: 'frame' | 'tab' }, expectCard?: string) {
  await frame.getByRole('button', { name: /^＋ New bookmark/ }).first().click()
  await frame.getByRole('textbox', { name: 'Address', exact: true }).fill(o.url)
  if (o.title) await frame.getByRole('textbox', { name: 'Title', exact: true }).fill(o.title)
  if (o.note) await frame.getByRole('textbox', { name: 'Note', exact: true }).fill(o.note)
  for (const t of o.tags ?? []) {
    await frame.locator('.msk-taginput input').fill(t)
    await frame.locator('.msk-taginput input').press('Enter')
  }
  if (o.favorite) await frame.getByLabel('Favourite', { exact: true }).check()
  if (o.opens) await frame.getByTestId('bk-open-mode').selectOption(o.opens)
  await frame.getByRole('button', { name: 'Save' }).click()
  if (expectCard) await expect(bookmark(frame, expectCard)).toBeVisible()
}

test.describe.serial('Bookmarks', () => {
  test('grid, tags, search, favourites, addresses, edit and delete', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await nav(page, 'Bookmarks').click()
    const frame = frameOf(page)
    await expect(frame.getByRole('heading', { name: 'Bookmarks', exact: true })).toBeVisible()

    // BKM-01: nothing yet, the illustrated empty state with the primary action
    await expect(frame.getByTestId('empty-state')).toBeVisible()
    await expect(frame.getByTestId('empty-state').getByRole('button', { name: /New bookmark/ })).toBeVisible()

    // BKM-02: a bookmark with a note and tags; the card shows the host name and the tags, and Open is a safe link
    await save(frame, { url: 'https://docs.rust-lang.invalid/book/', title: 'BKM rust book', note: 'Learn the language', tags: ['Rust', 'docs'] }, 'BKM rust book')
    const book = bookmark(frame, 'BKM rust book')
    await expect(book.locator('.bk-host')).toHaveText('docs.rust-lang.invalid')
    await expect(book.locator('.bk-tag')).toHaveText(['rust', 'docs'])
    await expect(book.getByRole('link', { name: 'Open' })).toHaveAttribute('target', '_blank')
    await expect(book.getByRole('link', { name: 'Open' })).toHaveAttribute('rel', 'noopener noreferrer')

    // BKM-04: an address without a scheme gets https://, and an empty title becomes the host name
    // (the host looks at the page when it saves, to find a title: an address that does not exist leaves the host name)
    await save(frame, { url: 'status.example.invalid/status', tags: ['ops'] }, 'status.example.invalid')
    await expect(bookmark(frame, 'status.example.invalid').getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://status.example.invalid/status')
    await accessible(page, 'bookmarks grid')

    // BKM-03: the search looks at title, address, note and tags; nothing found says so and the filters can be cleared
    const box = frame.getByRole('searchbox', { name: 'Search bookmarks' })
    await box.fill('learn')
    await expect(frame.locator('[data-testid=bookmark]')).toHaveCount(1)
    await box.fill('example.invalid/status')
    await expect(bookmark(frame, 'status.example.invalid')).toBeVisible()
    await expect(bookmark(frame, 'BKM rust book')).toHaveCount(0)
    await box.fill('zzzz')
    await expect(frame.getByTestId('empty-filtered')).toBeVisible()
    await frame.getByTestId('empty-filtered').getByRole('button', { name: 'Clear filters' }).click()
    await expect(frame.locator('[data-testid=bookmark]')).toHaveCount(2)

    // BKM-05: the tag filter with counts; a click chooses a tag, another click leaves it
    const ops = frame.getByRole('button', { name: /^ops 1$/ })
    await ops.click()
    await expect(ops).toHaveAttribute('aria-pressed', 'true')
    await expect(frame.locator('[data-testid=bookmark]')).toHaveCount(1)
    await expect(bookmark(frame, 'status.example.invalid')).toBeVisible()
    await ops.click()
    await expect(frame.locator('[data-testid=bookmark]')).toHaveCount(2)

    // BKM-06: the star marks a favourite; the Favourites filter keeps only those
    await book.getByRole('button', { name: /Add to favourites/ }).click()
    await expect(book.getByRole('button', { name: /Remove from favourites/ })).toHaveAttribute('aria-pressed', 'true')
    const favs = frame.getByRole('button', { name: /Favourites$/ })
    await favs.click()
    await expect(frame.locator('[data-testid=bookmark]')).toHaveCount(1)
    await expect(bookmark(frame, 'BKM rust book')).toBeVisible()
    await favs.click()
    await expect(frame.locator('[data-testid=bookmark]')).toHaveCount(2)

    // BKM-07: an address that is not http or https is refused with a clear message and nothing is saved
    await save(frame, { url: 'javascript:alert(1)', title: 'BKM bad' })
    await expect(frame.locator('body')).toContainText(/only http and https/i)
    await frame.getByRole('button', { name: 'Cancel' }).click()
    await expect(bookmark(frame, 'BKM bad')).toHaveCount(0)

    // BKM-08: edit a bookmark, then delete it with a confirmation
    await bookmark(frame, 'BKM rust book').getByRole('button', { name: 'Edit' }).click()
    await frame.getByRole('textbox', { name: 'Title', exact: true }).fill('BKM rust handbook')
    await frame.getByRole('button', { name: 'Save' }).click()
    await expect(bookmark(frame, 'BKM rust handbook')).toBeVisible()
    await expect(bookmark(frame, 'BKM rust book')).toHaveCount(0)
    await bookmark(frame, 'BKM rust handbook').getByRole('button', { name: 'Delete' }).click()
    await frame.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(bookmark(frame, 'BKM rust handbook')).toHaveCount(0)
    await expect(frame.locator('[data-testid=bookmark]')).toHaveCount(1)
  })
  test('BKM-13..16: a bookmark opens in the content area or in a new tab, the title and the picture come from the page', async ({ page, context }) => {
    // two sites on this computer: one open to framing with a title and an og:image, one that forbids it
    const RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')
    const serve = (headers: Record<string, string>, html: string) =>
      new Promise<http.Server>((resolve) => {
        const srv = http.createServer((req, res) => {
          if (req.url === '/pic.png') {
            res.writeHead(200, { 'content-type': 'image/png' })
            res.end(RED)
            return
          }
          res.writeHead(200, { 'content-type': 'text/html', ...headers })
          res.end(html)
        })
        srv.listen(0, '127.0.0.1', () => resolve(srv))
      })
    const tag = Date.now().toString(36)
    const free = await serve({}, `<title>Free page ${tag}</title><meta property="og:image" content="/pic.png"><h1>Hello from the free site</h1>`)
    const closed = await serve({ 'x-frame-options': 'DENY' }, `<title>Closed page ${tag}</title><h1>Closed site</h1><img src="/pic.png">`)
    const addr = (s: http.Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}/`
    try {
      await login(page, 'Alfa', 'manager', PASSWORD)
      await nav(page, 'Bookmarks').click()
      const frame = frameOf(page)
      await expect(frame.getByRole('heading', { name: 'Bookmarks', exact: true })).toBeVisible()

      // BKM-13: no title typed: the title and the picture of the page fill the bookmark; the chip says it opens in the page
      await save(frame, { url: addr(free), opens: 'frame' }, `Free page ${tag}`)
      const freeCard = bookmark(frame, `Free page ${tag}`)
      await expect(freeCard.locator('img.bk-pic')).toBeVisible()
      await expect(freeCard.getByTestId('bookmark-mode')).toHaveText('In page')

      // BKM-14: Open shows the site in the content area; the band brings the list back
      await freeCard.getByTestId('bookmark-open').click()
      await expect(frame.locator('iframe.bk-frame')).toHaveAttribute('src', addr(free))
      await expect(frame.frameLocator('iframe.bk-frame').getByRole('heading', { name: 'Hello from the free site' })).toBeVisible()
      await page.getByRole('button', { name: 'Back to the bookmarks' }).click()
      await expect(frame.getByRole('heading', { name: 'Bookmarks', exact: true })).toBeVisible()

      // BKM-15: a site that forbids framing: said in the page and opened in a new tab (the check is made at every open)
      await save(frame, { url: addr(closed), opens: 'frame' }, `Closed page ${tag}`)
      const closedCard = bookmark(frame, `Closed page ${tag}`)
      await expect(closedCard.locator('img.bk-pic')).toBeVisible()
      const popup = context.waitForEvent('page')
      await closedCard.getByTestId('bookmark-open').click()
      expect((await popup).url()).toBe(addr(closed))
      await expect(frame.getByText('does not allow being shown inside Mosaikit')).toBeVisible()
      await page.getByRole('button', { name: 'Back to the bookmarks' }).click()

      // BKM-16: the default of the list (new tab at first) applies to a bookmark that has no choice of its own
      await save(frame, { url: 'plain.example.invalid/page' }, 'plain.example.invalid')
      const plain = bookmark(frame, 'plain.example.invalid')
      await expect(plain.getByTestId('bookmark-mode')).toHaveText('New tab')
      await expect(plain.getByRole('link', { name: 'Open' })).toHaveAttribute('target', '_blank')
      await frame.getByTestId('bk-default-frame').click()
      await expect(plain.getByTestId('bookmark-mode')).toHaveText('In page')
      await expect(plain.getByTestId('bookmark-open')).toHaveRole('button')
      await frame.getByTestId('bk-default-tab').click()
      await expect(plain.getByTestId('bookmark-mode')).toHaveText('New tab')
      // the bookmarks of this test are deleted
      for (const t of [`Free page ${tag}`, `Closed page ${tag}`, 'plain.example.invalid']) {
        await bookmark(frame, t).getByRole('button', { name: 'Delete' }).click()
        await frame.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
        await expect(bookmark(frame, t)).toHaveCount(0)
      }
    } finally {
      free.close()
      closed.close()
    }
  })
})
