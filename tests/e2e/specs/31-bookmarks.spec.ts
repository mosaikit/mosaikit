import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Bookmarks (docs/manual-tests.md, BKM-01..08): the grid with an empty state, a bookmark with tags, search, the tag filter, the
// favourites, the address that gets https://, an address that is refused, edit and delete.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const bookmark = (frame: FrameLocator, title: string) => frame.locator('[data-testid=bookmark]', { hasText: title }).first()

async function save(frame: FrameLocator, o: { url: string; title?: string; note?: string; tags?: string[]; favorite?: boolean }, expectCard?: string) {
  await frame.getByRole('button', { name: /^＋ New bookmark/ }).first().click()
  await frame.getByRole('textbox', { name: 'Address', exact: true }).fill(o.url)
  if (o.title) await frame.getByRole('textbox', { name: 'Title', exact: true }).fill(o.title)
  if (o.note) await frame.getByRole('textbox', { name: 'Note', exact: true }).fill(o.note)
  for (const t of o.tags ?? []) {
    await frame.locator('.msk-taginput input').fill(t)
    await frame.locator('.msk-taginput input').press('Enter')
  }
  if (o.favorite) await frame.getByLabel('Favourite', { exact: true }).check()
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
    await save(frame, { url: 'https://doc.rust-lang.org/book/', title: 'BKM rust book', note: 'Learn the language', tags: ['Rust', 'docs'] }, 'BKM rust book')
    const book = bookmark(frame, 'BKM rust book')
    await expect(book.locator('.bk-host')).toHaveText('doc.rust-lang.org')
    await expect(book.locator('.bk-tag')).toHaveText(['rust', 'docs'])
    await expect(book.getByRole('link', { name: 'Open' })).toHaveAttribute('target', '_blank')
    await expect(book.getByRole('link', { name: 'Open' })).toHaveAttribute('rel', 'noopener noreferrer')

    // BKM-04: an address without a scheme gets https://, and an empty title becomes the host name
    await save(frame, { url: 'example.org/status', tags: ['ops'] }, 'example.org')
    await expect(bookmark(frame, 'example.org').getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://example.org/status')
    await accessible(page, 'bookmarks grid')

    // BKM-03: the search looks at title, address, note and tags; nothing found says so and the filters can be cleared
    const box = frame.getByRole('searchbox', { name: 'Search bookmarks' })
    await box.fill('learn')
    await expect(frame.locator('[data-testid=bookmark]')).toHaveCount(1)
    await box.fill('example.org/status')
    await expect(bookmark(frame, 'example.org')).toBeVisible()
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
    await expect(bookmark(frame, 'example.org')).toBeVisible()
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
})
