import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Polls (docs/manual-tests.md, POL-01..07): a poll with options, a vote and its results as bars, changing the vote, multiple choice,
// live results between two sessions, closing, the refusal of wrong options. Two browser sessions of the same person stand for two
// people. Who sees the counts (after the vote, after the close) is covered by the unit tests of the plugin.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const bar = (frame: FrameLocator, name: string) => frame.getByRole('progressbar', { name })

async function create(frame: FrameLocator, question: string, options: string[], o: { multiple?: boolean } = {}) {
  await frame.getByRole('button', { name: /^＋ New poll/ }).first().click()
  await frame.getByRole('textbox', { name: 'Question', exact: true }).fill(question)
  for (let i = 3; i <= options.length; i++) await frame.getByRole('button', { name: /Add an option/ }).click()
  for (const [i, text] of options.entries()) await frame.getByRole('textbox', { name: `Option ${i + 1}`, exact: true }).fill(text)
  if (o.multiple) await frame.getByLabel('Allow more than one choice').check()
  await frame.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(frame.getByRole('dialog')).toHaveCount(0)
}

const openPoll = (frame: FrameLocator, question: string) => frame.getByRole('button', { name: question, exact: true }).click()

test.describe.serial('Polls', () => {
  test('poll, vote, change, multiple choice, live bars, close, wrong options', async ({ browser }) => {
    const a = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    const b = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    await login(a, 'Alfa', 'manager', PASSWORD)
    await login(b, 'Alfa', 'manager', PASSWORD)
    await nav(a, 'Polls').click()
    const fa = frameOf(a)
    await expect(fa.getByRole('heading', { name: 'Polls', exact: true })).toBeVisible()

    // POL-01: nothing yet, the illustrated empty state with the primary action
    await expect(fa.getByTestId('empty-state')).toBeVisible()
    await expect(fa.getByTestId('empty-state').getByRole('button', { name: /New poll/ })).toBeVisible()

    // POL-02: a poll with three options; it opens with the options and no votes
    await create(fa, 'POL lunch', ['Pizza', 'Sushi', 'Pasta'])
    await expect(fa.locator('[data-testid=poll]', { hasText: 'POL lunch' })).toContainText('Open')
    await accessible(a, 'polls list')
    await openPoll(fa, 'POL lunch')
    await expect(fa.getByRole('heading', { name: 'POL lunch', exact: true })).toBeVisible()
    await expect(fa.getByRole('radio')).toHaveCount(3)

    // POL-03: vote; the results show 100% for the choice (the owner sees the counts at once)
    await fa.getByRole('radio', { name: 'Pizza' }).check()
    await fa.getByRole('button', { name: 'Vote', exact: true }).click()
    await expect(bar(fa, 'Pizza: 100%')).toHaveAttribute('aria-valuenow', '100')
    await expect(bar(fa, 'Sushi: 0%')).toBeVisible()
    await expect(fa.getByTestId('total')).toHaveText('1 person voted')
    await expect(fa.locator('.po-voter')).toHaveText([/manager$/])
    await expect(fa.getByRole('button', { name: 'Change my vote' })).toBeVisible()
    await accessible(a, 'poll with results')

    // POL-04: the second session has the poll open and sees the bars move without reloading when the vote changes
    await nav(b, 'Polls').click()
    const fb = frameOf(b)
    await openPoll(fb, 'POL lunch')
    await expect(bar(fb, 'Pizza: 100%')).toBeVisible()
    await fa.getByRole('radio', { name: 'Sushi' }).check()
    await fa.getByRole('button', { name: 'Change my vote' }).click()
    await expect(bar(fa, 'Sushi: 100%')).toBeVisible()
    await expect(bar(fa, 'Pizza: 0%')).toBeVisible()
    await expect(bar(fb, 'Sushi: 100%')).toBeVisible()
    await expect(bar(fb, 'Pizza: 0%')).toBeVisible()

    // POL-05: a poll with more than one choice takes checkboxes and counts every box
    await fa.getByRole('button', { name: '← Polls' }).click()
    await create(fa, 'POL days', ['Monday', 'Tuesday', 'Friday'], { multiple: true })
    await openPoll(fa, 'POL days')
    await expect(fa.getByRole('checkbox')).toHaveCount(3)
    await fa.getByRole('checkbox', { name: 'Monday' }).check()
    await fa.getByRole('checkbox', { name: 'Friday' }).check()
    await fa.getByRole('button', { name: 'Vote', exact: true }).click()
    await expect(bar(fa, 'Monday: 100%')).toBeVisible()
    await expect(bar(fa, 'Friday: 100%')).toBeVisible()
    await expect(bar(fa, 'Tuesday: 0%')).toBeVisible()
    await expect(fa.getByTestId('total')).toHaveText('1 person voted')

    // POL-06: close a poll: voting is disabled with a message, it moves to Closed; reopen it
    await fa.getByRole('button', { name: '← Polls' }).click()
    await openPoll(fa, 'POL lunch')
    await fa.getByRole('button', { name: 'Close the poll' }).click()
    await expect(fa.getByText('This poll is closed: voting is disabled.')).toBeVisible()
    await expect(fa.getByRole('radio', { name: 'Pasta' })).toBeDisabled()
    await expect(fa.getByRole('button', { name: 'Change my vote' })).toHaveCount(0)
    await fa.getByRole('button', { name: '← Polls' }).click()
    await expect(fa.locator('[data-testid=poll]', { hasText: 'POL lunch' })).toHaveCount(0)
    await fa.getByRole('button', { name: 'Closed', exact: true }).click()
    await expect(fa.locator('[data-testid=poll]', { hasText: 'POL lunch' })).toContainText('Closed')
    await openPoll(fa, 'POL lunch')
    await fa.getByRole('button', { name: 'Reopen' }).click()
    await expect(fa.getByRole('radio', { name: 'Pasta' })).toBeEnabled()
    await fa.getByRole('button', { name: '← Polls' }).click()

    // POL-07: an empty option, or two equal ones, are refused with a message and nothing is saved
    await fa.getByRole('button', { name: 'Open', exact: true }).click()
    await fa.getByRole('button', { name: /^＋ New poll/ }).first().click()
    await fa.getByRole('textbox', { name: 'Question', exact: true }).fill('POL broken')
    await fa.getByRole('textbox', { name: 'Option 1', exact: true }).fill('Only one')
    await fa.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(fa.locator('body')).toContainText('An option is empty')
    await fa.getByRole('textbox', { name: 'Option 2', exact: true }).fill('only one')
    await fa.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(fa.locator('body')).toContainText('Two options are the same')
    await expect(fa.getByRole('button', { name: 'Remove option 1' })).toBeDisabled()
    await fa.getByRole('button', { name: 'Cancel' }).click()
    await expect(fa.locator('[data-testid=poll]', { hasText: 'POL broken' })).toHaveCount(0)
  })
})
