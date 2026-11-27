import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, adminLogin, login, logout } from './support'

// AI assistant (docs/manual-tests.md, AIA-01..AIA-10), with the test provider of the kernel (no model: a message
// `tool:<name> <json>` asks for that tool, anything else is echoed). The Administrator sets the provider; the icon in the top
// bar opens the side panel; a tool that writes is proposed and the HOST asks to confirm; the chats are saved, renamed and
// deleted; a token opens the MCP server of the tenant, read-only unless writes are on.

const panel = (page: Page): FrameLocator => page.frameLocator('#msk-assistant-panel iframe.plugin-frame')

async function say(frame: FrameLocator, text: string) {
  const box = frame.getByTestId('assistant-input')
  await box.fill(text)
  await box.press('Enter')
}

test.describe.serial('AI assistant', () => {
  test('AIA-01: the Administrator sets the provider; nothing is offered before', async ({ page }) => {
    // before: a person does not see the icon
    await login(page, 'Alfa', 'manager', PASSWORD)
    await expect(page.getByTestId('assistant-button')).toHaveCount(0)
    await logout(page)

    await adminLogin(page)
    await page.goto('./#/admin/system/assistant')
    await expect(page.getByTestId('assistant-admin')).toBeVisible()
    await expect(page.getByTestId('assistant-admin').getByText('AI assistant', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Key', { exact: true })).toHaveAttribute('type', 'password')
    // the test provider has no field on the page: the API sets it, as an installation script would
    const status = await page.evaluate(async () => {
      const s = await (await fetch('api/session')).json()
      const r = await fetch('api/admin/assistant', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrf },
        body: JSON.stringify({ provider: 'fake', model: 'test', api_key: 'sk-never-shown', enabled: true, allow_byok: false }),
      })
      return r.status
    })
    expect(status).toBe(200)
    await page.reload()
    // the key is saved and never comes back to the page
    await expect(page.getByTestId('assistant-admin')).toBeVisible()
    await expect(page.getByLabel('Key', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Key', { exact: true })).toHaveAttribute('placeholder', /A key is saved/)
    expect(await page.content()).not.toContain('sk-never-shown')
    await accessible(page, 'assistant admin settings')
    await logout(page)
  })

  test('AIA-02: the icon opens the panel; a read tool runs as the person', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    const icon = page.getByTestId('assistant-button')
    await expect(icon).toBeVisible()
    await expect(page.getByTestId('assistant-panel')).toBeHidden()
    await icon.click()
    await expect(page.getByTestId('assistant-panel')).toBeVisible()
    const frame = panel(page)
    await expect(frame.getByRole('heading', { name: 'AI Assistant', exact: true })).toBeVisible()
    await expect(frame.getByTestId('empty-state')).toBeVisible()
    await say(frame, 'tool:kernel__whoami {}')
    await expect(frame.getByTestId('assistant-step').first()).toContainText('kernel › whoami')
    await expect(frame.locator('.as-msg.bot').last()).toContainText('Tool result:')
    await expect(frame.locator('.as-msg.bot').last()).toContainText('City of Alfa')
    await accessible(page, 'assistant panel')
    // Escape inside the frame (and the close button) close the panel and the icon says so
    await frame.getByTestId('assistant-input').press('Escape')
    await expect(page.getByTestId('assistant-panel')).toBeHidden()
    await expect(icon).toHaveAttribute('aria-expanded', 'false')
  })

  test('AIA-03: a change is proposed, the host asks, and the note is made', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await page.getByTestId('assistant-button').click()
    const frame = panel(page)
    await frame.getByTestId('assistant-new').click()
    await say(frame, 'tool:notes__create_note {"title":"AIA note","body":"made by the assistant"}')
    const proposal = frame.getByTestId('assistant-proposal')
    await expect(proposal).toBeVisible()
    // said in words: the app, what it does and a label for each field, not the JSON of the call
    await expect(proposal).toContainText('Create in Notes')
    await expect(proposal.locator('.as-field dt').first()).toHaveText('Title')
    await expect(proposal).toContainText('made by the assistant')
    await expect(proposal).not.toContainText('{')
    // declining in the dialog of the host runs nothing
    await proposal.getByTestId('assistant-run').click()
    const dialog = page.getByRole('alertdialog')
    // the dialog of the platform lists the same: a title, the app, and «label: value» rows
    await expect(dialog.getByTestId('confirm-action')).toContainText('Create in Notes')
    await expect(dialog.getByTestId('confirm-action')).toContainText('AIA note')
    await expect(dialog).not.toContainText('{')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(frame.locator('.as-msg.bot').last()).toContainText('declined')
    // again, and confirm
    await say(frame, 'tool:notes__create_note {"title":"AIA note","body":"made by the assistant"}')
    await frame.getByTestId('assistant-run').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click()
    await expect(frame.locator('.as-msg.bot').last()).toContainText('AIA note')
    // the note exists, as the person
    await page.getByTestId('assistant-panel').getByRole('button', { name: 'Close the assistant' }).click()
    await page.locator('[data-sidebar="sidebar"]').getByRole('link', { name: 'Notes', exact: true }).click()
    await expect(page.frameLocator('#main iframe.plugin-frame').getByText('AIA note').first()).toBeVisible()
  })

  test('AIA-04: chats are saved, resumed, renamed and deleted', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await page.getByTestId('assistant-button').click()
    const frame = panel(page)
    await frame.getByTestId('assistant-new').click()
    await say(frame, 'hello there assistant')
    await expect(frame.locator('.as-msg.bot').last()).toContainText('fake: hello there assistant')
    await frame.getByTestId('assistant-history').click()
    const item = frame.getByTestId('assistant-chat').filter({ hasText: 'hello there assistant' })
    await expect(item).toBeVisible()
    // resume
    await item.click()
    await expect(frame.locator('.as-msg.user').last()).toContainText('hello there assistant')
    // rename
    await frame.getByTestId('assistant-history').click()
    await frame.getByRole('button', { name: 'Rename' }).first().click()
    await frame.getByRole('textbox', { name: 'Name of the chat' }).fill('Renamed chat')
    await frame.getByRole('button', { name: 'Save' }).click()
    await expect(frame.getByTestId('assistant-chat').filter({ hasText: 'Renamed chat' })).toBeVisible()
    // delete
    await frame.getByRole('button', { name: 'Delete' }).first().click()
    await frame.getByRole('button', { name: 'Delete' }).last().click()
    await expect(frame.getByTestId('assistant-chat').filter({ hasText: 'Renamed chat' })).toHaveCount(0)
  })

  test('AIA-06: the model is chosen, a file is attached, the box is compact', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await page.getByTestId('assistant-button').click()
    const frame = panel(page)
    await frame.getByTestId('assistant-new').click()
    // the chooser: a Tenant Manager sees every model of the provider (the test provider has two) and the default
    const pick = frame.getByTestId('assistant-model')
    await expect(pick.locator('option')).toHaveCount(3)
    await pick.selectOption('fake-large')
    // a text file: a chip with its name and size, then it goes with the question and is shown on it
    await frame.getByTestId('assistant-file-input').setInputFiles({ name: 'minutes.txt', mimeType: 'text/plain', buffer: Buffer.from('Decisions: publish the plan') })
    await expect(frame.getByTestId('assistant-file')).toContainText('minutes.txt')
    // a file that is not accepted says so and is not attached
    await frame.getByTestId('assistant-file-input').setInputFiles({ name: 'run.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') })
    await expect(frame.getByTestId('assistant-file')).toHaveCount(1)
    await say(frame, 'summarise the file')
    await expect(frame.getByTestId('assistant-sent-file')).toContainText('minutes.txt')
    await expect(frame.locator('.as-msg.bot').last()).toContainText('[1 file(s): minutes.txt]')
    // the choice stays for the next question; the chips are gone from the box
    await expect(pick).toHaveValue('fake-large')
    await expect(frame.getByTestId('assistant-file')).toHaveCount(0)
    // the microphone: Chrome has the speech recognition (the headless test only sees the button)
    await expect(frame.getByTestId('assistant-mic')).toHaveCount(1)
    await accessible(page, 'assistant composer')
  })

  test('AIA-07: the person stops a reply that takes too long', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await page.getByTestId('assistant-button').click()
    const frame = panel(page)
    await frame.getByTestId('assistant-new').click()
    // the test provider waits as long as the question says: `sleep:<ms>`
    await say(frame, 'sleep:20000 a slow question')
    // while it works the send button is the stop button, and the seconds pass
    const stop = frame.getByTestId('assistant-stop')
    await expect(stop).toBeVisible()
    await expect(frame.locator('.as-busy')).toContainText('s')
    await stop.click()
    await expect(frame.getByTestId('assistant-stopped')).toBeVisible()
    await expect(frame.getByTestId('assistant-meta').last()).toContainText('Stopped after')
    // the box is free again: the next question is answered
    await expect(frame.getByTestId('assistant-send')).toBeVisible()
    await say(frame, 'sleep:100 a quick one')
    await expect(frame.locator('.as-msg.bot').last()).toContainText('fake: sleep:100 a quick one')
    // the stopped reply and the question stay in the saved chat
    await frame.getByTestId('assistant-history').click()
    await expect(frame.getByTestId('assistant-chat').filter({ hasText: 'a slow question' })).toBeVisible()
  })

  test('AIA-05: a token opens the MCP server, read-only unless writes are on', async ({ page, request }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    await page.getByTestId('assistant-button').click()
    const frame = panel(page)
    await frame.getByTestId('assistant-settings').click()
    await expect(frame.getByTestId('assistant-mcp-url')).toContainText('/api/t/alfa/mcp')
    await frame.getByTestId('assistant-token-name').fill('Claude Desktop')
    await frame.getByTestId('assistant-token-create').click()
    const token = (await frame.getByTestId('assistant-token-value').textContent())!.trim()
    expect(token).toMatch(/^mska_/)
    await expect(frame.getByTestId('assistant-tokens')).toContainText('Claude Desktop')
    await expect(frame.getByTestId('assistant-tokens')).toContainText('read-only')

    const url = (await frame.getByTestId('assistant-mcp-url').textContent())!.trim()
    const rpc = (method: string, params?: unknown, auth = token) =>
      request.post(url, { headers: { authorization: `Bearer ${auth}` }, data: { jsonrpc: '2.0', id: 1, method, params } })
    const list = await (await rpc('tools/list')).json()
    const names: string[] = list.result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('notes__create_note')
    expect(names).toContain('kernel__whoami')
    const who = await (await rpc('tools/call', { name: 'kernel__whoami', arguments: {} })).json()
    expect(who.result.isError).toBe(false)
    expect(who.result.content[0].text).toContain('City of Alfa')
    // a write with a read-only token is an error result, and nothing is made
    const write = await (await rpc('tools/call', { name: 'notes__create_note', arguments: { title: 'MCP note' } })).json()
    expect(write.result.isError).toBe(true)
    expect(write.result.content[0].text).toContain('read-only')
    // no token, a wrong token
    expect((await request.post(url, { data: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status()).toBe(401)
    expect((await rpc('ping', undefined, 'mska_wrong')).status()).toBe(401)

    // revoke: the same token stops working at once
    await frame.getByTestId('assistant-tokens').getByRole('button', { name: 'Revoke' }).click()
    await frame.getByRole('button', { name: 'Revoke' }).last().click()
    await expect(frame.getByTestId('assistant-tokens')).not.toContainText('Claude Desktop')
    expect((await rpc('ping')).status()).toBe(401)
  })
})
