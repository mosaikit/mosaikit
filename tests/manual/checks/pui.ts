// Layout of Contacts, Tasks and Notes: cards, list and board next to a detail panel, pinned header, phone
import * as H from '../h.ts'
import * as L from '../lib.ts'

const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)

async function open(p: any, app: string, part: string) {
  await L.ensureOn('com.mosaikit.' + part)
  await H.go(p, '#/t/comune-roma')
  await p.reload()
  await p.waitForTimeout(1500)
  await H.nav(p, app)
  return L.pluginFrame(p, part)
}

async function add(f: any, values: Record<string, string | boolean>) {
  await f.getByRole('button', { name: /^＋ New/ }).click()
  for (const [k, v] of Object.entries(values)) {
    const el = f.locator(`[data-key="${k}"]`).first()
    if (typeof v === 'boolean') await (v ? el.check() : el.uncheck())
    else if (['priority', 'tag', 'company'].includes(k)) await el.selectOption(v)
    else await el.fill(v)
  }
  await f.getByRole('button', { name: 'Save' }).click()
}

/** No sideways scroll and the header of the plugin at the top of the frame. */
async function pinned(f: any): Promise<boolean> {
  return f.locator('html').evaluate((h: HTMLElement) => h.scrollWidth <= h.clientWidth && Math.round(document.querySelector('.msk-pagehead')!.getBoundingClientRect().top) === 0)
}

const checks: L.Check[] = [
  {
    id: 'PUI-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      const f = await open(p, 'Contacts', 'contacts')
      await add(f, { name: 'PUI Ada Lovelace', email: 'ada@example.org', company: 'Customer' })
      await p.waitForTimeout(1200)
      const card = f.locator('.msk-item').filter({ hasText: 'PUI Ada Lovelace' })
      c.ok((await card.locator('.msk-avatar').innerText()) === 'PL', 'the card has the initials in a circle')
      c.ok(/Customer/.test(await card.innerText()), 'the kind of company is a chip')
      c.ok(await H.vis(f.locator('.contact-read a[href^="mailto:"]')), 'the reading panel shows the address as a link')
      await f.getByRole('button', { name: 'Edit' }).click()
      c.ok(await H.vis(f.locator('[data-key="name"]')), 'Edit shows the form')
      await f.getByRole('button', { name: 'Cancel' }).click()
      c.ok(await H.vis(f.locator('.contact-read')), 'Cancel goes back to reading')
      c.ok(await pinned(f), 'the header is pinned and nothing scrolls sideways')
      await L.shot(p, 'PUI-01')
      return c.result()
    },
  },
  {
    id: 'PUI-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      const f = await open(p, 'Tasks', 'tasks')
      await add(f, { title: 'PUI overdue', due: day(-3), priority: 'high' })
      await add(f, { title: 'PUI next week', due: day(7), priority: 'medium' })
      await p.waitForTimeout(1200)
      c.ok(await H.vis(f.locator('.msk-item').filter({ hasText: 'PUI overdue' }).locator('.tdue.late')), 'the overdue date is marked')
      c.ok(await H.vis(f.locator('.msk-item').filter({ hasText: 'PUI overdue' }).locator('.msk-chip')), 'the priority is a chip')
      await f.getByRole('button', { name: 'Board' }).click()
      c.ok((await f.locator('.msk-col').count()) === 3, 'the board has Overdue, Open and Done')
      await f.getByRole('checkbox', { name: 'Mark as done: PUI overdue' }).check()
      await p.waitForTimeout(1500)
      c.ok(await H.vis(f.locator('.msk-col').filter({ hasText: 'Done' }).locator('.msk-item').filter({ hasText: 'PUI overdue' })), 'the ticked task moves to Done')
      await p.reload()
      const g = await L.pluginFrame(p, 'tasks')
      c.ok((await g.getByRole('button', { name: 'Board' }).getAttribute('aria-pressed')) === 'true', 'the view is kept after a reload')
      await g.getByRole('button', { name: 'List' }).click()
      await L.shot(p, 'PUI-02')
      return c.result()
    },
  },
  {
    id: 'PUI-03',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      const f = await open(p, 'Notes', 'notes')
      await add(f, { title: 'PUI plan', body: 'Monday: kickoff\nTuesday: review', tag: 'work' })
      await p.waitForTimeout(1200)
      const card = f.locator('.msk-item').filter({ hasText: 'PUI plan' })
      c.ok(/work/.test(await card.innerText()) && /kickoff/.test(await card.innerText()), 'the card has the tag and the first lines')
      c.ok(/Tuesday: review/.test(await f.locator('.nread').innerText()), 'the note is read in the panel')
      await f.getByRole('button', { name: 'Edit' }).click()
      await f.locator('[data-key="title"]').fill('PUI plan v2')
      await f.getByRole('button', { name: 'Save' }).click()
      await p.waitForTimeout(1200)
      c.ok((await f.locator('.note-read h2').innerText()) === 'PUI plan v2', 'Save shows the note again, read')
      c.ok(await H.vis(f.getByRole('button', { name: 'Share…' })), 'Share is there')
      await L.shot(p, 'PUI-03')
      return c.result()
    },
  },
  {
    id: 'PUI-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      await p.setViewportSize({ width: 390, height: 800 })
      for (const mode of ['light', 'dark']) {
        await p.evaluate((m: string) => localStorage.setItem('msk_mode', m), mode)
        for (const [app, part] of [['Contacts', 'contacts'], ['Tasks', 'tasks'], ['Notes', 'notes']]) {
          await H.go(p, '#/t/comune-roma')
          await p.reload()
          await p.waitForTimeout(1200)
          await p.getByRole('link', { name: app, exact: true }).first().click()
          const f = await L.pluginFrame(p, part)
          c.ok(await pinned(f), `${app} (${mode}): header pinned, nothing scrolls sideways`)
          c.ok(!(await H.vis(f.locator('.msk-detail'))), `${app} (${mode}): the list alone`)
          await f.locator('.msk-item').first().click()
          await p.waitForTimeout(500)
          c.ok(await H.vis(f.locator('.msk-detail')), `${app} (${mode}): the detail covers the list`)
          await f.locator('.msk-detail').press('Escape')
          c.ok(!(await H.vis(f.locator('.msk-detail'))), `${app} (${mode}): Escape goes back to the list`)
          if (app === 'Notes') await L.shot(p, `PUI-04-${mode}`)
        }
      }
      await p.evaluate(() => localStorage.setItem('msk_mode', 'light'))
      await p.setViewportSize({ width: 1440, height: 900 })
      return c.result()
    },
  },
]

export default checks
