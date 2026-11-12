import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Announcements (docs/manual-tests.md, ANN-01..04): the board with an empty state, notices with a level and Markdown, pinned and
// urgent first, the period filters, the confirmation of reading and the list of who confirmed.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const notice = (frame: FrameLocator, title: string) => frame.locator('[data-testid=notice]', { hasText: title }).first()

async function publish(frame: FrameLocator, title: string, o: { text?: string; level?: string; pinned?: boolean; ack?: boolean; from?: string; until?: string; hidden?: boolean } = {}) {
  await frame.getByRole('button', { name: /^＋ New notice/ }).first().click()
  await frame.getByRole('textbox', { name: 'Title', exact: true }).fill(title)
  if (o.text) await frame.getByRole('textbox', { name: /^Text/ }).fill(o.text)
  if (o.level) await frame.getByLabel('Level', { exact: true }).selectOption(o.level)
  if (o.from) await frame.getByLabel('Valid from', { exact: true }).fill(o.from)
  if (o.until) await frame.getByLabel('Valid until', { exact: true }).fill(o.until)
  if (o.pinned) await frame.getByLabel('Keep at the top').check()
  if (o.ack) await frame.getByLabel('Ask readers to confirm').check()
  await frame.getByRole('button', { name: 'Publish' }).click()
  // a notice outside its period is not in the current ones: the dialog closing says it was saved
  if (o.hidden) await expect(frame.getByRole('dialog')).toHaveCount(0)
  else await expect(notice(frame, title)).toBeVisible()
}

test.describe.serial('Announcements', () => {
  test('board, levels, pinned first, periods, confirmation of reading', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await nav(page, 'Announcements').click()
    const frame = frameOf(page)
    await expect(frame.getByRole('heading', { name: 'Announcements', exact: true })).toBeVisible()

    // ANN-01: nothing yet, the illustrated empty state with the primary action
    await expect(frame.getByTestId('empty-state')).toBeVisible()
    await expect(frame.getByTestId('empty-state').getByRole('button', { name: /New notice/ })).toBeVisible()

    // a notice with a level, Markdown text and a request for confirmation
    await publish(frame, 'ANN fire drill', { text: 'Leave by the **nearest** exit.', level: 'urgent', ack: true })
    await expect(notice(frame, 'ANN fire drill').locator('.an-level')).toHaveText('Urgent')
    await expect(notice(frame, 'ANN fire drill').locator('strong', { hasText: 'nearest' })).toBeVisible()
    await accessible(page, 'announcements board')

    // ANN-02: urgent before information, a pinned one before all
    await publish(frame, 'ANN terrace', { level: 'info' })
    await publish(frame, 'ANN handbook', { level: 'info', pinned: true })
    await expect(frame.locator('[data-testid=notice] h2')).toHaveText(['ANN handbook', 'ANN fire drill', 'ANN terrace'])

    // ANN-03: the periods; a notice that ended is in Past, one that starts later in Upcoming
    await publish(frame, 'ANN old news', { until: '2020-01-01', hidden: true })
    await expect(notice(frame, 'ANN old news')).toHaveCount(0)
    await frame.getByRole('button', { name: 'Past' }).click()
    await expect(notice(frame, 'ANN old news')).toBeVisible()
    await expect(notice(frame, 'ANN fire drill')).toHaveCount(0)
    await frame.getByRole('button', { name: 'Upcoming' }).click()
    await expect(frame.getByTestId('empty-state')).toBeVisible()
    await frame.getByRole('button', { name: 'All' }).click()
    await expect(frame.locator('[data-testid=notice]')).toHaveCount(4)
    await frame.getByRole('button', { name: 'Current' }).click()

    // ANN-04: confirm the reading; the notice says so, counts it and lists who did
    const drill = notice(frame, 'ANN fire drill')
    await expect(drill.getByRole('button', { name: 'Nobody has confirmed yet' })).toBeVisible()
    await drill.getByRole('button', { name: 'I have read it' }).click()
    await expect(drill.getByRole('status')).toContainText('You confirmed')
    await expect(drill.getByRole('button', { name: 'Confirmed by 1' })).toBeVisible()
    await drill.getByRole('button', { name: 'Confirmed by 1' }).click()
    const dlg = frame.getByRole('dialog')
    await expect(dlg).toContainText('Who confirmed')
    await expect(dlg.locator('.an-person strong')).toHaveText(['manager'])
    await dlg.getByRole('button', { name: 'Close' }).click()
    // a period that ends before it starts is refused with a clear message
    await frame.getByRole('button', { name: /^＋ New notice/ }).first().click()
    await frame.getByRole('textbox', { name: 'Title', exact: true }).fill('ANN backwards')
    await frame.getByLabel('Valid from', { exact: true }).fill('2026-05-02')
    await frame.getByLabel('Valid until', { exact: true }).fill('2026-05-01')
    await frame.getByRole('button', { name: 'Publish' }).click()
    await expect(frame.locator('body')).toContainText(/cannot end before it starts/i)
  })
})
