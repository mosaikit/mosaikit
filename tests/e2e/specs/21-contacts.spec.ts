import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Contacts 2.0 (docs/manual-tests.md, CON-01..04): cards by letter with tags, filter by tag, the A–Z list, the reading panel
// with quick actions, vCard and CSV import and export, the finder of duplicates.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const item = (frame: FrameLocator, name: string) => frame.locator('.msk-item', { hasText: name }).first()

async function openContacts(page: Page) {
  await nav(page, 'Contacts').click()
  const frame = frameOf(page)
  await expect(frame.getByRole('heading', { name: 'Contacts', exact: true })).toBeVisible()
  return frame
}

async function add(frame: FrameLocator, page: Page, v: Record<string, string>, tags: string[] = []) {
  await frame.getByRole('button', { name: /^＋ New/ }).first().click()
  for (const [k, val] of Object.entries(v)) await frame.locator(`[data-key="${k}"]`).first().fill(val)
  for (const t of tags) {
    await frame.locator('.msk-taginput input').fill(t)
    await frame.locator('.msk-taginput input').press('Enter')
  }
  await frame.getByRole('button', { name: 'Save' }).click()
  await expect(frame.locator('.contact-read h2', { hasText: v.name! })).toBeVisible()
  await page.keyboard.press('Escape')
}

test.describe.serial('Contacts 2.0', () => {
  test('cards, tags, list, reader, vCard and CSV, duplicates', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
    const page = await ctx.newPage()
    await login(page, 'Alfa', 'manager', PASSWORD)
    const frame = await openContacts(page)

    // CON-01: a contact with a job, an organization and tags; the reader has quick actions
    await add(frame, page, { name: 'CON Ada Lovelace', email: 'ada@example.org', phone: '+39 333 111', job_title: 'Engineer', org: 'Analytical', birthday: '1990-01-01' }, ['vip', 'math'])
    await add(frame, page, { name: 'CON Bob Stone', email: 'bob@example.org' }, ['math'])
    await expect(item(frame, 'CON Ada').locator('.csub')).toHaveText('Engineer · Analytical')
    await expect(item(frame, 'CON Ada').locator('.ctag', { hasText: 'vip' })).toBeVisible()
    await item(frame, 'CON Ada').click()
    await expect(frame.locator('.contact-read a.msk-btn[href^="mailto:"]')).toBeVisible()
    await expect(frame.locator('.contact-read a.msk-btn[href^="tel:"]')).toHaveAttribute('href', 'tel:+39333111')
    await page.keyboard.press('Escape')

    // CON-02: the filter by tag keeps only the people with it; the list view shows the same people
    await frame.locator('.ctags .ctag.pick', { hasText: 'vip' }).click()
    await expect(item(frame, 'CON Ada')).toBeVisible()
    await expect(frame.locator('.msk-item', { hasText: 'CON Bob' })).toHaveCount(0)
    await frame.locator('.ctags .ctag.pick', { hasText: 'All' }).click()
    await frame.getByRole('button', { name: 'List' }).click()
    await expect(frame.locator('.crow', { hasText: 'CON Bob' })).toBeVisible()
    await expect(frame.locator('.cgroup h2', { hasText: 'C' }).first()).toBeVisible()
    await frame.getByRole('button', { name: 'Cards' }).click()

    // CON-03: export in both formats; import of a vCard and of a CSV
    await frame.getByRole('button', { name: /Export/ }).click()
    const [vcf] = await Promise.all([page.waitForEvent('download'), frame.getByRole('menuitem', { name: /vCard/ }).click()])
    expect(vcf.suggestedFilename()).toBe('contacts.vcf')
    const input = frame.locator('input[type=file]')
    const card = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:CON Carl Gauss\r\nEMAIL:carl@example.org\r\nTEL:+39 444 222\r\nEND:VCARD\r\n'
    await input.setInputFiles({ name: 'people.vcf', mimeType: 'text/vcard', buffer: Buffer.from(card) })
    await frame.getByRole('button', { name: 'Import', exact: true }).last().click()
    await expect(item(frame, 'CON Carl Gauss')).toBeVisible()
    const csv = 'name,email,phone\nCON Dora Klein,dora@example.org,333 555\nCON Erik Wu,bad-email,\n'
    await input.setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await frame.getByRole('button', { name: 'Import', exact: true }).last().click()
    await expect(item(frame, 'CON Dora Klein')).toBeVisible()
    await expect(frame.locator('.msk-item', { hasText: 'CON Erik Wu' })).toHaveCount(0)

    // CON-04: the same email twice is found as a duplicate
    await add(frame, page, { name: 'CON Ada L.', email: 'ADA@example.org' })
    await frame.getByRole('button', { name: /Duplicates/ }).click()
    const dlg = frame.locator('dialog.msk-modal[open]')
    await expect(dlg.locator('.cdup li', { hasText: 'CON Ada Lovelace' })).toBeVisible()
    await expect(dlg.locator('.cdup li', { hasText: 'CON Ada L.' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Close' }).click()

    await accessible(page, 'contacts 2.0')
    await ctx.close()
  })
})
