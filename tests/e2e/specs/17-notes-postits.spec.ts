import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Notes as post-its (docs/manual-tests.md, NPI-01..04): colour, quick colour menu, resize (keyboard and drag) kept after a
// reload, tags of the person (create, rename, change colour, delete removes it from the notes), filter by tag, light and dark.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const postit = (frame: FrameLocator, title: string) => frame.locator('.msk-item.pi', { hasText: title })
const size = (frame: FrameLocator, title: string) =>
  postit(frame, title).evaluate((e) => ({ w: Math.round((e as HTMLElement).offsetWidth), h: Math.round((e as HTMLElement).offsetHeight) }))

async function openNotes(page: Page) {
  await nav(page, 'Notes').click()
  const frame = frameOf(page)
  await expect(frame.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible()
  return frame
}

test.describe.serial('Notes: post-its', () => {
  test('colour, size kept after a reload, tags (create, rename, colour, delete), filter, dark mode', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await login(page, 'Alfa', 'manager', PASSWORD)
    let frame = await openNotes(page)

    // a note with a colour from the editor and a tag of its own
    await frame.getByRole('button', { name: /^＋ New/ }).first().click()
    await frame.locator('[data-key="title"]').fill('Postit A')
    await frame.locator('[data-key="body"]').fill('Buy paper\nCall Anna')
    await frame.getByRole('radio', { name: 'pink' }).click()
    await frame.getByRole('textbox', { name: 'New tag' }).fill('ideas')
    await frame.getByRole('button', { name: 'Add', exact: true }).click()
    await frame.getByRole('button', { name: 'Save' }).click()
    await expect(postit(frame, 'Postit A')).toHaveClass(/pc-pink/)
    await expect(postit(frame, 'Postit A').locator('.pi-tag', { hasText: 'ideas' })).toBeVisible()
    await expect(postit(frame, 'Postit A').locator('.pi-tag', { hasText: 'personal' })).toHaveCount(0)
    // a post-it is slightly turned, the same on every drawing, straight under the pointer
    const tilt = () => postit(frame, 'Postit A').evaluate((e) => (e as HTMLElement).style.getPropertyValue('--pi-tilt'))
    const t0 = await tilt()
    expect(t0).toMatch(/deg$/)

    // the quick menu of the colour on the post-it
    await frame.locator('.msk-detail').press('Escape')
    await postit(frame, 'Postit A').locator('.pi-pal').click()
    await postit(frame, 'Postit A').getByRole('button', { name: 'blue' }).click()
    await expect(postit(frame, 'Postit A')).toHaveClass(/pc-blue/)

    // size: Alt+arrows, bounds, drag; all kept after a reload
    const start = await size(frame, 'Postit A')
    expect(start).toEqual({ w: 240, h: 200 })
    await postit(frame, 'Postit A').focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press('Alt+ArrowRight')
    await expect.poll(async () => (await size(frame, 'Postit A')).w).toBe(300)
    // the size is saved a moment after the last key; the list is drawn again with it
    await expect(postit(frame, 'Postit A')).toBeFocused()
    for (let i = 0; i < 20; i++) await page.keyboard.press('Alt+ArrowUp')
    await expect.poll(async () => (await size(frame, 'Postit A')).h).toBe(120)
    const grip = postit(frame, 'Postit A').locator('.pi-grip')
    await expect(grip).toBeVisible()
    const g = (await grip.boundingBox())!
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
    await page.mouse.down()
    await page.mouse.move(g.x + g.width / 2 + 60, g.y + g.height / 2 + 120, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => size(frame, 'Postit A')).toEqual({ w: 360, h: 240 })
    await page.reload()
    frame = await openNotes(page)
    await expect.poll(async () => size(frame, 'Postit A')).toEqual({ w: 360, h: 240 })
    await expect(postit(frame, 'Postit A')).toHaveClass(/pc-blue/)
    expect(await tilt()).toBe(t0)
    // too big or too small never goes past the bounds
    await postit(frame, 'Postit A').focus()
    for (let i = 0; i < 12; i++) await page.keyboard.press('Alt+Shift+ArrowRight')
    await expect.poll(async () => (await size(frame, 'Postit A')).w).toBe(480)

    // a second note with a tag chosen from the list of tags
    await frame.getByRole('button', { name: /^＋ New/ }).first().click()
    await frame.locator('[data-key="title"]').fill('Postit B')
    await frame.getByRole('button', { name: 'ideas', exact: true }).click()
    await frame.getByRole('textbox', { name: 'New tag' }).fill('errands')
    await frame.getByRole('button', { name: 'Add', exact: true }).click()
    await frame.getByRole('button', { name: 'Save' }).click()
    await expect(postit(frame, 'Postit B').locator('.pi-tag')).toHaveText(['ideas', 'errands'])

    // filter by tag
    await frame.getByLabel('Filter by tag').selectOption('errands')
    await expect(postit(frame, 'Postit B')).toBeVisible()
    await expect(postit(frame, 'Postit A')).toHaveCount(0)
    await frame.getByLabel('Filter by tag').selectOption('')
    await expect(postit(frame, 'Postit A')).toBeVisible()

    // tags: change the colour, rename, create, delete (the tag leaves the notes)
    await frame.getByRole('button', { name: 'Tags', exact: true }).click()
    const dlg = frame.getByRole('dialog', { name: 'Tags' })
    await expect(dlg).toBeVisible()
    await dlg.getByRole('textbox', { name: 'Name of the tag', exact: true }).fill('later')
    await dlg.getByLabel('Colour', { exact: true }).selectOption('teal')
    await dlg.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dlg.getByRole('textbox', { name: 'Name of the tag later' })).toBeVisible()
    await dlg.getByLabel('Colour of the tag later').selectOption('green')
    await expect(dlg.locator('li.pi-trow:has(input[aria-label="Name of the tag later"]) .pi-dot')).toHaveClass(/pc-green/)
    await dlg.getByRole('textbox', { name: 'Name of the tag errands' }).fill('shopping')
    await dlg.getByRole('textbox', { name: 'Name of the tag shopping' }).press('Enter')
    await expect(dlg.getByRole('textbox', { name: 'Name of the tag shopping' })).toBeVisible()
    await dlg.getByLabel('Colour of the tag shopping').selectOption('orange')
    await expect(dlg.locator('li.pi-trow:has(input[aria-label="Name of the tag shopping"]) .pi-used')).toHaveText('1 note')
    await dlg.getByRole('button', { name: 'Close' }).click()
    await expect(frame.getByRole('dialog')).toHaveCount(0)
    // every tag has its own colour, not the colour of the note
    await expect(postit(frame, 'Postit B').locator('.pi-tag', { hasText: 'shopping' })).toHaveClass(/pc-orange/)
    await expect(postit(frame, 'Postit B')).toHaveClass(/pc-yellow/)
    await expect(postit(frame, 'Postit B').locator('.pi-tag', { hasText: 'errands' })).toHaveCount(0)

    await frame.getByRole('button', { name: 'Tags', exact: true }).click()
    await dlg.getByRole('button', { name: 'Delete the tag ideas' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click()
    await expect(dlg.getByRole('textbox', { name: 'Name of the tag ideas' })).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Close' }).click()
    await expect(postit(frame, 'Postit A').locator('.pi-tag')).toHaveCount(0)
    await expect(postit(frame, 'Postit B').locator('.pi-tag')).toHaveText(['shopping'])
    // and after a reload, the notes keep it that way
    await page.reload()
    frame = await openNotes(page)
    await expect(postit(frame, 'Postit A')).toBeVisible()
    await expect(postit(frame, 'Postit A').locator('.pi-tag')).toHaveCount(0)
    await expect(frame.getByLabel('Filter by tag').locator('option', { hasText: 'ideas' })).toHaveCount(0)

    // the list view stays available
    await frame.getByRole('button', { name: 'List' }).click()
    await expect(frame.locator('.msk-item', { hasText: 'Postit B' }).locator('.pi-tag', { hasText: 'shopping' })).toBeVisible()
    await frame.getByRole('button', { name: 'Post-its' }).click()
    await expect(postit(frame, 'Postit B')).toBeVisible()

    // light and dark: nothing breaks the contrast
    await accessible(page, 'notes post-its')
    await page.evaluate(() => localStorage.setItem('msk_mode', 'dark'))
    await page.reload()
    frame = await openNotes(page)
    await expect(frame.locator('html')).toHaveAttribute('data-mode', 'dark')
    await expect(postit(frame, 'Postit A')).toBeVisible()
    await accessible(page, 'notes post-its dark')
    await page.evaluate(() => localStorage.removeItem('msk_mode'))
    await ctx.close()
  })
})
