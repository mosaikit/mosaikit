import { expect, test, type Page } from '@playwright/test'
import { PASSWORD, login } from './support'

// The Schedules page of the shell (docs/manual-tests.md, SCH-03). No official plugin offers a schedule yet, so the list of the
// tenant is answered here and the calls the page makes (pause, delete) are recorded: the spec checks the page and its rules, the
// kernel is covered by its own tests (`schedules`, `schedule_worker`).

interface Row {
  id: string
  plugin: string
  name: string
  label: string
  author: string
  author_name: string
  cron: string
  time_zone: string
  status: 'active' | 'paused'
  paused_reason: string | null
  next_run_at: string | null
  last_run_at: string | null
  last_status: string | null
}
const row = (id: string, label: string): Row => ({
  id,
  plugin: 'com.mosaikit.notes',
  name: 'sync',
  label,
  author: 'u1',
  author_name: 'Mario Rossi',
  cron: '0 9 * * *',
  time_zone: 'Europe/Rome',
  status: 'active',
  paused_reason: null,
  next_run_at: '2030-01-02T08:00:00Z',
  last_run_at: null,
  last_status: null,
})

async function fakeSchedules(page: Page, rows: Row[]) {
  const calls: string[] = []
  await page.route(/\/api\/t\/[^/]+\/schedules(\/[^?]*)?(\?.*)?$/, async (route) => {
    const req = route.request()
    const u = new URL(req.url())
    const m = /\/schedules\/([^/]+)(?:\/(pause|resume|run))?$/.exec(u.pathname)
    if (req.method() === 'GET' && !m) return route.fulfill({ json: rows })
    if (!m) return route.continue()
    calls.push(`${req.method()} ${m[1]}${m[2] ? ' ' + m[2] : ''}`)
    const r = rows.find((x) => x.id === m[1])
    if (req.method() === 'DELETE') rows.splice(rows.indexOf(r!), 1)
    else if (m[2] === 'pause') Object.assign(r!, { status: 'paused', paused_reason: 'manager' })
    else if (m[2] === 'resume') Object.assign(r!, { status: 'active', paused_reason: null })
    return route.fulfill({ json: {} })
  })
  return calls
}

test.describe.serial('21-schedules-page', () => {
  test('Tenant Manager: sees the schedules of the tenant, pauses one and deletes one', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    const slug = new URL(page.url()).hash.match(/#\/t\/([^/]+)/)![1]
    const calls = await fakeSchedules(page, [row('s1', 'Morning sync'), row('s2', 'Weekly digest')])
    await page.goto(`./#/t/${slug}/schedules`)
    await expect(page.getByRole('heading', { name: 'Schedules' })).toBeVisible()
    const line = (name: string) => page.getByRole('row', { name: new RegExp(name) })
    await expect(line('Morning sync')).toBeVisible()
    await expect(line('Weekly digest')).toBeVisible()
    await expect(line('Morning sync')).toContainText('Mario Rossi')
    await expect(line('Morning sync')).toContainText('Active')

    // pause: the row says who stopped it and offers to resume
    await line('Morning sync').getByRole('button', { name: 'Pause' }).click()
    await expect(line('Morning sync')).toContainText('Paused by a manager')
    await expect(line('Morning sync').getByRole('button', { name: 'Resume' })).toBeVisible()
    expect(calls).toContain('POST s1 pause')

    // delete asks first; cancelling keeps the row, confirming removes it
    await line('Weekly digest').getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(line('Weekly digest')).toBeVisible()
    await line('Weekly digest').getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click()
    await expect(line('Weekly digest')).toHaveCount(0)
    expect(calls).toContain('DELETE s2')
    await expect(line('Morning sync')).toBeVisible()
  })

  test('a plain member does not get the page', async ({ page }) => {
    await login(page, 'Alfa', 'manager', PASSWORD)
    const slug = new URL(page.url()).hash.match(/#\/t\/([^/]+)/)![1]
    const made = await page.evaluate(async (s) => {
      const sess = await (await fetch('api/session')).json()
      const r = await fetch(`api/t/${s}/manage/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': sess.csrf },
        body: JSON.stringify({ username: 'schm', display_name: 'Sched Member', email: 'schm@alfa.example.org', password: 'password-e2e-123', role: 'user' }),
      })
      return r.status
    }, slug)
    expect([200, 201, 409]).toContain(made)
    await page.context().clearCookies()
    await login(page, 'Alfa', 'schm', PASSWORD)
    let asked = 0
    await page.route(/\/api\/t\/[^/]+\/schedules/, (route) => {
      asked++
      return route.continue()
    })
    await page.goto(`./#/t/${slug}/schedules`)
    await expect(page.getByText('Reserved to Tenant Managers')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Schedules' })).toHaveCount(0)
    // the page does not even ask for the list; the entry is not in the sidebar either
    expect(asked).toBe(0)
    await expect(page.locator('[data-sidebar="sidebar"]').getByRole('link', { name: 'Schedules' })).toHaveCount(0)
    // (the API itself lists to a member only the schedules the member set up: the kernel tests `schedules` cover the rules)
  })
})
