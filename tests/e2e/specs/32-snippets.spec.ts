import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { PASSWORD, accessible, login, nav } from './support'

// Snippets (docs/manual-tests.md, SNP-01..08): the list with an empty state, snippets with a kind and tags, the search, the
// filters by kind and by tag, the body kept as written, the Copy button, editing and deleting.

const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
const items = (frame: FrameLocator) => frame.getByTestId('snippet')
const item = (frame: FrameLocator, title: string) => frame.getByTestId('snippet').filter({ hasText: title })
const body = (frame: FrameLocator) => frame.getByTestId('snippet-body')

async function create(frame: FrameLocator, title: string, o: { body: string; kind?: string; tags?: string[] }) {
  await frame.getByRole('button', { name: /^＋ New snippet/ }).first().click()
  const dlg = frame.getByRole('dialog')
  await dlg.getByRole('textbox', { name: 'Title', exact: true }).fill(title)
  if (o.kind) await dlg.getByLabel('Kind', { exact: true }).selectOption(o.kind)
  await dlg.getByRole('textbox', { name: 'Content', exact: true }).fill(o.body)
  for (const t of o.tags ?? []) {
    const box = dlg.locator('.msk-taginput input')
    await box.fill(t)
    await box.press('Enter')
  }
  await dlg.getByRole('button', { name: 'Create' }).click()
  await expect(dlg).toHaveCount(0)
  await expect(item(frame, title)).toBeVisible()
}

