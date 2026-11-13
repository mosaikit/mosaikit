import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Whiteboard (docs/manual-tests.md, WBD-01..08): the list with an empty state, a board with sticky notes, shapes and undo,
// saved in the item, two sessions drawing on the same board live (objects and pointers), accessible list and editor, deletion.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const canvasOf = (frame: FrameLocator) => frame.locator('.wb-svg')

async function drag(page: Page, canvas: Locator, from: { x: number; y: number }, to: { x: number; y: number }) {
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + from.x, box.y + from.y)
  await page.mouse.down()
  await page.mouse.move(box.x + (from.x + to.x) / 2, box.y + (from.y + to.y) / 2, { steps: 4 })
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 4 })
  await page.mouse.up()
}

async function openWhiteboards(page: Page) {
  await nav(page, 'Whiteboard').click()
  const frame = frameOf(page)
  await expect(frame.getByRole('heading', { name: 'Whiteboard', exact: true })).toBeVisible()
  return frame
}

async function openBoard(frame: FrameLocator, title: string) {
  await frame.getByRole('button', { name: `Open: ${title}` }).click()
  await expect(canvasOf(frame)).toBeVisible()
  await expect(frame.getByRole('textbox', { name: 'Title of the whiteboard' })).toHaveValue(title)
}

