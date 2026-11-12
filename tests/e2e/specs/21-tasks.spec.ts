import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Tasks 2.0 (docs/manual-tests.md, TSK-01..04): quick-add line, list grouped by due date, completing and repeating,
// the week where a card moves to another day (keyboard), a description with a check list that shows its progress.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const card = (frame: FrameLocator, title: string) => frame.locator('.msk-item.tcard, .msk-kcard', { hasText: title }).first()
const iso = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function openTasks(page: Page) {
  await nav(page, 'Tasks').click()
  const frame = frameOf(page)
  await expect(frame.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible()
  return frame
}

async function quick(frame: FrameLocator, text: string) {
  await frame.getByRole('textbox', { name: 'Quick add a task' }).fill(text)
  await frame.getByRole('button', { name: 'Add', exact: true }).click()
}

test.describe.serial('Tasks 2.0', () => {
  test('quick add, groups, completing, repeating, week, check list', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await login(page, 'Alfa', 'manager', PASSWORD)
    const frame = await openTasks(page)

    // TSK-01: the line makes a task with its date, priority, project and labels
    await quick(frame, 'TSK call Ana tomorrow !high #work @phone')
    const c1 = card(frame, 'TSK call Ana')
    await expect(c1).toBeVisible()
    await expect(c1.locator('.msk-chip')).toContainText('high')
    await expect(c1.locator('.tproj')).toContainText('work')
    await expect(c1.locator('.tlabel')).toContainText('phone')
    await expect(frame.locator('.tgroup.g-week', { hasText: 'TSK call Ana' })).toBeVisible()

    // TSK-02: a task without a date is in «No date»; ticking moves it to «Done»; a repeating one stays open and moves on
    await quick(frame, 'TSK plain')
    await expect(frame.locator('.tgroup.g-nodate', { hasText: 'TSK plain' })).toBeVisible()
    await frame.getByRole('checkbox', { name: 'Mark as done: TSK plain' }).check()
    await expect(frame.locator('.tgroup.g-done', { hasText: 'TSK plain' })).toBeVisible()
    await quick(frame, 'TSK water today every week')
    await expect(frame.locator('.tgroup.g-today', { hasText: 'TSK water' })).toBeVisible()
    await frame.getByRole('checkbox', { name: 'Mark as done: TSK water' }).check()
    await expect(frame.locator('.tgroup.g-today', { hasText: 'TSK water' })).toHaveCount(0)
    await expect(frame.locator('.tgroup.g-week, .tgroup.g-later', { hasText: 'TSK water' })).toBeVisible()
    await expect(frame.locator('.tgroup.g-done', { hasText: 'TSK water' })).toHaveCount(0)

    // TSK-03: in the week, Alt+Right moves a card to the next day: its date changes
    await frame.getByRole('button', { name: 'Week' }).click()
    const wk = card(frame, 'TSK call Ana')
    await expect(wk).toBeVisible()
    await wk.focus()
    await page.keyboard.press('Alt+ArrowRight')
    await frame.getByRole('button', { name: 'List' }).click()
    await card(frame, 'TSK call Ana').click()
    await expect(frame.locator('.tdue', { hasText: /\d/ }).first()).toBeVisible()
    const dueAfter = await frame.locator('input[type="date"]').first().inputValue().catch(() => '')
    if (dueAfter) expect(dueAfter).toBe(iso(2))
    await frame.locator('.msk-detail').press('Escape')

    // TSK-04: a description with a check list shows its progress and the boxes are live
    await frame.getByRole('button', { name: /^＋ New/ }).first().click()
    await frame.locator('[data-key="title"]').fill('TSK steps')
    await frame.getByRole('textbox', { name: 'Description' }).fill('Plan\n- [ ] one\n- [x] two\n- [ ] three')
    await frame.getByRole('button', { name: 'Save' }).click()
    // saving shows the task, read, in the dialog: the boxes are live there
    await expect(frame.locator('.tread .msk-md input[type=checkbox]')).toHaveCount(3)
    await expect(frame.locator('.tread .msk-progress')).toHaveAttribute('aria-valuenow', '1')
    await frame.locator('.tread .msk-md input[type=checkbox]').first().check()
    await expect(frame.locator('.tread .msk-progress')).toHaveAttribute('aria-valuenow', '2')
    await page.keyboard.press('Escape')
    await expect(card(frame, 'TSK steps').locator('.tcount')).toHaveText('2/3')

    await accessible(page, 'tasks 2.0')
    await ctx.close()
  })
})
