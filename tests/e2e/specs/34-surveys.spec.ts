import { readFileSync } from 'node:fs'
import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Surveys (docs/manual-tests.md, SUR-01..08): the list with an empty state, the builder (a quiz with a choice, a multi and a text
// question), answering with the score, a second answer refused, the results with bars, the CSV and the refusal of a question
// without text.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const survey = (frame: FrameLocator, title: string) => frame.locator('[data-testid=survey]', { hasText: title }).first()
const block = (frame: FrameLocator, n: number) => frame.getByTestId('question-block').nth(n - 1)

test.describe.serial('Surveys', () => {
  test('quiz: build, answer, a second answer refused, results, CSV', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await nav(page, 'Surveys').click()
    const frame = frameOf(page)
    await expect(frame.getByRole('heading', { name: 'Surveys', exact: true })).toBeVisible()

    // SUR-01: nothing yet, the illustrated empty state with the primary action
    await expect(frame.getByTestId('empty-state')).toBeVisible()
    await expect(frame.getByTestId('empty-state').getByRole('button', { name: /New survey/ })).toBeVisible()

    // SUR-02: a survey without a text in a question is refused with a clear message, nothing is saved
    await frame.getByRole('button', { name: /^＋ New survey/ }).first().click()
    await frame.getByRole('textbox', { name: 'Title', exact: true }).fill('SUR broken')
    await frame.getByRole('button', { name: '＋ Add question' }).click()
    await frame.getByRole('button', { name: 'Create' }).click()
    await expect(frame.locator('body')).toContainText(/Question 1 needs a text/i)
    await frame.getByRole('button', { name: 'Cancel' }).click()
    await expect(frame.getByRole('dialog')).toHaveCount(0)
    await expect(survey(frame, 'SUR broken')).toHaveCount(0)

    // SUR-03: build a quiz with a choice, a multi and a text question
    await frame.getByRole('button', { name: /^＋ New survey/ }).first().click()
    await frame.getByRole('textbox', { name: 'Title', exact: true }).fill('SUR onboarding')
    await frame.getByLabel('Quiz: score the answers').check()
    await frame.getByLabel('Pass mark (%)', { exact: true }).first().fill('50')

    await frame.getByRole('button', { name: '＋ Add question' }).click()
    await frame.getByRole('textbox', { name: 'Question 1: text' }).fill('Where is the policy')
    await frame.getByRole('textbox', { name: 'Question 1, option 1' }).fill('Handbook')
    await frame.getByRole('textbox', { name: 'Question 1, option 2' }).fill('Nowhere')
    await frame.getByLabel('Option 1 of question 1 is correct').check()
    await frame.getByLabel('Question 1: Points').fill('2')

    await frame.getByRole('button', { name: '＋ Add question' }).click()
    await frame.getByRole('textbox', { name: 'Question 2: text' }).fill('Which are safety rules')
    await frame.getByLabel('Question 2: type').selectOption('multi')
    await frame.getByRole('textbox', { name: 'Question 2, option 1' }).fill('Badge')
    await frame.getByRole('textbox', { name: 'Question 2, option 2' }).fill('Training')
    await block(frame, 2).getByRole('button', { name: 'Add option' }).click()
    await frame.getByRole('textbox', { name: 'Question 2, option 3' }).fill('Skip it')
    await frame.getByLabel('Option 1 of question 2 is correct').check()
    await frame.getByLabel('Option 2 of question 2 is correct').check()
    await frame.getByLabel('Question 2: Points').fill('3')

    await frame.getByRole('button', { name: '＋ Add question' }).click()
    await frame.getByRole('textbox', { name: 'Question 3: text' }).fill('Why')
    await frame.getByLabel('Question 3: type').selectOption('text')

    // the questions can be moved with the keyboard-friendly buttons: down and up again keeps the order
    await frame.getByRole('button', { name: 'Move question 1 down' }).click()
    await expect(frame.getByRole('textbox', { name: 'Question 2: text' })).toHaveValue('Where is the policy')
    await frame.getByRole('button', { name: 'Move question 2 up' }).click()
    await expect(frame.getByRole('textbox', { name: 'Question 1: text' })).toHaveValue('Where is the policy')
    await accessible(page, 'surveys builder')
    await frame.getByRole('button', { name: 'Create' }).click()

    const card = survey(frame, 'SUR onboarding')
    await expect(card).toBeVisible()
    await expect(card).toContainText('3 questions')
    await expect(card).toContainText('0 responses')
    await expect(card.locator('.sv-state')).toHaveText('Open')
    await accessible(page, 'surveys list')

    // SUR-04: the same person has the survey open in another tab and answers it there first: the score is shown
    await card.getByRole('button', { name: 'Answer' }).click()
    await expect(frame.getByRole('heading', { name: 'SUR onboarding', exact: true })).toBeVisible()
    await frame.getByRole('radio', { name: 'Handbook' }).check()
    await frame.getByRole('checkbox', { name: 'Badge' }).check()
    await frame.getByRole('checkbox', { name: 'Training' }).check()
    await accessible(page, 'surveys answering')
    // the plugin UI never receives the answer key of a quiz while answering (it lives apart, behind the commands of the logic)
    await expect(frame.locator('.sv-take')).toHaveAttribute('data-has-key', 'false')

    const other = await page.context().newPage()
    await other.goto(page.url())
    await nav(other, 'Surveys').click()
    const frame2 = frameOf(other)
    await survey(frame2, 'SUR onboarding').getByRole('button', { name: 'Answer' }).click()
    await frame2.getByRole('radio', { name: 'Nowhere' }).check()
    await frame2.getByRole('checkbox', { name: 'Badge' }).check()
    await frame2.getByRole('checkbox', { name: 'Training' }).check()
    await frame2.getByRole('textbox', { name: /Why/ }).fill('Clear enough')
    await frame2.getByRole('button', { name: 'Submit' }).click()
    await expect(frame2.getByTestId('score')).toContainText('3 of 5 points (60%)')
    await expect(frame2.getByRole('status').filter({ hasText: 'Passed' })).toBeVisible()
    // right and wrong are shown only now, with the right answer of the one that was wrong
    await expect(frame2.locator('.sv-review li.wrong')).toContainText('Correct answer: Handbook')
    await expect(frame2.locator('.sv-review li.right')).toContainText('Which are safety rules')
    await accessible(other, 'surveys score')
    await other.close()

    // SUR-05: a second submit is refused with a clear message
    await frame.getByRole('button', { name: 'Submit' }).click()
    await expect(frame.locator('body')).toContainText(/already answered this survey/i)

    // the list says it was answered and counts the response
    await page.reload()
    await nav(page, 'Surveys').click()
    const again = survey(frame, 'SUR onboarding')
    await expect(again).toContainText('Answered')
    await expect(again).toContainText('1 response')
    await expect(again.getByRole('button', { name: 'Answer' })).toHaveCount(0)

    // SUR-06: the results: a bar per option with counts and percentages, the text answers, the respondents
    await again.getByRole('button', { name: 'Results', exact: true }).click()
    await expect(frame.getByTestId('summary')).toContainText('Responses: 1')
    const first = frame.getByTestId('result').nth(0)
    await expect(first.getByTestId('bar').filter({ hasText: 'Nowhere' })).toContainText('1 (100%)')
    await expect(first.getByTestId('bar').filter({ hasText: 'Handbook' })).toContainText('0 (0%)')
    await expect(first.getByTestId('bar').filter({ hasText: 'Handbook' })).toContainText('(correct)')
    await expect(frame.getByTestId('result').nth(1).getByTestId('bar').filter({ hasText: 'Badge' })).toContainText('1 (100%)')
    await expect(frame.getByTestId('result').nth(2).locator('li')).toHaveText(['Clear enough'])
    await expect(frame.getByTestId('respondent')).toHaveCount(1)
    await expect(frame.getByTestId('respondent')).toContainText('manager')
    await expect(frame.getByTestId('respondent')).toContainText('3/5 (60%)')
    await accessible(page, 'surveys results')

    // SUR-07: the CSV has the header and one row
    const download = page.waitForEvent('download')
    await frame.getByRole('button', { name: 'Export CSV' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('sur-onboarding.csv')
    const csv = readFileSync((await file.path())!, 'utf8').replace(/^﻿/, '')
    const lines = csv.split(/\r?\n/).filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('Respondent,Submitted at,Score,Max score,Percent,Where is the policy,Which are safety rules,Why')
    expect(lines[1]).toMatch(/^manager,.*,3,5,60,Nowhere,Badge; Training,Clear enough$/)

    // SUR-11: the author opening the builder gets the answer key back (from the separate command) in the editor
    await frame.getByRole('button', { name: '← Surveys' }).click()
    await survey(frame, 'SUR onboarding').getByRole('button', { name: 'Edit' }).click()
    await expect(frame.getByLabel('Option 1 of question 1 is correct')).toBeChecked()
    await expect(frame.getByLabel('Option 2 of question 1 is correct')).not.toBeChecked()
    await expect(frame.getByLabel('Option 1 of question 2 is correct')).toBeChecked()
    await expect(frame.getByLabel('Option 3 of question 2 is correct')).not.toBeChecked()
    await frame.getByRole('button', { name: 'Cancel' }).click()
  })

  test('anonymous survey with a branching question: nobody is named, the hidden question is not asked', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await nav(page, 'Surveys').click()
    const frame = frameOf(page)
    await expect(frame.getByRole('heading', { name: 'Surveys', exact: true })).toBeVisible()

    // SUR-13: question 2 is shown only when question 1 is answered «Yes»; the survey is anonymous
    await frame.getByRole('button', { name: /^＋ New survey/ }).first().click()
    await frame.getByRole('textbox', { name: 'Title', exact: true }).fill('SUR branching')
    await frame.getByTestId('anonymous').check()
    await frame.getByRole('button', { name: '＋ Add question' }).click()
    await frame.getByRole('textbox', { name: 'Question 1: text' }).fill('Do you drive')
    await frame.getByRole('textbox', { name: 'Question 1, option 1' }).fill('Yes')
    await frame.getByRole('textbox', { name: 'Question 1, option 2' }).fill('No')
    await frame.getByRole('button', { name: '＋ Add question' }).click()
    await frame.getByRole('textbox', { name: 'Question 2: text' }).fill('Which car')
    await frame.getByLabel('Question 2: type').selectOption('text')
    await frame.getByLabel('Question 2: when to show it').selectOption({ label: 'Only if question 1 is answered' })
    // a condition with no answer ticked is refused
    await frame.getByRole('button', { name: 'Create' }).click()
    await expect(frame.locator('body')).toContainText(/Question 2: choose an earlier question/)
    await frame.getByLabel('Question 2: show it for these answers: Yes').check()
    await accessible(page, 'surveys builder branching')
    await frame.getByRole('button', { name: 'Create' }).click()
    const card = survey(frame, 'SUR branching')
    await expect(card).toBeVisible()

    // answering «No»: the second question is hidden, «Yes»: it appears
    await card.getByRole('button', { name: 'Answer' }).click()
    await expect(frame.getByTestId('question')).toHaveCount(2)
    await expect(frame.getByTestId('question').nth(1)).toBeHidden()
    await frame.getByRole('radio', { name: 'Yes' }).check()
    await expect(frame.getByTestId('question').nth(1)).toBeVisible()
    await frame.getByRole('textbox', { name: /Which car/ }).fill('Fiat Panda')
    await frame.getByRole('radio', { name: 'No' }).check()
    await expect(frame.getByTestId('question').nth(1)).toBeHidden()
    await frame.getByRole('radio', { name: 'Yes' }).check()
    // what was typed before the question was hidden is forgotten
    await expect(frame.getByRole('textbox', { name: /Which car/ })).toHaveValue('')
    await frame.getByRole('textbox', { name: /Which car/ }).fill('Fiat Panda')
    await frame.getByRole('button', { name: 'Submit' }).click()
    await expect(frame.getByRole('heading', { name: /Thank you/ })).toBeVisible()

    // SUR-14: the results of an anonymous survey show the answers and never the person
    await frame.getByRole('button', { name: '← Surveys' }).click()
    await survey(frame, 'SUR branching').getByRole('button', { name: 'Results', exact: true }).click()
    await expect(frame.getByTestId('anonymous-note')).toBeVisible()
    await expect(frame.getByTestId('result').nth(1).locator('li')).toHaveText(['Fiat Panda'])
    await expect(frame.getByTestId('respondent')).toHaveCount(1)
    await expect(frame.getByTestId('respondent')).toHaveText('Response 1')
    await expect(frame.getByTestId('respondent')).not.toContainText('manager')
    const download = page.waitForEvent('download')
    await frame.getByRole('button', { name: 'Export CSV' }).click()
    const csv = readFileSync(((await (await download).path()))!, 'utf8').replace(/^﻿/, '')
    expect(csv.split(/\r?\n/).filter(Boolean)).toEqual(['Do you drive,Which car', 'Yes,Fiat Panda'])
    expect(csv).not.toContain('manager')

    // the anonymous box cannot be turned off afterwards
    await frame.getByRole('button', { name: '← Surveys' }).click()
    await survey(frame, 'SUR branching').getByRole('button', { name: 'Edit' }).click()
    await expect(frame.getByTestId('anonymous')).toBeChecked()
    await expect(frame.getByTestId('anonymous')).toBeDisabled()
    await frame.getByRole('button', { name: 'Cancel' }).click()
  })
})