test.describe.serial('Whiteboard', () => {
  test('board: sticky note, shapes, undo, saved in the item, accessible', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await login(page, 'Alfa', 'manager', PASSWORD)
    const frame = await openWhiteboards(page)

    // WBD-01: nothing yet, the illustrated empty state with the primary action
    await expect(frame.getByTestId('empty-state')).toBeVisible()
    await expect(frame.getByTestId('empty-state').getByRole('button', { name: /New whiteboard/ })).toBeVisible()
    await accessible(page, 'whiteboard empty list')

    // WBD-02: create a board and open it in the editor
    await frame.getByTestId('empty-state').getByRole('button', { name: /New whiteboard/ }).click()
    await frame.getByRole('textbox', { name: 'Title', exact: true }).fill('WBD retro')
    await frame.getByRole('button', { name: 'Create' }).click()
    const canvas = canvasOf(frame)
    await expect(canvas).toBeVisible()
    await expect(frame.getByRole('textbox', { name: 'Title of the whiteboard' })).toHaveValue('WBD retro')
    await expect(canvas).toHaveAccessibleName('Whiteboard canvas')

    // WBD-03: a sticky note: pick the tool, click the canvas, type its text
    await frame.getByRole('button', { name: /^Sticky note/ }).click()
    await canvas.click({ position: { x: 150, y: 150 } })
    await frame.locator('textarea.wb-edit').fill('First idea')
    await frame.locator('textarea.wb-edit').press('Escape')
    await expect(frame.locator('.wb-obj[data-type="note"] text')).toContainText('First idea')

    // WBD-04: a rectangle by dragging, moved by dragging, and the move is undone
    await frame.getByRole('button', { name: /^Rectangle/ }).click()
    await drag(page, canvas, { x: 350, y: 300 }, { x: 500, y: 380 })
    const rect = frame.locator('.wb-obj[data-type="rect"] rect')
    await expect(rect).toHaveCount(1)
    const before = await rect.getAttribute('x')
    await drag(page, canvas, { x: 425, y: 340 }, { x: 525, y: 380 })
    await expect.poll(() => rect.getAttribute('x')).not.toBe(before)
    await frame.getByRole('button', { name: /^Undo/ }).click()
    await expect(rect).toHaveAttribute('x', before!)
    await expect(canvas).toHaveAccessibleDescription(/1 sticky notes, 1 rectangles/)

    // WBD-08 (editor): the toolbar buttons have names and the canvas has a description; axe passes
    await accessible(page, 'whiteboard editor')

    // WBD-05: saved in the item; after a reload the objects are there
    await expect(frame.locator('.wb-save')).toHaveText('Saved', { timeout: 20000 })
    await page.reload()
    const again = await openWhiteboards(page)
    await accessible(page, 'whiteboard list')
    await openBoard(again, 'WBD retro')
    await expect(again.locator('.wb-obj[data-type="note"] text')).toContainText('First idea')
    await expect(again.locator('.wb-obj[data-type="rect"]')).toHaveCount(1)

    // the way back to the list keeps the board in it
    await again.getByRole('button', { name: 'Back to the whiteboards' }).click()
    await expect(again.getByTestId('board').filter({ hasText: 'WBD retro' })).toBeVisible()
    await ctx.close()
  })

  test('two sessions draw on the same board live', async ({ browser }) => {
    // two sessions of one person stand for two people (the channel relays between connections)
    const a = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    const b = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    await login(a, 'Alfa', 'manager', PASSWORD)
    await login(b, 'Alfa', 'manager', PASSWORD)
    const fa = await openWhiteboards(a)
    await openBoard(fa, 'WBD retro')
    const fb = await openWhiteboards(b)
    await openBoard(fb, 'WBD retro')
    await expect(fb.locator('.wb-obj[data-type="note"]')).toHaveCount(1)

    // WBD-06: an object drawn in one appears in the other without a reload
    await fa.getByRole('button', { name: /^Ellipse/ }).click()
    await drag(a, canvasOf(fa), { x: 600, y: 120 }, { x: 760, y: 220 })
    await expect(fb.locator('.wb-obj[data-type="ellipse"]')).toHaveCount(1)
    // and a sticky note with its text, the other way
    await fb.getByRole('button', { name: /^Sticky note/ }).click()
    await canvasOf(fb).click({ position: { x: 300, y: 500 } })
    await fb.locator('textarea.wb-edit').fill('Second idea')
    await fb.locator('textarea.wb-edit').press('Escape')
    await expect(fa.locator('.wb-obj[data-type="note"] text', { hasText: 'Second idea' })).toBeVisible()

    // WBD-07 (the pointer of the other, with a name) is a manual check with two real people: two sessions of ONE person share
    // one presence entry and a person never sees their own pointer, so it cannot be asserted here; the unit tests of the
    // presence (sync.test.ts) cover it

    // an undo in one is an undo in the other
    await fb.getByRole('button', { name: /^Undo/ }).click()
    await fb.getByRole('button', { name: /^Undo/ }).click()
    await expect(fa.locator('.wb-obj[data-type="note"]')).toHaveCount(1)
    await a.context().close()
    await b.context().close()
  })

  test('delete a board', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    const frame = await openWhiteboards(page)
    const card = frame.getByTestId('board').filter({ hasText: 'WBD retro' })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Delete' }).click()
    await frame.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(frame.getByTestId('board').filter({ hasText: 'WBD retro' })).toHaveCount(0)
    await expect(frame.getByTestId('empty-state')).toBeVisible()
  })

  test('templates and frames', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await login(page, 'Alfa', 'manager', PASSWORD)
    const frame = await openWhiteboards(page)
    await frame.getByRole('button', { name: /New whiteboard/ }).first().click()
    await frame.getByRole('textbox', { name: 'Title', exact: true }).fill('WBD template')
    await frame.getByRole('button', { name: 'Create' }).click()
    const canvas = canvasOf(frame)
    await expect(canvas).toBeVisible()

    // WBD-14: a template puts its frames and notes on the board in one step, and one undo takes them away
    await frame.getByTestId('templates').click()
    await expect(frame.getByRole('dialog')).toContainText('Start from a template')
    await accessible(page, 'whiteboard templates')
    await frame.getByRole('dialog').locator('[data-template="kanban"]').click()
    await expect(frame.locator('.wb-obj[data-type="frame"]')).toHaveCount(3)
    await expect(frame.locator('.wb-obj[data-type="note"]')).toHaveCount(1)
    await expect(frame.locator('.wb-obj[data-type="frame"] text').nth(0)).toContainText('To do')
    await expect(canvas).toHaveAccessibleDescription(/3 frames/)
    await frame.getByRole('button', { name: /^Undo/ }).click()
    await expect(frame.locator('.wb-obj')).toHaveCount(0)

    // WBD-15: a frame drawn by dragging, named, holds a note: moving the frame by its title moves the note too
    await frame.getByRole('button', { name: /^Frame/ }).click()
    await drag(page, canvas, { x: 100, y: 120 }, { x: 500, y: 420 })
    await frame.locator('textarea.wb-edit').fill('Ideas')
    await frame.locator('textarea.wb-edit').press('Escape')
    await expect(frame.locator('.wb-obj[data-type="frame"] text')).toContainText('Ideas')
    await frame.getByRole('button', { name: /^Sticky note/ }).click()
    await canvas.click({ position: { x: 250, y: 250 } })
    await frame.locator('textarea.wb-edit').press('Escape')
    const note = frame.locator('.wb-obj[data-type="note"] rect').last()
    const before = Number(await note.getAttribute('x'))
    await drag(page, canvas, { x: 300, y: 130 }, { x: 380, y: 130 })
    await expect.poll(async () => Number(await note.getAttribute('x'))).toBeGreaterThan(before + 40)
    await accessible(page, 'whiteboard frame')
    await ctx.close()
  })

  test('delete the board of the templates', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    const frame = await openWhiteboards(page)
    await frame.getByTestId('board').filter({ hasText: 'WBD template' }).getByRole('button', { name: 'Delete' }).click()
    await frame.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(frame.getByTestId('board').filter({ hasText: 'WBD template' })).toHaveCount(0)
  })
})
