import { readFileSync } from 'node:fs'
import { expect, test, type Browser, type FrameLocator, type Page } from '@playwright/test'
import { APP_ORIGIN, BASE, PASSWORD, accessible, login, nav } from './support'

// Forms (docs/manual-tests.md, FRM-01..): the list with an empty state, the builder (a text, a choice and an email field), filling it
// in as a signed-in person, the answers with the counts per option, and the PUBLIC FLOW: the tenant policy «Public commands», a public
// link opened in a fresh browser context with no session, the client-side checks, a visitor's answer, a second answer from the same
// browser refused, the table with the visitor's answer, the CSV, a closed form and the policy switched off.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const form = (frame: FrameLocator, title: string) => frame.locator('[data-testid=form]', { hasText: title }).first()
const TITLE = 'FRM registration'
const PLUGIN = 'com.mosaikit.forms'

/** A call to the API of the tenant with the session of the page (the CSRF token comes from the session). */
async function api(page: Page, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  const url = (p: string) => `${APP_ORIGIN}${BASE}/${p}`
  const me = (await (await page.request.get(url('api/session'))).json()) as { csrf: string }
  const r = await page.request.fetch(url(path), { method, headers: { 'x-csrf-token': me.csrf }, data })
  expect(r.ok(), await r.text()).toBe(true)
  const text = await r.text()
  return (text ? JSON.parse(text) : {}) as Record<string, any>
}

/** The policy of the tenant is the Tenant Manager's. */
async function publicCommands(page: Page, on: boolean) {
  const s = await api(page, 'GET', 'api/t/alfa/manage/settings')
  s.public_commands_enabled = on
  await api(page, 'PUT', 'api/t/alfa/manage/settings', s)
}

/** The public page of a link, anonymous: a context of its own. The page is in the frame of the viewer of the link. */
async function openPublic(browser: Browser, link: string, ctx?: import('@playwright/test').BrowserContext) {
  const context = ctx ?? (await browser.newContext())
  const pub = await context.newPage()
  await pub.goto(link)
  return { context, pub, host: pub.frameLocator('iframe#v') }
}

