import fs from 'node:fs'
import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Calendar (docs/manual-tests.md, CAL-01..): the month with today highlighted, events at a time, a weekly series seen in the next week,
// the week and day views at the hour of an event, an invitation that the invitee answers, the due dates of Tasks next to the events,
// the .ics file of an event and the removal. Recurrence maths, the grid maths and the .ics format are covered by unit tests
// (Rust for the occurrences, vitest for the rest).

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const chip = (frame: FrameLocator, title: string) => frame.locator('[data-testid=cal-event]', { hasText: title }).first()

/** Opens the form of a new event, fills it and presses «Create event». */
async function create(frame: FrameLocator, title: string, o: { time?: string; repeat?: string; invite?: string } = {}) {
  await frame.getByTestId('new-event').click()
  const dlg = frame.getByRole('dialog')
  await dlg.getByRole('textbox', { name: 'Title', exact: true }).fill(title)
  if (o.time) await dlg.getByLabel('Start time', { exact: true }).fill(o.time)
  if (o.repeat) await dlg.getByLabel('Repeat', { exact: true }).selectOption(o.repeat)
  if (o.invite) {
    await dlg.getByRole('searchbox', { name: 'Invite a person' }).fill(o.invite)
    await dlg.locator('.msk-person-opt').first().click()
    await expect(dlg.locator('.cal-person')).toHaveCount(1)
  }
  await dlg.getByRole('button', { name: 'Create event' }).click()
  await expect(frame.getByRole('dialog', { name: 'New event' })).toHaveCount(0)
}

/** Opens the detail of an event, presses «Delete» and confirms. */
async function remove(frame: FrameLocator, title: string) {
  await chip(frame, title).click()
  await frame.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await frame.getByRole('dialog').last().getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(chip(frame, title)).toHaveCount(0)
}

