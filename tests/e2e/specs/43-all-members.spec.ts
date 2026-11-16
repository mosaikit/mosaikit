import { expect, test } from '@playwright/test'
import { PASSWORD, login, nav } from './support'

// The built-in group «All members» (docs/manual-tests.md, SH16-01..03): a share with everybody in the tenant in
// one step from the share dialog, and the group is read-only in Manage › Groups.

test.describe.serial('All members', () => {
  test('share with all members from the dialog; the group is read-only', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await login(page, 'Alfa', 'manager', PASSWORD)

    // SH16-01: a note, shared with all the members in one step
    await nav(page, 'Notes').click()
    const frame = page.frameLocator('iframe.plugin-frame')
    await frame.getByRole('button', { name: /New/ }).first().click()
    await frame.locator('[data-key="title"]').fill('For everybody')
    await frame.getByRole('button', { name: 'Save' }).click()
    await frame.getByRole('button', { name: 'Share…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Sharing' })
    await dialog.getByTestId('share-all-members').click()
    await expect(dialog.getByRole('list', { name: 'Shared with' })).toContainText('All members')
    await expect(dialog.getByTestId('share-all-members')).toBeDisabled()
    await dialog.getByRole('button', { name: 'Close' }).click()

    // SH16-02: in Manage › Groups the group has no people list, no delete and no add
    await page.goto('./#/t/alfa/manage/groups')
    const card = page.locator('[data-slot="card"]', { hasText: 'All members' }).first()
    await expect(card).toContainText('Every member of the organization')
    await expect(card).toContainText('Kept by the platform')
    await expect(page.getByRole('button', { name: 'Delete the group All members' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Add' })).toHaveCount(0)
    await ctx.close()
  })
})