test.describe.serial('Forms', () => {
  let link = ''

  test('build a form, fill it in, read the answers', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await nav(page, 'Forms').click()
    const frame = frameOf(page)
    await expect(frame.getByRole('heading', { name: 'Forms', exact: true })).toBeVisible()

    // FRM-01: nothing yet, the illustrated empty state with the primary action
    await expect(frame.getByTestId('empty-state')).toBeVisible()
    await expect(frame.getByTestId('empty-state').getByRole('button', { name: /New form/ })).toBeVisible()

    // FRM-02: a field without a label is refused with a clear message, nothing is saved
    await frame.getByRole('button', { name: /^＋ New form/ }).first().click()
    await frame.getByRole('textbox', { name: 'Title', exact: true }).fill('FRM broken')
    await frame.getByRole('button', { name: '＋ Add field' }).click()
    await frame.getByRole('button', { name: 'Create' }).click()
    await expect(frame.locator('body')).toContainText(/Field 1 needs a label/i)
    await frame.getByRole('button', { name: 'Cancel' }).click()
    await expect(frame.getByRole('dialog')).toHaveCount(0)
    await expect(form(frame, 'FRM broken')).toHaveCount(0)

    // FRM-03: build a form with a text, a choice and an email field, open, with a thank-you message
    await frame.getByRole('button', { name: /^＋ New form/ }).first().click()
    await frame.getByRole('textbox', { name: 'Title', exact: true }).fill(TITLE)
    await frame.getByRole('textbox', { name: 'Introduction', exact: true }).fill('Tell us who is coming.')
    await frame.getByLabel('Open (takes answers)').check()
    await frame.getByRole('textbox', { name: 'Thank-you message', exact: true }).fill('See you at the festival!')
    await frame.getByRole('button', { name: '＋ Add field' }).click()
    await frame.getByRole('textbox', { name: 'Field 1: label' }).fill('Name')
    await frame.getByLabel('Field 1: Required').check()
    await frame.getByRole('button', { name: '＋ Add field' }).click()
    await frame.getByRole('textbox', { name: 'Field 2: label' }).fill('Menu')
    await frame.getByLabel('Field 2: type').selectOption('choice')
    await frame.getByRole('textbox', { name: 'Field 2, option 1' }).fill('Vegetarian')
    await frame.getByRole('textbox', { name: 'Field 2, option 2' }).fill('Fish')
    await frame.getByRole('button', { name: '＋ Add field' }).click()
    await frame.getByRole('textbox', { name: 'Field 3: label' }).fill('Email')
    await frame.getByLabel('Field 3: type').selectOption('email')
    await frame.getByLabel('Field 3: Required').check()
    // the builder is accessible
    await accessible(page, 'forms builder')
    await frame.getByRole('button', { name: 'Create' }).click()
    await expect(form(frame, TITLE)).toBeVisible()
    await expect(form(frame, TITLE).locator('.fm-state')).toHaveText('Open')
    await expect(form(frame, TITLE)).toContainText('3 fields')
    await accessible(page, 'forms list')

    // FRM-04: fill it in as the signed-in person; the form checks the required fields and the email before sending
    await form(frame, TITLE).getByRole('button', { name: 'Fill in' }).click()
    await frame.getByRole('button', { name: 'Send' }).click()
    await expect(frame.getByTestId('errors')).toContainText('Name is required')
    await frame.getByLabel('Name', { exact: true }).fill('Anna Rossi')
    await frame.getByLabel('Email', { exact: true }).fill('not-an-email')
    await frame.getByRole('radio', { name: 'Vegetarian' }).check()
    await frame.getByRole('button', { name: 'Send' }).click()
    await expect(frame.getByTestId('errors')).toContainText('Email: enter an email address')
    await frame.getByLabel('Email', { exact: true }).fill('anna@example.org')
    await frame.getByRole('button', { name: 'Send' }).click()
    await expect(frame.getByTestId('thanks')).toContainText('See you at the festival!')

    // FRM-05: the answers: the counts per option and the table
    await frame.getByRole('button', { name: 'Back to the forms' }).click()
    await expect(form(frame, TITLE)).toContainText('1 answer')
    await expect(form(frame, TITLE)).toContainText('Answered')
    await form(frame, TITLE).getByRole('button', { name: 'Answers' }).click()
    await expect(frame.getByTestId('summary')).toHaveText('Answers: 1')
    await expect(frame.getByTestId('result').first()).toContainText('Menu')
    await expect(frame.getByTestId('bar').filter({ hasText: 'Vegetarian' })).toContainText('1 (100%)')
    await expect(frame.getByTestId('bar').filter({ hasText: 'Fish' })).toContainText('0 (0%)')
    await expect(frame.getByTestId('answer')).toHaveCount(1)
    await expect(frame.getByTestId('answer')).toContainText('anna@example.org')
    await accessible(page, 'forms answers')
  })

  test('the public link: a visitor answers once, closed form, policy off', async ({ page, browser }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await publicCommands(page, true)
    // the id of the form, from the list of the plugin
    const list = await api(page, 'GET', `api/t/alfa/p/${PLUGIN}/r/forms`)
    const id = list.rows.find((r: { values: { title: string } }) => r.values.title === TITLE).id as string
    // FRM-06: the public link of the form (only with manage level; the page opens in a fresh context)
    link = (await api(page, 'POST', `api/t/alfa/resources/${id}/links`, {})).url as string
    expect(link).toBeTruthy()

    const { context, pub, host } = await openPublic(browser, link)
    // no session at all
    expect((await pub.request.get(`${APP_ORIGIN}${BASE}/api/session`)).status()).toBeGreaterThanOrEqual(400)
    await expect(host.getByRole('heading', { name: TITLE })).toBeVisible()
    await expect(host.getByText('Tell us who is coming.')).toBeVisible()
    // the answers of others and their number are not on the page
    await expect(host.locator('body')).not.toContainText(/1 answer|Answers:/)
    await accessible(pub, 'public form (light)')
    await pub.emulateMedia({ colorScheme: 'dark' })
    await accessible(pub, 'public form (dark)')
    await pub.emulateMedia({ colorScheme: 'light' })
    // the honeypot is there, hidden from people and from the keyboard
    await expect(host.locator('.fm-trap')).toHaveAttribute('aria-hidden', 'true')
    await expect(host.locator('.fm-trap input')).toHaveAttribute('tabindex', '-1')

    // FRM-07: a required field left empty and a wrong email are refused before anything is sent
    await host.getByRole('button', { name: 'Send' }).click()
    await expect(host.getByRole('alert').filter({ hasText: 'Please fix the following' })).toContainText('Name is required')
    await expect(host.getByRole('alert').filter({ hasText: 'Please fix the following' })).toContainText('Email is required')
    await host.getByLabel('Name', { exact: true }).fill('Maria Verdi')
    await host.getByLabel('Email', { exact: true }).fill('maria@')
    await host.getByRole('button', { name: 'Send' }).click()
    await expect(host.getByRole('alert').filter({ hasText: 'Please fix the following' })).toContainText('Email: enter an email address')
    await accessible(pub, 'public form with errors')

    // FRM-08: a visitor answers and sees the thank-you message
    await host.getByLabel('Email', { exact: true }).fill('maria@example.org')
    await host.getByRole('radio', { name: 'Fish' }).check()
    await host.getByRole('button', { name: 'Send' }).click()
    await expect(host.getByTestId('thanks')).toContainText('See you at the festival!')

    // FRM-09: the same browser again is refused with a clear message
    await pub.reload()
    await host.getByLabel('Name', { exact: true }).fill('Maria Again')
    await host.getByLabel('Email', { exact: true }).fill('maria@example.org')
    await host.getByRole('button', { name: 'Send' }).click()
    await expect(host.getByRole('alert')).toContainText(/already answered/i)

    // FRM-10: back in the signed-in session: two answers, the visitor's one by «visitor», and the CSV has two rows
    await nav(page, 'Forms').click()
    const frame = frameOf(page)
    await expect(form(frame, TITLE)).toContainText('2 answers')
    await form(frame, TITLE).getByRole('button', { name: 'Answers' }).click()
    await expect(frame.getByTestId('summary')).toHaveText('Answers: 2')
    await expect(frame.getByTestId('answer')).toHaveCount(2)
    await expect(frame.getByTestId('answer').filter({ hasText: 'visitor' })).toContainText('maria@example.org')
    await expect(frame.getByTestId('bar').filter({ hasText: 'Fish' })).toContainText('1 (50%)')
    const download = page.waitForEvent('download')
    await frame.getByRole('button', { name: 'Export CSV' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('frm-registration.csv')
    const csv = readFileSync((await file.path())!, 'utf8').replace(/^﻿/, '')
    const lines = csv.split(/\r?\n/).filter(Boolean)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('Name,Submitted at,Name,Menu,Email')
    expect(lines.some((l) => /^visitor,.*,Maria Verdi,Fish,maria@example\.org$/.test(l))).toBe(true)
    expect(lines.some((l) => /^manager,.*,Anna Rossi,Vegetarian,anna@example\.org$/.test(l))).toBe(true)

    // FRM-11: the manager deletes an answer (spam) after confirming
    await frame.getByTestId('answer').filter({ hasText: 'visitor' }).getByRole('button', { name: /Delete the answer of visitor/ }).click()
    await frame.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(frame.getByTestId('summary')).toHaveText('Answers: 1')

    // FRM-12: a closed form: the public page says so
    await frame.getByRole('button', { name: '← Forms' }).click()
    await form(frame, TITLE).getByRole('button', { name: 'Edit' }).click()
    await frame.getByLabel('Open (takes answers)').uncheck()
    await frame.getByRole('button', { name: 'Save' }).click()
    await expect(form(frame, TITLE).locator('.fm-state')).toHaveText('Closed')
    const closed = await openPublic(browser, link, context)
    await expect(closed.host.getByTestId('notice')).toContainText('closed')
    await expect(closed.host.getByRole('button', { name: 'Send' })).toHaveCount(0)
    await accessible(closed.pub, 'public form closed')

    // FRM-13: with the policy of the tenant off the public page says so clearly
    await publicCommands(page, false)
    const off = await openPublic(browser, link, context)
    await expect(off.host.getByTestId('notice')).toContainText('not available')
    await context.close()
  })
})
