import { expect, test, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Meet (docs/manual-tests.md, MET-01..03): a room is created, opens inside the page with the meeting service (the frame of the
// plugin is given the camera and the microphone because the manifest asks for `media`), and the person leaves it again.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')

test.describe.serial('Meet', () => {
  test('create a room, join it inside the page, leave', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await nav(page, 'Meet').click()
    const frame = frameOf(page)
    await expect(frame.getByRole('heading', { name: 'Meet', exact: true })).toBeVisible()

    // MET-01: a room
    await frame.getByRole('button', { name: /New room/ }).first().click()
    await frame.getByRole('textbox', { name: 'Name', exact: true }).fill('Standup')
    await frame.getByRole('textbox', { name: /Topic/ }).fill('Every morning')
    await frame.getByRole('button', { name: 'Create', exact: true }).click()
    const card = frame.locator('.mt-card', { hasText: 'Standup' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('Every morning')
    await accessible(page, 'meet rooms')

    // MET-02: the frame of the plugin may pass the camera and the microphone on, and the room shows the service
    const allow = await page.locator('iframe.plugin-frame').getAttribute('allow')
    expect(allow).toContain('camera')
    expect(allow).toContain('microphone')
    await card.getByRole('button', { name: /Join/ }).click()
    const meeting = frame.locator('iframe.mt-frame')
    await expect(meeting).toBeVisible()
    const src = await meeting.getAttribute('src')
    expect(src).toMatch(/^https:\/\/meet\.jit\.si\/mosaikit-[0-9a-f]{32}#/)
    expect(await meeting.getAttribute('allow')).toContain('camera')
    await expect(frame.getByRole('heading', { name: 'Standup' })).toBeVisible()
    await expect(frame.locator('.mt-count')).toHaveText('You are in the room')

    // MET-03: leaving goes back to the rooms
    await frame.getByRole('button', { name: 'Leave' }).click()
    await expect(frame.locator('.mt-card', { hasText: 'Standup' })).toBeVisible()
    await expect(frame.locator('iframe.mt-frame')).toHaveCount(0)
  })
})