test.describe.serial('Calendar', () => {
  test('month, events, week and day, invitations, tasks, .ics, removal', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)

    // the task that the calendar will show: due today, made through the Tasks plugin
    await nav(page, 'Tasks').click()
    const tasks = frameOf(page)
    await expect(tasks.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible()
    await tasks.getByRole('textbox', { name: 'Quick add a task' }).fill('CAL pay invoice today')
    await tasks.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(tasks.locator('.msk-item.tcard, .msk-kcard', { hasText: 'CAL pay invoice' }).first()).toBeVisible()

    await nav(page, 'Calendar').click()
    const frame = frameOf(page)
    await expect(frame.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible()

    // CAL-01: the month, six weeks, today highlighted
    await expect(frame.getByTestId('month')).toBeVisible()
    await expect(frame.locator('.cal-cell')).toHaveCount(42)
    await expect(frame.locator('.cal-cell.today')).toHaveCount(1)
    await expect(frame.locator('.cal-cell.today .cal-num')).toHaveAttribute('aria-current', 'date')

    // CAL-02: an event today at a time is a chip with its time and title
    await create(frame, 'CAL standup', { time: '10:15' })
    await expect(chip(frame, 'CAL standup')).toHaveText('10:15 CAL standup')
    await accessible(page, 'calendar month')

    // CAL-03: a weekly series shows in the week of today and again in the next one
    await create(frame, 'CAL weekly', { time: '11:00', repeat: 'weekly' })
    await frame.getByRole('button', { name: 'Week', exact: true }).click()
    await expect(frame.getByTestId('week-view')).toBeVisible()
    const title = await frame.getByTestId('period').innerText()
    // CAL-04: in the week the event sits at its hour (48 px an hour), and the line of the current time is in today's column
    await expect(chip(frame, 'CAL weekly')).toHaveCSS('top', '528px')
    await expect(chip(frame, 'CAL standup')).toHaveCSS('top', '492px')
    await expect(frame.getByTestId('now-line')).toHaveCount(1)
    await accessible(page, 'calendar week')
    await frame.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(frame.getByTestId('period')).not.toHaveText(title)
    await expect(chip(frame, 'CAL weekly')).toBeVisible()
    await expect(chip(frame, 'CAL standup')).toHaveCount(0)

    // CAL-13: one occurrence of the series changes on its own and comes back; another one is deleted alone
    await chip(frame, 'CAL weekly').click()
    await frame.getByRole('dialog').getByRole('button', { name: 'Edit this occurrence' }).click()
    await frame.getByRole('dialog').getByRole('textbox', { name: 'Title', exact: true }).fill('CAL moved')
    await frame.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
    await expect(chip(frame, 'CAL moved')).toBeVisible()
    await expect(chip(frame, 'CAL weekly')).toHaveCount(0)
    await chip(frame, 'CAL moved').click()
    await expect(frame.getByTestId('detail-exception')).toBeVisible()
    await frame.getByRole('dialog').getByRole('button', { name: 'Restore this occurrence' }).click()
    await expect(chip(frame, 'CAL weekly')).toBeVisible()
    await chip(frame, 'CAL weekly').click()
    await frame.getByRole('dialog').getByRole('button', { name: 'Delete this occurrence' }).click()
    await frame.getByRole('dialog').last().getByRole('button', { name: 'Delete this occurrence' }).click()
    await expect(chip(frame, 'CAL weekly')).toHaveCount(0)
    await frame.getByRole('button', { name: 'Today', exact: true }).click()
    await expect(frame.getByTestId('period')).toHaveText(title)
    await expect(chip(frame, 'CAL weekly')).toBeVisible()

    // the day view: the same hours
    await frame.getByRole('button', { name: 'Day', exact: true }).click()
    await expect(frame.getByTestId('day-view')).toBeVisible()
    await expect(chip(frame, 'CAL weekly')).toHaveCSS('top', '528px')
    await expect(chip(frame, 'CAL standup')).toHaveCSS('top', '492px')

    // CAL-08: the due date of the task is next to the events (the day view lists all of them); the switch hides it
    const due = frame.getByTestId('cal-task').filter({ hasText: 'CAL pay invoice' })
    await expect(due.first()).toBeVisible()
    await expect(due.first()).toHaveAttribute('title', /Task due: CAL pay invoice/)
    const sw = frame.getByRole('switch', { name: 'Show task due dates' })
    await expect(sw).toBeChecked()
    await sw.uncheck()
    await expect(due).toHaveCount(0)
    await sw.check()
    await expect(due.first()).toBeVisible()

    // CAL-05: an event with the manager himself invited (found in the directory); the dialog that offers the sharing follows
    await frame.getByRole('button', { name: 'Month', exact: true }).click()
    await frame.getByTestId('new-event').click()
    const dlg = frame.getByRole('dialog')
    await dlg.getByRole('textbox', { name: 'Title', exact: true }).fill('CAL invite')
    await dlg.getByLabel('Start time', { exact: true }).fill('15:00')
    await accessible(page, 'calendar event dialog')
    await dlg.getByRole('searchbox', { name: 'Invite a person' }).fill('manager')
    await dlg.locator('.msk-person-opt').first().click()
    await expect(dlg.locator('.cal-person')).toHaveCount(1)
    await dlg.getByRole('button', { name: 'Create event' }).click()
    await expect(frame.getByRole('dialog')).toContainText('Event created')
    await expect(frame.getByRole('dialog')).toContainText('Share the event with the invitees')
    await frame.getByRole('button', { name: 'Later' }).click()

    // CAL-06: the invitation is counted in the header, listed, and answered with «Yes» from the list
    await expect(frame.getByTestId('inv-badge')).toHaveText('1')
    await frame.getByTestId('invitations').click()
    await expect(frame.getByTestId('invitation-list')).toContainText('CAL invite')
    await frame.getByRole('button', { name: 'Yes: CAL invite' }).click()
    await expect(frame.getByTestId('inv-badge')).toHaveCount(0)
    await expect(frame.getByRole('dialog')).toContainText('No invitations waiting for an answer.')
    await frame.getByRole('dialog').getByRole('button', { name: 'Close' }).click()

    // the detail shows the answer in words and in the count, and the answer can change
    await chip(frame, 'CAL invite').click()
    const detail = frame.getByRole('dialog')
    await expect(detail.getByTestId('counts')).toHaveText('1 yes · 0 maybe · 0 no')
    await expect(detail.getByTestId('my-answer')).toContainText('Yes')
    await expect(detail.locator('.cal-person')).toHaveCount(1)
    await expect(detail.locator('.cal-person')).toContainText('coming')
    await detail.getByRole('button', { name: 'Maybe', exact: true }).click()
    await expect(detail.getByTestId('counts')).toHaveText('0 yes · 1 maybe · 0 no')

    // CAL-07: the .ics file of the event has its summary
    const [download] = await Promise.all([page.waitForEvent('download'), detail.getByRole('button', { name: /Add to my calendar/ }).click()])
    expect(download.suggestedFilename()).toMatch(/\.ics$/)
    const ics = fs.readFileSync((await download.path())!, 'utf8')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('SUMMARY:CAL invite')
    expect(ics).toContain('DTSTART:')
    expect(ics).toContain('\r\n')
    // CAL-14: the invited are in the file with their answer (the answer is now «Maybe»)
    expect(ics).toMatch(/ATTENDEE;CN="[^"]+";ROLE=REQ-PARTICIPANT;PARTSTAT=TENTATIVE:urn:uuid:/)
    await detail.getByRole('button', { name: 'Close' }).click()

    // CAL-15: an event with a time zone is shown at the hour of the browser and written with its TZID in the file
    await frame.getByTestId('new-event').click()
    const zdlg = frame.getByRole('dialog')
    await zdlg.getByRole('textbox', { name: 'Title', exact: true }).fill('CAL zone')
    await zdlg.getByLabel('Start time', { exact: true }).fill('08:00')
    await zdlg.getByTestId('zone').selectOption('Asia/Tokyo')
    await expect(zdlg).toContainText('Times are in Asia/Tokyo')
    await zdlg.getByRole('button', { name: 'Create event' }).click()
    // 08:00 in Tokyo (UTC+9, no daylight saving) at the hour of the browser
    const shown = await page.evaluate(() => {
      const n = new Date()
      const ms = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), 8, 0) - 9 * 3600_000
      return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms))
    })
    await expect(chip(frame, 'CAL zone')).toHaveText(`${shown} CAL zone`)
    await chip(frame, 'CAL zone').click()
    const zdetail = frame.getByRole('dialog')
    await expect(zdetail.getByTestId('detail-zone')).toContainText('Asia/Tokyo')
    const [zdl] = await Promise.all([page.waitForEvent('download'), zdetail.getByRole('button', { name: /Add to my calendar/ }).click()])
    expect(fs.readFileSync((await zdl.path())!, 'utf8')).toContain('DTSTART;TZID=Asia/Tokyo:')
    await zdetail.getByRole('button', { name: 'Close' }).click()
    await remove(frame, 'CAL zone')

    // CAL-09: delete the events (the series says that it deletes them all)
    await remove(frame, 'CAL invite')
    await remove(frame, 'CAL standup')
    await chip(frame, 'CAL weekly').click()
    await frame.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(frame.getByRole('dialog').last()).toContainText('whole series')
    await frame.getByRole('dialog').last().getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(chip(frame, 'CAL weekly')).toHaveCount(0)
  })
})
