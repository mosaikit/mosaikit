import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Approvals (docs/manual-tests.md, APR-01..08): an empty state, a request with the person picked in the directory, the tab «To decide»
// and its badge, a rejection that needs a comment, an approval that is final, a cancelled request. The rules of the modes `any` and
// `sequence` are covered by the Rust unit tests of the plugin (only one user exists here).

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const request = (frame: FrameLocator, title: string) => frame.locator('[data-testid=request]', { hasText: title }).first()

/** Sends a request with the manager himself as the only approver, then leaves the offer to share for later. */
async function send(frame: FrameLocator, title: string, o: { details?: string; amount?: string } = {}) {
  await frame.getByRole('button', { name: /^＋ New request/ }).first().click()
  await frame.getByRole('textbox', { name: 'Title', exact: true }).fill(title)
  if (o.details) await frame.getByRole('textbox', { name: 'Details', exact: true }).fill(o.details)
  if (o.amount) await frame.getByRole('textbox', { name: /^Amount/ }).fill(o.amount)
  await frame.getByRole('searchbox', { name: 'Add an approver' }).fill('manager')
  await frame.locator('.msk-person-opt').first().click()
  await expect(frame.locator('.apr-item strong')).toHaveCount(1)
  await frame.getByRole('button', { name: 'Send request' }).click()
  // the dialog that offers the sharing dialog (the approvers need read access to decide)
  await expect(frame.getByRole('dialog')).toContainText('Request sent')
  await frame.getByRole('button', { name: 'Later' }).click()
  await expect(request(frame, title)).toBeVisible()
}

test.describe.serial('Approvals', () => {
  test('request, to decide, rejection needs a comment, final approval, cancellation', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await nav(page, 'Approvals').click()
    const frame = frameOf(page)
    await expect(frame.getByRole('heading', { name: 'Approvals', exact: true })).toBeVisible()

    // APR-01: nothing yet, the illustrated empty state with the primary action
    await expect(frame.getByTestId('empty-state')).toBeVisible()
    await expect(frame.getByTestId('empty-state').getByRole('button', { name: /New request/ })).toBeVisible()

    // APR-02: a request with details, an amount and the manager as approver; it is listed with its state in words
    await send(frame, 'APR laptop', { details: 'A laptop for the new designer.', amount: '1200 EUR' })
    const laptop = request(frame, 'APR laptop')
    await expect(laptop.locator('.msk-chip')).toHaveText('Pending')
    await expect(laptop).toContainText('1200 EUR')
    await expect(laptop.locator('.apr-ap')).toHaveCount(1)
    await accessible(page, 'approvals list')

    // APR-03: «To decide» lists it, with the badge in the header
    await frame.getByRole('button', { name: 'To decide' }).click()
    await expect(request(frame, 'APR laptop')).toBeVisible()
    await expect(frame.getByTestId('todo-badge')).toHaveText('1 to decide')

    // APR-04: a rejection without a comment is refused; the request stays pending
    await request(frame, 'APR laptop').getByRole('button', { name: 'Open', exact: true }).click()
    const dlg = frame.getByRole('dialog')
    await expect(dlg).toContainText('A laptop for the new designer.')
    await accessible(page, 'approvals detail')
    // APR-13: an open request lets a writer change its approvers; with none left the change is refused
    await dlg.getByRole('button', { name: 'Change approvers' }).click()
    const change = frame.getByRole('dialog').last()
    await expect(change).toContainText('People who already decided stay on the request.')
    await change.getByRole('button', { name: /^Remove: / }).click()
    await change.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(frame.locator('body')).toContainText('Choose at least one approver')
    await change.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dlg.locator('.msk-chip')).toHaveText('Pending')
    await dlg.getByRole('button', { name: 'Reject' }).click()
    await expect(frame.locator('body')).toContainText('Say why you reject the request')
    await expect(dlg.locator('.msk-chip')).toHaveText('Pending')

    // APR-05: approve with a comment; the state becomes Approved, the buttons disappear and nobody can decide again
    await dlg.getByRole('textbox', { name: 'Comment' }).fill('Within the budget.')
    await dlg.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(dlg.locator('.msk-chip')).toHaveText('Approved')
    await expect(dlg.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
    await expect(dlg.getByRole('button', { name: 'Reject' })).toHaveCount(0)
    await expect(dlg.getByRole('button', { name: 'Change approvers' })).toHaveCount(0)
    await expect(dlg).toContainText('Within the budget.')
    await dlg.getByRole('button', { name: 'Close' }).click()

    // the list: nothing left to decide, the decided request keeps its comment in «All»
    await expect(frame.getByTestId('empty-state')).toContainText('Nothing to decide')
    await expect(frame.getByTestId('todo-badge')).toHaveCount(0)
    await frame.getByRole('button', { name: 'All' }).click()
    await expect(request(frame, 'APR laptop').locator('.msk-chip')).toHaveText('Approved')
    await expect(request(frame, 'APR laptop')).toContainText('Within the budget.')

    // APR-06: a request the owner cancels shows Cancelled and leaves «To decide»
    await send(frame, 'APR trip')
    await frame.getByRole('button', { name: 'All' }).click()
    await request(frame, 'APR trip').getByRole('button', { name: 'Open', exact: true }).click()
    await frame.getByRole('dialog').getByRole('button', { name: 'Cancel the request' }).click()
    await frame.getByRole('dialog').last().getByRole('button', { name: 'Cancel the request' }).click()
    await expect(frame.getByRole('dialog').first().locator('.msk-chip')).toHaveText('Cancelled')
    await expect(frame.getByRole('dialog').first().getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
    await frame.getByRole('dialog').first().getByRole('button', { name: 'Close' }).click()
    await expect(request(frame, 'APR trip').locator('.msk-chip')).toHaveText('Cancelled')
    await frame.getByRole('button', { name: 'To decide' }).click()
    await expect(request(frame, 'APR trip')).toHaveCount(0)
  })
})
