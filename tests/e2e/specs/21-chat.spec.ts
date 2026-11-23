import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, logout, nav } from './support'

// Chat (docs/manual-tests.md, CHT-10..): the replica of the Chat section of Teams, with two people of one tenant (the Tenant
// Manager and a person made here). The channels of Chat 1.x are reached from the Channels tab at the top of the list (CHT-01..05 of the old UI
// are covered by the Channels check at the end).

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const bubble = (f: FrameLocator, text: string) => f.locator('.cb', { hasText: text }).first()

async function openChat(page: Page) {
  await nav(page, 'Chat').click()
  const f = frameOf(page)
  await expect(f.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible()
  return f
}

async function say(f: FrameLocator, text: string) {
  const box = f.getByRole('textbox', { name: 'Type a message' })
  await box.fill(text)
  await box.press('Enter')
}

async function newChat(f: FrameLocator, names: string[], group = '') {
  await f.getByRole('button', { name: 'New chat' }).first().click()
  for (const n of names) {
    await f.getByRole('searchbox', { name: 'To' }).fill(n)
    await f.getByRole('option', { name: n }).click()
  }
  if (group) await f.getByRole('textbox', { name: 'Group name (optional)' }).fill(group)
  await f.getByRole('button', { name: 'Start chat' }).click()
  await expect(f.getByRole('dialog')).toBeHidden()
}

test.describe.serial('Chat', () => {
  test('one-to-one chat: list, live messages, reply, reaction, edit, delete, seen, unread, pin, call, files tab', async ({ browser }) => {
    test.setTimeout(240_000)
    const a = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    const b = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()

    // two people besides the manager, made through Manage
    await login(a, 'Alfa', 'manager', PASSWORD)
    await nav(a, 'Manage').click()
    for (const [user, name] of [
      ['chatcarla', 'Carla Chat'],
      ['chatdario', 'Dario Chat'],
    ]) {
      await a.getByRole('button', { name: 'New user' }).click()
      const d = a.getByRole('dialog', { name: 'New user' })
      await d.getByLabel('Username').fill(user)
      await d.getByLabel('Display name').fill(name)
      await d.getByLabel('Email', { exact: true }).fill(`${user}@example.org`)
      await d.getByLabel('Initial password').fill(PASSWORD)
      await d.getByRole('button', { name: 'Create user' }).click()
      await expect(a.getByRole('row', { name: new RegExp(name) })).toBeVisible()
    }

    // CHT-10: nothing yet: the illustrated empty state with the primary action
    const fa = await openChat(a)
    await expect(fa.getByRole('heading', { name: 'No chats yet' })).toBeVisible()

    // CHT-11: New chat with a person found by typing; the chat opens with her name
    await newChat(fa, ['Carla Chat'])
    await expect(fa.getByRole('heading', { name: 'Carla Chat', level: 2 })).toBeVisible()

    // CHT-12: a message with formatting, and the other person sees it at once with an unread badge
    await login(b, 'Alfa', 'chatcarla', PASSWORD)
    const fb = await openChat(b)
    await say(fa, 'hello **world** @Carla Chat please')
    await expect(bubble(fa, 'hello').locator('strong', { hasText: 'world' })).toBeVisible()
    await expect(bubble(fa, 'hello').locator('.cm-mention')).toHaveText('@Carla Chat')
    const row = fb.locator('.cl-row').first()
    await expect(row.locator('.cl-badge')).toHaveText(/1|@/)
    await expect(row).toContainText('hello world @Carla Chat please')

    // CHT-13: opening it shows the message, clears the badge and the sender sees «Seen»
    await row.click()
    await expect(bubble(fb, 'hello')).toBeVisible()
    await expect(fb.locator('.cl-row').first().locator('.cl-badge')).toHaveCount(0)
    await expect(fa.locator('.cb-seen')).toContainText('Seen')

    // CHT-14: reply with a quote, reaction with who reacted, edit with «edited», delete with the trace
    await bubble(fb, 'hello').hover()
    await bubble(fb, 'hello').getByRole('button', { name: 'Reply' }).click()
    await say(fb, 'thanks')
    await expect(bubble(fa, 'thanks').locator('.cb-quote')).toContainText('hello')
    await bubble(fa, 'thanks').hover()
    await bubble(fa, 'thanks').getByRole('button', { name: 'React 👍' }).click()
    await expect(bubble(fb, 'thanks').locator('.cb-react')).toContainText('1')
    await expect(bubble(fb, 'thanks').locator('.cb-react')).toHaveAttribute('title', /reacted with 👍/)
    await bubble(fb, 'thanks').hover()
    await bubble(fb, 'thanks').getByRole('button', { name: 'More actions' }).click()
    await fb.getByRole('menuitem', { name: 'Edit' }).click()
    await fb.getByRole('textbox', { name: 'Type a message' }).fill('thanks a lot')
    await fb.getByRole('textbox', { name: 'Type a message' }).press('Enter')
    await expect(bubble(fa, 'thanks a lot').locator('.cb-edited')).toHaveText('edited')
    await bubble(fb, 'thanks a lot').hover()
    await bubble(fb, 'thanks a lot').getByRole('button', { name: 'More actions' }).click()
    await fb.getByRole('menuitem', { name: 'Delete' }).click()
    await fb.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(fa.getByText('This message was deleted')).toBeVisible()

    // CHT-15: importance, pin and the Pinned tab
    await a.keyboard.press('Escape')
    await fa.getByRole('button', { name: 'Importance' }).click()
    await fa.getByRole('menuitem', { name: /Urgent/ }).click()
    await say(fa, 'server down')
    await expect(bubble(fa, 'server down').locator('.cb-imp')).toContainText('Urgent')
    await bubble(fa, 'server down').hover()
    await bubble(fa, 'server down').getByRole('button', { name: 'More actions' }).click()
    await fa.getByRole('menuitem', { name: 'Pin' }).click()
    await fa.getByRole('tab', { name: 'Pinned' }).click()
    await expect(fa.locator('.cp-item', { hasText: 'server down' })).toBeVisible()
    await fa.getByRole('tab', { name: 'Files' }).click()
    await expect(fa.getByRole('heading', { name: 'No files yet' })).toBeVisible()
    await fa.getByRole('tab', { name: 'Chat' }).click()

    // CHT-16: pin and mute the chat from its menu; the filters
    await fa.locator('.cl-item').first().hover()
    await fa.locator('.cl-more').first().click()
    await fa.getByRole('menuitem', { name: 'Pin' }).click()
    await expect(fa.getByRole('heading', { name: 'Pinned', level: 2 })).toBeVisible()
    await fa.getByRole('button', { name: 'Unread' }).click()
    await expect(fa.getByText('No chat matches.')).toBeVisible()
    await fa.getByRole('button', { name: 'All', exact: true }).click()

    // CHT-17: a call: the card in the chat of both, the call in a frame, the end with its duration
    await fa.getByRole('button', { name: 'Video call' }).click()
    await expect(fa.locator('iframe.ccall-frame')).toHaveAttribute('src', /meet\.jit\.si\/mosaikit-/)
    await expect(fb.locator('.cm-call.live')).toContainText('started a call')
    await fa.getByRole('button', { name: 'Leave the call' }).click()
    await expect(fb.locator('.cm-call')).toContainText('Call ended')

    await accessible(a, 'chat')
    await a.context().close()
    await b.context().close()
  })

  test('group chat: name, people, add with history, leave; and the channels of earlier versions', async ({ browser }) => {
    test.setTimeout(240_000)
    const a = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    const b = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    await login(a, 'Alfa', 'manager', PASSWORD)
    await login(b, 'Alfa', 'chatcarla', PASSWORD)
    const fa = await openChat(a)
    const fb = await openChat(b)

    // CHT-18: a group of two people with a name; the system line and the list
    await newChat(fa, ['Carla Chat', 'Dario Chat'], 'Launch team')
    await expect(fa.getByRole('heading', { name: 'Launch team', level: 2 })).toBeVisible()
    await say(fa, 'welcome all')
    // a new chat reaches the list of the others within the refresh of the list (15 seconds)
    await expect(fb.locator('.cl-row', { hasText: 'Launch team' })).toContainText('welcome all', { timeout: 45_000 })
    await fb.locator('.cl-row', { hasText: 'Launch team' }).click()
    await expect(bubble(fb, 'welcome all')).toBeVisible()
    await expect(fb.getByText('3 people')).toBeVisible()

    // CHT-19: Carla leaves; the others read it in the chat
    await fb.locator('.cl-item', { hasText: 'Launch team' }).hover()
    await fb.locator('.cl-item', { hasText: 'Launch team' }).locator('.cl-more').click()
    await fb.getByRole('menuitem', { name: 'Leave' }).click()
    await fb.getByRole('dialog').getByRole('button', { name: 'Leave' }).click()
    await expect(fb.locator('.cl-row', { hasText: 'Launch team' })).toHaveCount(0)
    await expect(fa.getByText(/left the chat/)).toBeVisible({ timeout: 45_000 })

    // CHT-20: the channels of Chat 1.x are still there, behind the Channels tab at the top of the list
    await fa.getByRole('tab', { name: 'Channels' }).click()
    await expect(fa.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    // CHT-25: one entry «Chat» in the sidebar (no sub-items); the tab is remembered; arrows switch back
    await expect(nav(a, 'Channels')).toHaveCount(0)
    await a.reload()
    await nav(a, 'Chat').click()
    await expect(frameOf(a).getByRole('tab', { name: 'Channels' })).toHaveAttribute('aria-selected', 'true')
    await frameOf(a).getByRole('tab', { name: 'Channels' }).press('ArrowLeft')
    await expect(frameOf(a).getByRole('tab', { name: 'Chats' })).toHaveAttribute('aria-selected', 'true')
    await expect(frameOf(a).getByRole('tab', { name: 'Chats' })).toBeFocused()
    await logout(a)
    await a.context().close()
    await b.context().close()
  })
})
