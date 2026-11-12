import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Notes 2.0 (docs/manual-tests.md, NOT-01..04): Markdown text with a check list and its progress, live boxes in the reader,
// pinned notes first, archive and restore, export as Markdown.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const postit = (frame: FrameLocator, title: string) => frame.locator('.msk-item.pi', { hasText: title }).first()

async function openNotes(page: Page) {
  await nav(page, 'Notes').click()
  const frame = frameOf(page)
  await expect(frame.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible()
  return frame
}

async function add(frame: FrameLocator, title: string, body: string) {
  await frame.getByRole('button', { name: /^＋ New/ }).first().click()
  await frame.locator('[data-key="title"]').fill(title)
  await frame.locator('[data-key="body"]').fill(body)
  await frame.getByRole('button', { name: 'Save' }).click()
  await expect(frame.locator('.note-read h2', { hasText: title })).toBeVisible()
}

test.describe.serial('Notes 2.0', () => {
  test('Markdown, check list, pin, archive, export', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
    const page = await ctx.newPage()
    await login(page, 'Alfa', 'manager', PASSWORD)
    const frame = await openNotes(page)

    // NOT-01: the toolbar writes Markdown; the post-it and the reader draw it; a check list shows its progress
    await frame.getByRole('button', { name: /^＋ New/ }).first().click()
    await frame.locator('[data-key="title"]').fill('NOT plan')
    const ta = frame.locator('[data-key="body"]')
    await ta.fill('Shopping')
    await ta.evaluate((e: HTMLTextAreaElement) => e.select())
    await frame.getByRole('button', { name: 'Bold', exact: true }).click()
    await expect(ta).toHaveValue('**Shopping**')
    await ta.press('End')
    await ta.pressSequentially('\n- [ ] milk\n- [x] bread\n- [ ] eggs')
    await frame.getByRole('button', { name: 'Save' }).click()
    await expect(frame.locator('.note-read h2', { hasText: 'NOT plan' })).toBeVisible()
    await expect(frame.locator('.note-read .nread strong', { hasText: 'Shopping' })).toBeVisible()
    await expect(frame.locator('.note-read .npg .msk-progress')).toHaveAttribute('aria-valuenow', '1')

    // NOT-02: the boxes of the reader are live and the post-it follows
    await frame.locator('.note-read .nread input[type=checkbox]').first().check()
    await expect(frame.locator('.note-read .npg .msk-progress')).toHaveAttribute('aria-valuenow', '2')
    await frame.locator('.msk-detail').press('Escape')
    await expect(postit(frame, 'NOT plan').locator('.ncount')).toHaveText('2/3')
    await expect(postit(frame, 'NOT plan').locator('strong', { hasText: 'Shopping' })).toBeVisible()

    // NOT-03: a pinned note goes first
    await add(frame, 'NOT other', 'plain')
    await frame.locator('.msk-detail').press('Escape')
    await expect(frame.locator('.msk-item.pi').first()).toContainText('NOT other')
    await postit(frame, 'NOT plan').hover()
    await postit(frame, 'NOT plan').getByRole('button', { name: 'Pin' }).click()
    await expect(frame.locator('.msk-item.pi').first()).toContainText('NOT plan')
    await expect(postit(frame, 'NOT plan')).toHaveClass(/pinned/)

    // NOT-04: export as Markdown; archive takes the note out of the list
    await postit(frame, 'NOT plan').click()
    const [file] = await Promise.all([page.waitForEvent('download'), frame.getByRole('button', { name: 'Export as Markdown' }).click()])
    expect(file.suggestedFilename()).toBe('NOT plan.md')
    await frame.getByRole('button', { name: 'Archive', exact: true }).click()
    await frame.locator('.msk-detail').press('Escape').catch(() => undefined)
    await expect(frame.locator('.msk-item.pi', { hasText: 'NOT plan' })).toHaveCount(0)
    await expect(postit(frame, 'NOT other')).toBeVisible()

    await accessible(page, 'notes 2.0')
    await ctx.close()
  })

  test('two people edit the same note together', async ({ browser }) => {
    // two sessions of one person stand for two people (the channel relays between connections)
    const a = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    const b = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    await login(a, 'Alfa', 'manager', PASSWORD)
    await login(b, 'Alfa', 'manager', PASSWORD)
    const fa = await openNotes(a)
    await add(fa, 'NOT together', 'base')
    await fa.locator('.msk-detail').press('Escape')
    const fb = await openNotes(b)
    for (const f of [fa, fb]) {
      await postit(f, 'NOT together').click()
      await f.getByRole('button', { name: 'Edit', exact: true }).click()
    }
    const ta = fa.locator('[data-key="body"]')
    const tb = fb.locator('[data-key="body"]')
    await expect(ta).toHaveValue('base')
    await expect(tb).toHaveValue('base')
    // let both documents be set up (a newcomer waits a moment for an answer before it takes the saved text)
    await a.waitForTimeout(1800)

    // what one types shows in the other, and the two ends are the same text
    await ta.press('End')
    await ta.pressSequentially(' from A')
    await expect(tb).toHaveValue('base from A')
    await tb.press('Home')
    await tb.pressSequentially('B: ')
    await expect(ta).toHaveValue('B: base from A')
    // both type at once: nothing is lost and they agree
    await Promise.all([ta.press('End').then(() => ta.pressSequentially(' [a]')), tb.press('End').then(() => tb.pressSequentially(' [b]'))])
    await expect.poll(async () => (await ta.inputValue()) === (await tb.inputValue()), { timeout: 10000 }).toBe(true)
    const final = await ta.inputValue()
    // typing at the same place interleaves the letters of the two (as in any editor of this kind): nothing is lost, both agree
    expect(final.length).toBe('B: base from A'.length + ' [a]'.length + ' [b]'.length)
    expect(final.startsWith('B: base from A')).toBe(true)
    expect([...final.slice('B: base from A'.length)].sort().join('')).toBe([...' [a] [b]'].sort().join(''))

    // saving keeps the shared text
    await fa.getByRole('button', { name: 'Save' }).click()
    await expect(fa.locator('.nread', { hasText: 'B: base from A' })).toBeVisible()
    await a.context().close()
    await b.context().close()
  })
})
