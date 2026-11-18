import { expect, test } from '@playwright/test'
import { BASE, PASSWORD, login, nav } from './support'

// Actions on a share (docs/manual-tests.md, SH18-01): a grant lists actions the plugin declared for the type of the
// item. The notes plugin declares none, so a named action is refused, a plain grant is kept and lists no action.

test.describe.serial('Share actions', () => {
  test('an action the plugin does not declare is refused; a plain grant lists none', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await login(page, 'Alfa', 'manager', PASSWORD)
    await nav(page, 'Notes').click()
    const frame = page.frameLocator('iframe.plugin-frame')
    await frame.getByRole('button', { name: /New/ }).first().click()
    await frame.locator('[data-key="title"]').fill('Share actions')
    await frame.getByRole('button', { name: 'Save' }).click()

    const out = await page.evaluate(async ([base, title]) => {
      const s = await (await fetch(`${base}/api/session`)).json()
      const headers = { 'content-type': 'application/json', 'x-csrf-token': s.csrf }
      const notes = await (await fetch(`${base}/api/t/alfa/p/com.mosaikit.notes/r/notes`)).json()
      const note = notes.rows.find((r: { values: { title: string } }) => r.values.title === title)
      const members = await (await fetch(`${base}/api/t/alfa/manage/members`)).json()
      const anna = (Array.isArray(members) ? members : members.members).find((m: { username: string }) => m.username !== 'manager')
      const url = `${base}/api/t/alfa/resources/${note.id}/grants`
      const who = { principal_type: 'user', principal_id: anna.user_id ?? anna.id, level: 'read' }
      const bad = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ ...who, actions: ['download'] }) })
      const ok = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(who) })
      const list = await (await fetch(url)).json()
      return { bad: bad.status, ok: ok.status, actions: list.grants.map((g: { actions: string[] }) => g.actions) }
    }, [BASE, 'Share actions'] as const)
    expect(out.bad).toBe(400)
    expect(out.ok).toBe(200)
    expect(out.actions.every((a: string[]) => a.length === 0)).toBe(true)
    await ctx.close()
  })
})
