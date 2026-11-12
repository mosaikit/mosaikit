import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { BASE, PASSWORD, accessible, login, nav } from './support'

// Polls with a public link (docs/manual-tests.md, POL-10..): people outside the tenant vote from a public link, once for
// each browser, see the bars when the poll shows them and never see who voted. The manager creates the poll in the UI,
// allows public commands for the tenant and creates the link with the REST calls; every voter is a fresh browser context
// with no session.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const publicFrame = (page: Page) => page.frameLocator('iframe#v')
const bar = (frame: FrameLocator, name: string) => frame.getByRole('progressbar', { name })

/** A call to the tenant API as the signed-in person (with the CSRF token of the session). */
async function api(page: Page, method: string, path: string, body?: unknown) {
  const r = await page.evaluate(
    async ([base, method, path, body]) => {
      const s = await (await fetch(`${base}/api/session`)).json()
      const r = await fetch(`${base}${path}`, {
        method: method as string,
        headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await r.text()
      return { status: r.status, json: text ? JSON.parse(text) : {} }
    },
    [BASE, method, path, body] as const,
  )
  expect(r.status, JSON.stringify(r.json)).toBeLessThan(300)
  return r.json as Record<string, any>
}

/** A browser with no session at all opens the public link. */
async function openPublic(browser: import('@playwright/test').Browser, url: string) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } })
  const pub = await ctx.newPage()
  await pub.goto(url)
  return { ctx, pub, frame: publicFrame(pub) }
}

test.describe.serial('Polls: public link', () => {
  test('outsiders vote once from the link, see the bars, never the names; the owner counts them as visitors', async ({ browser }) => {
    test.setTimeout(180_000)
    const m = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    await login(m, 'Alfa', 'manager', PASSWORD)
    await nav(m, 'Polls').click()
    const fm = frameOf(m)
    await expect(fm.getByRole('heading', { name: 'Polls', exact: true })).toBeVisible()

    // a poll that shows the results always (the UI of the plugin)
    await fm.getByRole('button', { name: /^＋ New poll/ }).first().click()
    await fm.getByRole('textbox', { name: 'Question', exact: true }).fill('POLPUB lunch')
    await fm.getByRole('textbox', { name: 'Option 1', exact: true }).fill('Pizza')
    await fm.getByRole('textbox', { name: 'Option 2', exact: true }).fill('Sushi')
    await fm.getByLabel('Show results').selectOption('always')
    await fm.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(fm.getByRole('dialog')).toHaveCount(0)
    await fm.getByRole('button', { name: 'POLPUB lunch', exact: true }).click()
    await expect(fm.getByRole('heading', { name: 'POLPUB lunch', exact: true })).toBeVisible()

    // POL-10: the detail has a «Public link» button with a hint; it opens the sharing dialog
    await expect(fm.getByText('People outside the organisation vote from the link')).toBeVisible()
    await fm.getByRole('button', { name: 'Public link', exact: true }).click()
    await expect(m.getByRole('dialog')).toBeVisible()
    await m.keyboard.press('Escape')
    await expect(m.getByRole('dialog')).toHaveCount(0)

    // the tenant allows public commands and the link exists (REST, as the Tenant Manager)
    const list = await api(m, 'GET', '/api/t/alfa/p/com.mosaikit.polls/r/polls?limit=200')
    const id = (list.rows as { id: string; values: { question: string } }[]).find((r) => r.values.question === 'POLPUB lunch')!.id
    const settings = await api(m, 'GET', '/api/t/alfa/manage/settings')
    settings.public_commands_enabled = true
    settings.public_links_enabled = true
    await api(m, 'PUT', '/api/t/alfa/manage/settings', settings)
    const link = await api(m, 'POST', `/api/t/alfa/resources/${id}/links`, {})

    // POL-11: a visitor with no session sees the question and the options, votes and sees the bars
    const a = await openPublic(browser, link.url)
    await expect(a.frame.getByRole('heading', { name: 'POLPUB lunch', exact: true })).toBeVisible()
    await expect(a.frame.getByRole('radio')).toHaveCount(2)
    await a.frame.getByRole('radio', { name: 'Pizza' }).check()
    await a.frame.getByRole('button', { name: 'Vote', exact: true }).click()
    await expect(a.frame.getByText('Your vote is saved')).toBeVisible()
    await expect(bar(a.frame, 'Pizza: 100%')).toHaveAttribute('aria-valuenow', '100')
    await expect(bar(a.frame, 'Sushi: 0%')).toBeVisible()
    await expect(a.frame.getByTestId('total')).toHaveText('1 person voted')
    await accessible(a.pub, 'public poll with results')

    // POL-12: the same browser again: «already voted», the choice cannot be changed
    await a.pub.reload()
    await expect(a.frame.getByText('You have already voted from this browser')).toBeVisible()
    await expect(a.frame.getByRole('radio', { name: 'Pizza' })).toBeDisabled()
    await expect(a.frame.getByRole('radio', { name: 'Pizza' })).toBeChecked()
    await expect(a.frame.getByRole('button', { name: 'Vote', exact: true })).toHaveCount(0)
    await expect(bar(a.frame, 'Pizza: 100%')).toBeVisible()

    // POL-13: another browser votes for the other option and sees both bars; it never sees a name
    const b = await openPublic(browser, link.url)
    await b.frame.getByRole('radio', { name: 'Sushi' }).check()
    await b.frame.getByRole('button', { name: 'Vote', exact: true }).click()
    await expect(bar(b.frame, 'Pizza: 50%')).toBeVisible()
    await expect(bar(b.frame, 'Sushi: 50%')).toBeVisible()
    await expect(b.frame.getByTestId('total')).toHaveText('2 people voted')
    await expect(b.frame.locator('body')).not.toContainText('visitor')
    await expect(b.frame.locator('.po-voter')).toHaveCount(0)

    // POL-14: back in the session the owner counts the two voters, of which two visitors, with no names
    await fm.getByRole('button', { name: '← Polls' }).click()
    await fm.getByRole('button', { name: 'POLPUB lunch', exact: true }).click()
    await expect(fm.getByTestId('total')).toHaveText('2 people voted')
    await expect(fm.getByTestId('visitors')).toHaveText('Visitors: 2')
    await expect(fm.locator('.po-voter')).toHaveCount(0)
    await expect(bar(fm, 'Pizza: 50%')).toBeVisible()

    // POL-15: close the poll: the public page says it is closed and takes no vote
    await fm.getByRole('button', { name: 'Close the poll' }).click()
    await expect(fm.getByText('This poll is closed: voting is disabled.')).toBeVisible()
    await a.pub.reload()
    await expect(a.frame.getByText('This poll is closed: voting is disabled.')).toBeVisible()
    await expect(a.frame.getByText('Closed', { exact: true })).toBeVisible()
    const c = await openPublic(browser, link.url)
    await expect(c.frame.getByText('This poll is closed: voting is disabled.')).toBeVisible()
    await expect(c.frame.getByRole('radio', { name: 'Pizza' })).toBeDisabled()
    await expect(c.frame.getByRole('button', { name: 'Vote', exact: true })).toHaveCount(0)
    await accessible(c.pub, 'public poll closed')

    // POL-16: with the public commands turned off the page says so
    settings.public_commands_enabled = false
    await api(m, 'PUT', '/api/t/alfa/manage/settings', settings)
    await c.pub.reload()
    await expect(c.frame.getByText('cannot take votes from a public link right now')).toBeVisible()
    settings.public_commands_enabled = true
    await api(m, 'PUT', '/api/t/alfa/manage/settings', settings)

    for (const x of [a, b, c]) await x.ctx.close()
  })
})
