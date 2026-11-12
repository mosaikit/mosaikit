import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Dashboard (docs/manual-tests.md, DSH-01..05): the first board with every widget the apps offer, the number of open tasks,
// editing a board (remove, order, save) that survives a reload, a second board and the switch between boards, delete.
// It works whatever the other plugins did before: the tasks it needs it creates.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const labels = (frame: FrameLocator) => frame.locator('[data-testid=widget] h2').allTextContents()

async function openDashboard(page: Page) {
  await nav(page, 'Dashboard').click()
  const frame = frameOf(page)
  await expect(frame.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  return frame
}

test.describe.serial('Dashboard', () => {
  test('default board, numbers, editing, reload, second board', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)

    // a task to count: the widget of Tasks shows the tasks that are open for the person
    await nav(page, 'Tasks').click()
    const tasks = frameOf(page)
    await expect(tasks.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible()
    await tasks.getByRole('textbox', { name: 'Quick add a task' }).fill('DSH count me')
    await tasks.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(tasks.locator('.msk-item.tcard, .msk-kcard', { hasText: 'DSH count me' }).first()).toBeVisible()

    // DSH-01: the first time a board with every available widget; the widget of Tasks shows a number
    const frame = await openDashboard(page)
    await expect(frame.getByLabel('Board', { exact: true })).toBeVisible()
    const open = frame.locator('[data-testid=widget]', { hasText: 'Open tasks' }).first()
    await expect(open).toBeVisible()
    const n = Number((await open.getByTestId('widget-value').textContent()) ?? '')
    expect(n).toBeGreaterThanOrEqual(1)
    await accessible(page, 'dashboard board')

    // DSH-02: edit the board: move the first widget down, take the last one out, save
    const before = await labels(frame)
    expect(before.length).toBeGreaterThanOrEqual(2)
    await frame.getByRole('button', { name: 'Edit', exact: true }).click()
    const dlg = frame.getByRole('dialog')
    await expect(dlg.getByRole('heading', { name: 'Edit board' })).toBeVisible()
    await dlg.getByRole('button', { name: `Move down: ${before[0]}` }).click()
    await dlg.getByLabel(before[before.length - 1], { exact: true }).uncheck()
    await accessible(page, 'dashboard editor')
    await dlg.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dlg).toHaveCount(0)
    const expected = [before[1], before[0], ...before.slice(2, -1)]
    await expect(frame.locator('[data-testid=widget] h2')).toHaveText(expected)

    // the order stays after a reload
    await page.reload()
    const again = await openDashboard(page)
    await again.getByLabel('Board', { exact: true }).selectOption({ label: 'My dashboard' })
    await expect(again.locator('[data-testid=widget] h2')).toHaveText(expected)

    // DSH-03: a second board starts empty and asks for its widgets; it shows only the one chosen
    await again.getByRole('button', { name: /^＋ New board/ }).first().click()
    await again.getByRole('textbox', { name: 'Name', exact: true }).fill('DSH second')
    await again.getByRole('button', { name: 'Create', exact: true }).click()
    const dlg2 = again.getByRole('dialog')
    await expect(dlg2.getByRole('heading', { name: 'Edit board' })).toBeVisible()
    await dlg2.getByLabel(before[0], { exact: true }).check()
    await dlg2.getByLabel('Columns', { exact: true }).selectOption('2')
    await dlg2.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(again.locator('[data-testid=widget] h2')).toHaveText([before[0]])

    // switching boards shows the arrangement of each one
    await again.getByLabel('Board', { exact: true }).selectOption({ label: 'My dashboard' })
    await expect(again.locator('[data-testid=widget] h2')).toHaveText(expected)
    await again.getByLabel('Board', { exact: true }).selectOption({ label: 'DSH second' })
    await expect(again.locator('[data-testid=widget] h2')).toHaveText([before[0]])

    // DSH-04: a board with no widget chosen shows the empty state with its action
    await again.getByRole('button', { name: 'Edit', exact: true }).click()
    await again.getByRole('dialog').getByLabel(before[0], { exact: true }).uncheck()
    await again.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
    await expect(again.getByTestId('empty-state')).toBeVisible()
    await expect(again.getByTestId('empty-state').getByRole('button', { name: 'Choose widgets' })).toBeVisible()
    await accessible(page, 'dashboard empty board')

    // DSH-05: delete the second board; the first one stays
    await again.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(again.getByRole('dialog')).toContainText('Delete the board “DSH second”?')
    await again.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(again.getByLabel('Board', { exact: true }).locator('option', { hasText: 'DSH second' })).toHaveCount(0)
    await expect(again.locator('[data-testid=widget] h2')).toHaveText(expected)
  })
})