test.describe.serial('Snippets', () => {
  test('list, search, filters, body as written, copy, edit, delete', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await login(page, 'Alfa', 'manager', PASSWORD)
    await nav(page, 'Snippets').click()
    const frame = frameOf(page)
    await expect(frame.getByRole('heading', { name: 'Snippets', exact: true })).toBeVisible()

    // SNP-01: nothing yet, the illustrated empty state with the primary action
    await expect(frame.getByTestId('empty-state')).toBeVisible()
    await expect(frame.getByTestId('empty-state').getByRole('button', { name: /New snippet/ })).toBeVisible()

    // SNP-02: a shell snippet with tags (written in any case, kept in lower case) and a text one with the default kind
    const deployBody = 'kubectl apply -f app.yaml\nkubectl rollout status deploy/app'
    await create(frame, 'SNP deploy', { body: deployBody, kind: 'shell', tags: ['Ops', 'Deploy'] })
    await expect(frame.getByRole('heading', { name: 'SNP deploy' })).toBeVisible()
    await expect(frame.getByTestId('snippet-kind')).toHaveText('Shell')
    await expect(frame.getByTestId('snippet-tag')).toHaveText(['ops', 'deploy'])
    const thanksBody = 'Dear Anna,\n\n  thank <b>you</b> for your patience.\n'
    await create(frame, 'SNP thanks', { body: thanksBody })
    await expect(items(frame)).toHaveCount(2)
    // the list shows the title, the kind and the first line of the body
    await expect(item(frame, 'SNP deploy')).toContainText('Shell')
    await expect(item(frame, 'SNP deploy')).toContainText('kubectl apply -f app.yaml')
    await expect(item(frame, 'SNP thanks')).toContainText('Text')
    await expect(item(frame, 'SNP thanks')).toContainText('Dear Anna,')
    await accessible(page, 'snippets list and detail')

    // SNP-03: search in the title, the body and the tags; a search with no result says so and clears
    const search = frame.getByRole('searchbox', { name: 'Search snippets' })
    await search.fill('rollout')
    await expect(items(frame)).toHaveText([/SNP deploy/])
    await search.fill('THANKS')
    await expect(items(frame)).toHaveText([/SNP thanks/])
    await search.fill('deploy')
    await expect(items(frame)).toHaveCount(1)
    await search.fill('zzzz-nothing')
    await expect(frame.getByTestId('empty-filtered')).toContainText('No snippet matches your search.')
    await frame.getByRole('button', { name: 'Clear filters' }).click()
    await expect(search).toHaveValue('')
    await expect(items(frame)).toHaveCount(2)

    // SNP-04: filter by kind
    const kind = frame.getByLabel('Filter by kind')
    await kind.selectOption('shell')
    await expect(items(frame)).toHaveText([/SNP deploy/])
    await kind.selectOption('sql')
    await expect(frame.getByTestId('empty-filtered')).toBeVisible()
    await kind.selectOption('')
    await expect(items(frame)).toHaveCount(2)

    // SNP-05: filter by tag; the chips count the snippets and a second press clears the filter
    const ops = frame.getByRole('button', { name: /^ops\s*1$/ })
    await expect(ops).toBeVisible()
    await ops.click()
    await expect(ops).toHaveAttribute('aria-pressed', 'true')
    await expect(items(frame)).toHaveText([/SNP deploy/])
    await ops.click()
    await expect(ops).toHaveAttribute('aria-pressed', 'false')
    await expect(items(frame)).toHaveCount(2)

    // SNP-06: selecting a snippet shows its body as written, line breaks and spaces kept, never as HTML
    await item(frame, 'SNP deploy').click()
    await expect(frame.getByRole('heading', { name: 'SNP deploy' })).toBeVisible()
    expect(await body(frame).evaluate((e) => e.textContent)).toBe(deployBody)
    await item(frame, 'SNP thanks').click()
    await expect(frame.getByRole('heading', { name: 'SNP thanks' })).toBeVisible()
    // only the line breaks at the very end are dropped by the rules of the plugin
    expect(await body(frame).evaluate((e) => e.textContent)).toBe('Dear Anna,\n\n  thank <b>you</b> for your patience.')
    await expect(body(frame).locator('b')).toHaveCount(0)
    await expect(frame.getByTestId('snippet-kind')).toHaveText('Text')
    await expect(frame.getByTestId('snippet-tag')).toHaveCount(0)
    // the arrow keys move through the list
    await item(frame, 'SNP thanks').focus()
    await item(frame, 'SNP thanks').press('ArrowUp')
    await expect(frame.getByRole('heading', { name: 'SNP deploy' })).toBeVisible()
    await item(frame, 'SNP deploy').press('ArrowDown')
    await expect(frame.getByRole('heading', { name: 'SNP thanks' })).toBeVisible()

    // SNP-07: Copy puts the body on the clipboard and says so
    await frame.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect(frame.locator('body')).toContainText('Copied')
    expect(await page.evaluate(() => navigator.clipboard.readText().then((t) => t.replace(/\r\n/g, '\n')))).toBe('Dear Anna,\n\n  thank <b>you</b> for your patience.')
    await item(frame, 'SNP deploy').click()
    await frame.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText().then((t) => t.replace(/\r\n/g, '\n')))).toBe(deployBody)

    // SNP-08: edit (title, kind, body and tags) and delete with a confirmation
    await item(frame, 'SNP thanks').click()
    await frame.getByRole('button', { name: 'Edit', exact: true }).click()
    const dlg = frame.getByRole('dialog')
    await expect(dlg).toContainText('Edit snippet')
    await dlg.getByRole('textbox', { name: 'Title', exact: true }).fill('SNP thanks v2')
    await dlg.getByLabel('Kind', { exact: true }).selectOption('markdown')
    const tagBox = dlg.locator('.msk-taginput input')
    await tagBox.fill('Mail')
    await tagBox.press('Enter')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(item(frame, 'SNP thanks v2')).toContainText('Markdown')
    await expect(frame.getByRole('heading', { name: 'SNP thanks v2' })).toBeVisible()
    await expect(frame.getByTestId('snippet-tag')).toHaveText(['mail'])
    await expect(frame.getByRole('button', { name: /^mail\s*1$/ })).toBeVisible()

    await frame.getByRole('button', { name: 'Delete', exact: true }).click()
    const sure = frame.getByRole('dialog')
    await expect(sure).toContainText('Delete the snippet “SNP thanks v2”?')
    await sure.getByRole('button', { name: 'Cancel' }).click()
    await expect(items(frame)).toHaveCount(2)
    await frame.getByRole('button', { name: 'Delete', exact: true }).click()
    await frame.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(items(frame)).toHaveCount(1)
    await expect(item(frame, 'SNP thanks v2')).toHaveCount(0)
    await item(frame, 'SNP deploy').click()
    await frame.getByRole('button', { name: 'Delete', exact: true }).click()
    await frame.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(frame.getByTestId('empty-state')).toBeVisible()
  })
})
