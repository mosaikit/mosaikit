import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Projects (docs/manual-tests.md, PRJ-01..10): the list with an empty state, a project with a board whose tasks belong to the
// Tasks plugin, the «Move to…» menu, the progress, milestones, sprints, attaching an existing task and the details.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const task = (frame: FrameLocator, title: string) => frame.locator('[data-testid=task]', { hasText: title }).first()
const column = (frame: FrameLocator, name: string) => frame.locator(`.msk-kcol[data-col="${name}"]`)
const iso = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function openProject(page: Page, name: string) {
  await nav(page, 'Projects').click()
  await frameOf(page).getByRole('button', { name, exact: true }).click()
  await expect(frameOf(page).getByRole('heading', { name, exact: true })).toBeVisible()
}

test.describe.serial('Projects', () => {
  test('a project with a board, progress, milestones, sprints and attached tasks', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await nav(page, 'Projects').click()
    const frame = frameOf(page)
    await expect(frame.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()

    // PRJ-01: nothing yet, the illustrated empty state with the primary action
    await expect(frame.getByTestId('empty-state')).toBeVisible()
    await expect(frame.getByTestId('empty-state').getByRole('button', { name: /New project/ })).toBeVisible()
    await accessible(page, 'projects empty')

    // PRJ-02: a new project opens on its board with the default columns
    await frame.getByTestId('empty-state').getByRole('button', { name: /New project/ }).click()
    await frame.getByRole('textbox', { name: 'Name', exact: true }).fill('PRJ Alpha')
    await frame.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(frame.getByRole('heading', { name: 'PRJ Alpha', exact: true })).toBeVisible()
    for (const c of ['To do', 'Doing', 'Done']) await expect(column(frame, c)).toBeVisible()
    await expect(frame.locator('.pj-head')).toContainText('No tasks yet')

    // PRJ-03: three tasks added from the board, in the first column
    for (const t of ['PRJ one', 'PRJ two', 'PRJ three']) {
      await frame.getByRole('textbox', { name: 'Add a task to To do' }).fill(t)
      await frame.getByRole('textbox', { name: 'Add a task to To do' }).press('Enter')
      await expect(column(frame, 'To do').locator('[data-testid=task]', { hasText: t })).toBeVisible()
    }
    await expect(frame.locator('.pj-head')).toContainText('0 of 3 tasks done')
    await accessible(page, 'projects board')

    // PRJ-04: «Move to…» moves a card to another column (the keyboard alternative of the drag and drop)
    await task(frame, 'PRJ two').getByRole('button', { name: /Move to…/ }).click()
    await frame.getByRole('menuitem', { name: 'Doing', exact: true }).click()
    await expect(column(frame, 'Doing').locator('[data-testid=task]', { hasText: 'PRJ two' })).toBeVisible()
    await task(frame, 'PRJ three').getByRole('button', { name: /Move to…/ }).click()
    await frame.getByRole('menuitem', { name: 'Done', exact: true }).click()
    await expect(column(frame, 'Done').locator('[data-testid=task]', { hasText: 'PRJ three' })).toBeVisible()
    // moving to the last column does not complete the task: the progress counts the done tasks of Tasks
    await expect(frame.locator('.pj-head')).toContainText('0 of 3 tasks done')

    // PRJ-05: the tasks are tasks of the Tasks plugin and carry the name of the project; completing one there moves the progress
    await nav(page, 'Tasks').click()
    const tasks = frameOf(page)
    await expect(tasks.locator('.tproj', { hasText: 'PRJ Alpha' })).toHaveCount(3)
    await tasks.getByRole('checkbox', { name: 'Mark as done: PRJ one' }).check()
    await expect(tasks.getByRole('checkbox', { name: 'Reopen: PRJ one' })).toBeChecked()
    await openProject(page, 'PRJ Alpha')
    await expect(frame.locator('.pj-head')).toContainText('1 of 3 tasks done')
    await expect(frame.locator('.pj-head')).toContainText('33% complete')
    await expect(frame.getByRole('progressbar').first()).toHaveAttribute('aria-valuenow', '1')
    // a placed card stays in its column (the board does not move it): the card shows the done mark in words
    await expect(column(frame, 'To do').locator('[data-testid=task]', { hasText: 'PRJ one' })).toContainText('Done')

    // PRJ-06: milestones with dates, an overdue one is marked in words
    await frame.getByRole('button', { name: 'Milestones', exact: true }).click()
    await expect(frame.getByTestId('empty-state')).toBeVisible()
    await frame.getByRole('button', { name: /Add milestone/ }).first().click()
    await frame.getByRole('textbox', { name: 'Name', exact: true }).fill('PRJ beta')
    await frame.getByLabel('Date', { exact: true }).fill('2020-01-01')
    await frame.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(frame.locator('[data-testid=milestone]', { hasText: 'PRJ beta' })).toContainText('Overdue')
    await frame.getByRole('button', { name: /Add milestone/ }).first().click()
    await frame.getByRole('textbox', { name: 'Name', exact: true }).fill('PRJ launch')
    await frame.getByLabel('Date', { exact: true }).fill(iso(30))
    await frame.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(frame.locator('[data-testid=milestone]', { hasText: 'PRJ launch' })).not.toContainText('Overdue')
    await frame.getByRole('checkbox', { name: 'Mark “PRJ beta” as done' }).check()
    await expect(frame.locator('[data-testid=milestone]', { hasText: 'PRJ beta' })).not.toContainText('Overdue')
    await accessible(page, 'projects milestones')

    // PRJ-07: a sprint that contains today is the current one; a task is given to it with a select
    await frame.getByRole('button', { name: 'Sprints', exact: true }).click()
    await expect(frame.getByTestId('empty-state')).toBeVisible()
    await frame.getByRole('button', { name: /Add sprint/ }).first().click()
    await frame.getByRole('textbox', { name: 'Name', exact: true }).fill('PRJ Sprint 1')
    await frame.getByLabel('Starts on', { exact: true }).fill(iso(-1))
    await frame.getByLabel('Ends on', { exact: true }).fill(iso(13))
    await frame.getByRole('button', { name: 'Create', exact: true }).click()
    const sprint = frame.locator('[data-testid=sprint]', { hasText: 'PRJ Sprint 1' })
    await expect(sprint).toContainText('Current')
    await expect(sprint).toContainText('0 of 0 done')
    await frame.getByLabel('Sprint of “PRJ one”').selectOption({ label: 'PRJ Sprint 1' })
    await expect(sprint).toContainText('1 of 1 done')
    await expect(sprint.locator('[data-testid=sprint-task]', { hasText: 'PRJ one' })).toBeVisible()
    await accessible(page, 'projects sprints')

    // PRJ-15: the burndown of the sprint: a project with no dates says so, a sprint draws the ideal and the real line
    await frame.getByRole('button', { name: 'Burndown', exact: true }).click()
    await expect(frame.getByTestId('empty-state')).toContainText('No dates to draw against')
    await frame.getByTestId('burn-scope').selectOption({ label: 'PRJ Sprint 1' })
    await expect(frame.getByTestId('burn-summary')).toContainText(/of 1 tasks still open/)
    await expect(frame.getByTestId('burndown-chart')).toBeVisible()
    await expect(frame.getByTestId('burndown-chart').locator('polyline')).toHaveCount(2)
    await accessible(page, 'projects burndown')
    await frame.getByRole('button', { name: 'Sprints', exact: true }).click()

    // PRJ-08: an existing task without a project is attached
    await nav(page, 'Tasks').click()
    await tasks.getByRole('textbox', { name: 'Quick add a task' }).fill('PRJ loose')
    await tasks.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(tasks.getByText('PRJ loose').first()).toBeVisible()
    await openProject(page, 'PRJ Alpha')
    await frame.getByRole('button', { name: 'Add existing tasks…' }).click()
    await frame.getByRole('searchbox', { name: 'Search tasks' }).fill('PRJ loose')
    const row = frame.locator('.pj-pickrow', { hasText: 'PRJ loose' })
    await expect(row).toBeVisible()
    await row.getByRole('checkbox').check()
    await frame.getByRole('button', { name: 'Add to project' }).click()
    await expect(column(frame, 'To do').locator('[data-testid=task]', { hasText: 'PRJ loose' })).toBeVisible()
    await expect(frame.locator('.pj-head')).toContainText('1 of 4 tasks done')
    await nav(page, 'Tasks').click()
    await expect(tasks.locator('.tproj', { hasText: 'PRJ Alpha' })).toHaveCount(4)

    // PRJ-09: the list shows the project with its progress and next milestone; the filter by status
    await nav(page, 'Projects').click()
    const card = frame.locator('[data-testid=project]', { hasText: 'PRJ Alpha' })
    await expect(card).toContainText('1 of 4 tasks done')
    await expect(card).toContainText('PRJ launch')
    await expect(card).toContainText('Active')
    await accessible(page, 'projects list')
    await frame.getByRole('button', { name: 'On hold', exact: true }).click()
    await expect(frame.getByTestId('empty-state')).toBeVisible()
    await frame.getByRole('button', { name: 'All', exact: true }).click()
    await expect(card).toBeVisible()

    // PRJ-10: details: a bad column list is refused, the status is changed, the columns are renamed
    await card.getByRole('button', { name: 'PRJ Alpha', exact: true }).click()
    await frame.getByRole('button', { name: 'Details', exact: true }).click()
    // the details form is drawn again once when the board has loaded: fill and save again until the refusal shows
    await expect(async () => {
      await frame.getByRole('textbox', { name: /^Board columns/ }).fill('Only one')
      await frame.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(frame.locator('body')).toContainText(/from 2 to 8 columns/i, { timeout: 3000 })
    }).toPass({ timeout: 20000 })
    await frame.getByRole('textbox', { name: /^Board columns/ }).fill('Backlog\nWorking\nShipped')
    await frame.getByLabel('Status', { exact: true }).selectOption('on_hold')
    await frame.getByRole('button', { name: 'Save', exact: true }).click()
    await accessible(page, 'projects details')
    await frame.getByRole('button', { name: 'Board', exact: true }).click()
    for (const c of ['Backlog', 'Working', 'Shipped']) await expect(column(frame, c)).toBeVisible()
    // the unplaced open tasks go to the first column, the done one to the last
    await expect(column(frame, 'Shipped').locator('[data-testid=task]', { hasText: 'PRJ one' })).toBeVisible()
  })
})
