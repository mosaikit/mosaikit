import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Chat (docs/manual-tests.md, CHT-01..05): channels, live messages between two sessions, replies, edit, reactions, delete.
// Two browser sessions of the same person stand for two people: the kernel tests cover who may read and write.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const msg = (frame: FrameLocator, text: string) => frame.locator('.cm', { hasText: text }).first()

async function openChat(page: Page) {
  await nav(page, 'Chat').click()
  const frame = frameOf(page)
  await expect(frame.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
  return frame
}

async function say(frame: FrameLocator, text: string) {
  const box = frame.getByRole('textbox', { name: /Write a message/ })
  await box.fill(text)
  await box.press('Enter')
}

test.describe.serial('Chat', () => {
  test('channel, live messages, reply, edit, reaction, delete', async ({ browser }) => {
    const a = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    const b = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    await login(a, 'Alfa', 'manager', PASSWORD)
    await login(b, 'Alfa', 'manager', PASSWORD)
    const fa = await openChat(a)

    // CHT-01: create a channel; the first message shows as Markdown
    await fa.locator('.cch-sidehead').getByRole('button', { name: 'New channel' }).click()
    await fa.getByRole('textbox', { name: 'Name', exact: true }).fill('general')
    await fa.getByRole('textbox', { name: /Topic/ }).fill('Everything')
    await fa.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(fa.getByRole('heading', { name: '# general' })).toBeVisible()
    await expect(fa.locator('.cch-titles p')).toHaveText('Everything')

    // CHT-02: the second session opens the channel and gets the message at once, without reloading
    const fb = await openChat(b)
    await fb.locator('.cch-ch', { hasText: 'general' }).click()
    await expect(fb.getByRole('heading', { name: '# general' })).toBeVisible()
    await say(fa, 'hello **world**')
    await expect(msg(fa, 'hello').locator('strong', { hasText: 'world' })).toBeVisible()
    await expect(msg(fb, 'hello').locator('strong', { hasText: 'world' })).toBeVisible()

    // CHT-03: a reply shows its quote on both sides; an edit shows «edited»
    await msg(fb, 'hello').hover()
    await msg(fb, 'hello').getByRole('button', { name: 'Reply' }).click()
    await expect(fb.locator('.cch-replybar')).toContainText('Replying to')
    await say(fb, 'second')
    await expect(msg(fb, 'second').locator('.cm-quote')).toContainText('hello')
    await expect(msg(fa, 'second').locator('.cm-quote')).toContainText('hello')
    await msg(fa, 'hello').hover()
    await msg(fa, 'hello').getByRole('button', { name: 'Edit' }).click()
    await fa.getByRole('textbox', { name: 'Edit' }).fill('hello again')
    await fa.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(msg(fb, 'hello again').locator('.cm-edited')).toHaveText('edited')

    // CHT-04: a reaction is counted on both sides and can be taken back
    await msg(fb, 'second').hover()
    await msg(fb, 'second').getByRole('button', { name: 'React' }).click()
    await fb.getByRole('menuitem', { name: '👍' }).click()
    await expect(msg(fa, 'second').locator('.cm-react')).toContainText('1')
    await msg(fb, 'second').locator('.cm-react').click()
    await expect(msg(fa, 'second').locator('.cm-react')).toHaveCount(0)

    // CHT-05: deleting a message removes it for the other session
    await msg(fa, 'hello again').hover()
    await msg(fa, 'hello again').getByRole('button', { name: 'Delete' }).click()
    await fa.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(msg(fa, 'hello again')).toHaveCount(0)
    await expect(msg(fb, 'hello again')).toHaveCount(0)
    await expect(msg(fb, 'second')).toBeVisible()

    await accessible(a, 'chat')
    await a.context().close()
    await b.context().close()
  })
})
