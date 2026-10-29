import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Contacts, Tasks and Notes (docs/manual-tests.md, PUI-01..04): items drawn as cards or a board next to a detail panel,
// the header pinned, the panel over the list on a phone, light and dark.

const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')

async function add(frame: FrameLocator, values: Record<string, string | boolean>) {
  await frame.getByRole('button', { name: /^＋ New/ }).first().click()
  for (const [k, v] of Object.entries(values)) {
    const el = frame.locator(`[data-key="${k}"]`).first()
    if (typeof v === 'boolean') await (v ? el.check() : el.uncheck())
    else if (['priority', 'tag', 'company'].includes(k)) await el.selectOption(v)
    else await el.fill(v)
  }
  await frame.getByRole('button', { name: 'Save' }).click()
  // saved: the item is in the list (the next one starts from a settled page)
  await expect(frame.locator('.msk-item', { hasText: String(Object.values(values)[0]) }).first()).toBeVisible()
}

/** Nothing of the page scrolls sideways, and the header of the plugin stays at the top of the frame. */
async function pinned(frame: FrameLocator) {
  const r = await frame.locator('html').evaluate((h) => ({ wide: h.scrollWidth > h.clientWidth, top: Math.round(document.querySelector('.msk-pagehead')!.getBoundingClientRect().top), page: h.scrollHeight > h.clientHeight }))
  expect(r.wide).toBe(false)
  expect(r.top).toBe(0)
  expect(r.page).toBe(false)
}

test.describe.serial('15-plugin-layouts', () => {
  test('Contacts: cards with initials, a reading panel, then the form', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await nav(page, 'Contacts').click()
    const frame = frameOf(page)
    await add(frame, { name: 'Ada Lovelace', email: 'ada@example.org', company: 'Customer' })
    const card = frame.locator('.msk-item', { hasText: 'Ada Lovelace' })
    await expect(card.locator('.msk-avatar')).toHaveText('AL')
    await expect(card).toContainText('Customer')
    // the new contact is open for reading: name, the address as a link, Edit
    await expect(frame.locator('.contact-read h2')).toHaveText('Ada Lovelace')
    await expect(frame.locator('.contact-read a[href="mailto:ada@example.org"]')).toBeVisible()
    await expect(frame.locator('[data-key="name"]')).toBeHidden()
    await frame.getByRole('button', { name: 'Edit' }).click()
    await expect(frame.locator('[data-key="name"]')).toHaveValue('Ada Lovelace')
    await frame.getByRole('button', { name: 'Cancel' }).click()
    await expect(frame.locator('.contact-read')).toBeVisible()
    // the filter is on the first row of the header, just left of «New contact»
    const box = async (sel: string) => frame.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), right: Math.round(r.right) } })
    const f = await box('.msk-filter'), n = await box('.msk-pacts .msk-btn')
    expect(Math.abs(f.top - n.top)).toBeLessThan(12)
    expect(f.right).toBeLessThanOrEqual(n.right)
    await pinned(frame)
    await accessible(page, 'contacts')
  })

  test('Tasks: list with chips, tick to complete, board by status', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await nav(page, 'Tasks').click()
    const frame = frameOf(page)
    await add(frame, { title: 'Send the offer', due: day(-3), priority: 'high' })
    await add(frame, { title: 'Prepare the meeting', due: day(5), priority: 'medium' })
    const late = frame.locator('.msk-item', { hasText: 'Send the offer' })
    await expect(late.locator('.msk-chip')).toHaveText('high')
    await expect(late.locator('.tdue.late')).toBeVisible()
    await expect(frame.locator('.msk-item', { hasText: 'Prepare the meeting' }).locator('.tdue.late')).toHaveCount(0)
    // the board: Overdue, Open and Done
    await frame.getByRole('button', { name: 'Board' }).click()
    await expect(frame.locator('.msk-col')).toHaveCount(3)
    await expect(frame.locator('.msk-col', { hasText: 'Overdue' }).locator('.msk-item', { hasText: 'Send the offer' })).toBeVisible()
    await expect(frame.locator('.msk-col', { hasText: 'Open' }).locator('.msk-item', { hasText: 'Prepare the meeting' })).toBeVisible()
    // ticking the box completes the task without opening it: it moves to Done
    await frame.getByRole('checkbox', { name: 'Mark as done: Send the offer' }).check()
    await expect(frame.locator('.msk-col', { hasText: 'Done' }).locator('.msk-item', { hasText: 'Send the offer' })).toBeVisible()
    await expect(frame.locator('.msk-col', { hasText: 'Done' }).locator('.task.done')).toHaveCount(1)
    await pinned(frame)
    await accessible(page, 'tasks')
    // the choice of view is kept
    await page.reload()
    await expect(frame.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true')
    await frame.getByRole('button', { name: 'List' }).click()
  })

  test('Notes: cards, reading pane, edit; the panel covers the list on a phone; dark mode', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    await login(page, 'Alfa', 'manager', PASSWORD)
    await nav(page, 'Notes').click()
    const frame = frameOf(page)
    await add(frame, { title: 'Weekly plan', body: 'Monday: kickoff\nTuesday: review', tag: 'work' })
    const card = frame.locator('.msk-item', { hasText: 'Weekly plan' })
    await expect(card.locator('.msk-chip', { hasText: 'work' })).toBeVisible()
    await expect(card.locator('.nbody')).toContainText('Monday: kickoff')
    await expect(frame.locator('.note-read h2')).toHaveText('Weekly plan')
    await expect(frame.locator('.nread')).toContainText('Tuesday: review')
    await frame.getByRole('button', { name: 'Edit' }).click()
    await frame.locator('[data-key="title"]').fill('Weekly plan v2')
    await frame.getByRole('button', { name: 'Save' }).click()
    await expect(frame.locator('.note-read h2')).toHaveText('Weekly plan v2')
    await accessible(page, 'notes')
    // dark mode
    await page.evaluate(() => localStorage.setItem('msk_mode', 'dark'))
    await page.reload()
    await expect(frame.locator('html')).toHaveAttribute('data-mode', 'dark')
    await pinned(frame)
    await accessible(page, 'notes dark')
    // phone: the list alone, the panel over it once a note is open, Escape closes it
    await page.setViewportSize({ width: 390, height: 800 })
    await expect(frame.locator('.msk-detail')).toBeHidden()
    await pinned(frame)
    await frame.locator('.msk-item', { hasText: 'Weekly plan v2' }).click()
    await expect(frame.locator('.msk-detail')).toBeVisible()
    await expect(frame.locator('.note-read h2')).toBeVisible()
    await pinned(frame)
    await frame.locator('.msk-detail').press('Escape')
    await expect(frame.locator('.msk-detail')).toBeHidden()
    await expect(frame.locator('.msk-item', { hasText: 'Weekly plan v2' })).toBeFocused()
    await ctx.close()
  })
})
