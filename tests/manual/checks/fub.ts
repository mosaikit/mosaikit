// Follow-ups B — tabs of an extension, one item from a backup
// Converted from the QA walkthrough; one entry per check id of docs/manual-tests.md.
import * as H from '../h.ts'
import * as L from '../lib.ts'


async function reviewFrame(p: any) {
  for (let i = 0; i < 20; i++) {
    const f = p.frames().find((x) => /note-review\/tab\.html/.test(x.url()))
    if (f) {
      await p.waitForTimeout(800)
      return f
    }
    await p.waitForTimeout(400)
  }
  throw new Error('no Review frame')
}
async function openReview(p: any, title: any) {
  const f = await H.openNote(p, title)
  await f.getByRole('tab', { name: /Review|Revisione/ }).click()
  await p.waitForTimeout(1500)
  return { f, r: await reviewFrame(p) }
}
async function restoreDialog(p: any, title: any) {
  await p.keyboard.press('Escape')
  await p.keyboard.press('Escape')
  await p.reload()
  await H.go(p, '#/admin/system/backup')
  await p.getByRole('button', { name: /Restore an item/ }).first().click()
  await p.waitForTimeout(1000)
  const d = p.getByRole('dialog')
  await d.getByRole('combobox', { name: 'Tenant' }).selectOption({ label: 'Comune di Roma' })
  await d.getByRole('textbox', { name: 'Title' }).fill(title)
  await d.getByRole('button', { name: 'Search' }).click()
  await p.waitForTimeout(1500)
  return d
}

const checks: L.Check[] = [
  {
    id: 'FU-B-01',
    async run(ctx: any) {
      await L.ensureOn('com.mosaikit.notes', 'com.mosaikit.note-review')
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma')
      const side = (await m.locator('[data-sidebar="sidebar"]').getByRole('link').allInnerTexts()).map((s) => s.trim())
      c.ok(!side.includes('Note review'), 'not in the sidebar')
      c.ok(!(await H.vis(m.getByRole('button', { name: /^Note review/ }))), 'not among the apps of the Home')
      await L.shot(m, 'FU-B-01', { full: true })
      return c.result()
    },
  },
  {
    id: 'FU-B-02',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      const f = await H.openNote(m, 'Budget 2027')
      c.ok(await H.vis(f.getByRole('tab', { name: 'Detail' })) && (await H.vis(f.getByRole('tab', { name: 'Review' }))), 'tabs Detail and Review')
      c.ok(/Reviewed/i.test((await f.getByRole('columnheader').allInnerTexts()).join(' ')), 'the columns')
      c.ok(await H.vis(f.getByRole('group', { name: 'Note review' })), 'the fieldset of Note review')
      await L.shot(m, 'FU-B-02')
      return c.result()
    },
  },
  {
    id: 'FU-B-03',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      const { r } = await openReview(m, 'Budget 2027')
      const t = await r.locator('body').innerText()
      c.ok(/Review of «Budget 2027»/.test(t), '«Review of «title»»')
      c.ok(/Not reviewed yet|Reviewed by/.test(t), '«Not reviewed yet»')
      c.ok(await H.vis(r.getByRole('textbox', { name: /Comment/ })), 'a comment field')
      c.ok(await H.vis(r.getByRole('button', { name: 'Mark as reviewed' })), 'Mark as reviewed')
      c.ok(/History of the reviews/.test(t), 'the history')
      await L.shot(m, 'FU-B-03')
      return c.result()
    },
  },
  {
    id: 'FU-B-04',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      const { f, r } = await openReview(m, 'Budget 2027')
      await r.getByRole('textbox', { name: /Comment/ }).fill('Numbers checked')
      await r.getByRole('button', { name: 'Mark as reviewed' }).click()
      await m.waitForTimeout(1800)
      const t = await r.locator('body').innerText()
      c.ok(/Reviewed by Elena Ricci/.test(t), '«Reviewed by Elena Ricci»')
      c.ok(/Numbers checked/.test(t) && /\d/.test(t), 'the comment in the history with the date')
      const row = await f.getByRole('row', { name: /Budget 2027/ }).innerText()
      c.ok(/✓|Yes|yes/.test(row), `the column Reviewed ✓ at once («${row.replace(/\s+/g, ' ')}»)`)
      await L.shot(m, 'FU-B-04')
      return c.result()
    },
  },
  {
    id: 'FU-B-05',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await openReview(m, 'Budget 2027')
      const box = async () => {
        const el = await m.locator('iframe[src*="note-review"]').boundingBox()
        const pf = await m.locator('iframe[src*="com.mosaikit.notes"]').boundingBox()
        return { el, pf }
      }
      await m.mouse.wheel(0, 400)
      await m.waitForTimeout(800)
      const b1 = await box()
      c.ok(b1.el && b1.pf && b1.el.x >= b1.pf.x && b1.el.x + b1.el.width <= b1.pf.x + b1.pf.width + 1, 'after scrolling the tab stays inside the plugin frame')
      await L.shot(m, 'FU-B-05-scroll')
      await m.setViewportSize({ width: 900, height: 820 })
      await m.waitForTimeout(1200)
      const b2 = await box()
      c.ok(b2.el && b2.pf && b2.el.x + b2.el.width <= b2.pf.x + b2.pf.width + 1, 'narrower window: no overflow')
      const scroll = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      c.ok(!scroll, 'no horizontal scroll')
      await L.shot(m, 'FU-B-05-narrow')
      await m.setViewportSize({ width: 1280, height: 860 })
      return c.result()
    },
  },
  {
    id: 'FU-B-06',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      const f = await H.openNote(m, 'Budget 2027')
      await f.getByRole('tab', { name: 'Detail' }).focus()
      await m.keyboard.press('ArrowRight')
      await m.waitForTimeout(1200)
      c.ok((await f.getByRole('tab', { name: 'Review' }).getAttribute('aria-selected')) === 'true', 'ArrowRight moves to Review')
      await m.keyboard.press('ArrowLeft')
      await m.waitForTimeout(1200)
      c.ok((await f.getByRole('tab', { name: 'Detail' }).getAttribute('aria-selected')) === 'true', 'ArrowLeft back to Detail')
      const vis = await m.locator('iframe[src*="note-review"]').isVisible().catch(() => false)
      c.ok(!vis, 'on Detail the tab closes')
      c.ok(await H.vis(f.getByRole('textbox', { name: 'Title *' })), 'the fields come back')
      await L.shot(m, 'FU-B-06')
      return c.result()
    },
  },
  {
    id: 'FU-B-07',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      const f = await H.openNote(m, 'Budget 2027')
      await f.getByRole('button', { name: 'Share…' }).click()
      const d = m.getByRole('dialog', { name: 'Sharing' })
      const shared = /Sara Greco/.test(await d.innerText())
      if (!shared) {
        await d.getByRole('searchbox', { name: /Search people or groups/ }).fill('Sara')
        await m.waitForTimeout(800)
        await m.getByRole('option', { name: /Sara Greco/ }).first().click()
        await d.getByRole('button', { name: 'Share', exact: true }).click()
        await m.waitForTimeout(1000)
      }
      await m.keyboard.press('Escape')
      const u = await L.as(ctx, 's.greco')
      const { r } = await openReview(u, 'Budget 2027')
      const t = await r.locator('body').innerText()
      c.ok(/Numbers checked/.test(t), 'the history is there')
      c.ok(!(await H.vis(r.getByRole('textbox', { name: /Comment/ }))) && !(await H.vis(r.getByRole('button', { name: 'Mark as reviewed' }))), 'no comment field and no button')
      c.ok(/only who can edit the note reviews it/i.test(t), '«only who can edit the note reviews it»')
      await L.shot(u, 'FU-B-07')
      return c.result()
    },
  },
  {
    id: 'FU-B-08',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 'e.ricci', 'it')
      await H.go(u, '#/t/comune-roma')
      await H.nav(u, 'Note')
      const f = await L.pluginFrame(u, 'notes')
      await f.getByRole('row', { name: /Budget 2027/ }).first().click()
      await u.waitForTimeout(1000)
      await f.getByRole('tab', { name: /Revisione/ }).click()
      await u.waitForTimeout(1500)
      const r = await reviewFrame(u)
      const t = await r.locator('body').innerText()
      c.ok(/Revisione/.test(t), 'tab in Italian')
      await L.shot(u, 'FU-B-08-it')
      const d = await L.page(ctx.b, { colorScheme: 'dark' })
      await L.login(d, 'Comune di Roma', 'e.ricci')
      const { r: rd } = await openReview(d, 'Budget 2027')
      const bg = await rd.evaluate(() => getComputedStyle(document.body).backgroundColor)
      c.ok(!/255, 255, 255/.test(bg), `dark colours of the shell in the tab (${bg})`)
      await L.shot(d, 'FU-B-08-dark')
      await d.context().close()
      return c.result('high contrast not toggled in this check')
    },
  },
  {
    id: 'FU-B-09',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/backup')
      await p.getByRole('button', { name: /Run now/ }).click()
      for (let i = 0; i < 60; i++) {
        await p.waitForTimeout(3000)
        if (!/running/i.test(await H.text(p))) break
      }
      c.ok(/complete/i.test(await H.text(p)), 'backup listed')
      const m = await L.as(ctx, 'e.ricci')
      const f = await H.openNote(m, 'Budget 2027')
      await f.getByRole('button', { name: 'Delete' }).click()
      await m.waitForTimeout(600)
      const cf = m.getByRole('alertdialog').or(m.getByRole('dialog'))
      if (await H.vis(cf)) await cf.getByRole('button', { name: /Delete|Confirm/ }).last().click()
      await m.waitForTimeout(1200)
      await H.go(m, '#/t/comune-roma/trash')
      await m.getByRole('row', { name: /Budget 2027/ }).getByRole('button', { name: /Delete for good|Delete/ }).click()
      await m.waitForTimeout(500)
      const cf2 = m.getByRole('alertdialog').or(m.getByRole('dialog'))
      if (await H.vis(cf2)) await cf2.getByRole('button', { name: /Delete|Confirm/ }).last().click()
      await m.waitForTimeout(1200)
      c.ok(!(await H.vis(m.getByRole('row', { name: /Budget 2027/ }))), 'note deleted for good')
      await L.shot(p, 'FU-B-09')
      return c.result('deleted for good from the Trash (only that item) instead of emptying the whole trash of the tenant')
    },
  },
  {
    id: 'FU-B-10',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const d = await restoreDialog(p, 'Budget 2027')
      const t = await d.innerText()
      c.ok(/Budget 2027/.test(t), 'the note')
      c.ok(/Elena Ricci/.test(t), 'its owner')
      c.ok(/No longer in the tenant/.test(t), '«No longer in the tenant»')
      await L.shot(p, 'FU-B-10')
      return c.result()
    },
  },
  {
    id: 'FU-B-11',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const d = p.getByRole('dialog')
      await d.getByRole('row', { name: /Budget 2027/ }).getByRole('button', { name: /Restore/ }).click().catch(async () => d.getByRole('button', { name: /^Restore$/ }).first().click())
      await p.waitForTimeout(800)
      const last = p.getByRole('dialog').last()
      if (await H.vis(last.getByRole('button', { name: /^Restore$/ }))) await last.getByRole('button', { name: /^Restore$/ }).click()
      await p.waitForTimeout(2000)
      const t = (await H.toast(p)) + ' ' + (await p.getByRole('dialog').first().innerText().catch(() => ''))
      c.ok(/«Budget 2027» restored/.test(t), '««title» restored»')
      c.ok(/In the tenant/.test(t), 'the state becomes «In the tenant»')
      await L.shot(p, 'FU-B-11-admin')
      await p.keyboard.press('Escape')
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma')
      await m.getByRole('button', { name: /^Notifications/ }).first().click()
      await m.waitForTimeout(800)
      const bt = await m.getByRole('dialog').first().innerText().catch(() => '')
      await H.closeMenus(m)
      c.ok(/Budget 2027/.test(bt) && /restor/i.test(bt), `notification to e.ricci («${bt.replace(/\s+/g, ' ').slice(0, 160)}»)`)
      const { r } = await openReview(m, 'Budget 2027')
      c.ok(/Numbers checked/.test(await r.locator('body').innerText()), 'the note with its review history')
      await L.shot(m, 'FU-B-11')
      return c.result()
    },
  },
  {
    id: 'FU-B-12',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const d = await restoreDialog(p, 'Budget 2027')
      c.ok(/In the tenant/.test(await d.innerText()), 'still in the tenant')
      await d.getByRole('button', { name: /Restore «Budget 2027»/ }).first().click()
      await p.waitForTimeout(1200)
      const t = await p.locator('body').innerText()
      c.ok(/As a copy/.test(t), '«As a copy»')
      c.ok(/In place of the current one/.test(t), '«In place of the current one» (red)')
      await L.shot(p, 'FU-B-12')
      const copy = p.getByRole('button', { name: /As a copy/ })
      if (await H.vis(copy)) await copy.click()
      await p.waitForTimeout(2000)
      await p.keyboard.press('Escape')
      await p.keyboard.press('Escape')
      return c.result('restored «As a copy»')
    },
  },
  {
    id: 'FU-B-13',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const d = await restoreDialog(p, 'QA folder')
      const t = await d.innerText()
      c.ok(/QA folder/.test(t), 'the folder is in the backup')
      await L.shot(p, 'FU-B-13')
      await p.keyboard.press('Escape')
      return { status: c.result().status === 'PASS' ? 'NOT VERIFIABLE' : 'FAIL', note: `the folder of P5-14 is found in the backup (${/In the tenant/.test(t) ? 'In the tenant' : 'state shown'}); restoring it after a deletion for good, and a file without its folder, were not exercised` }
    },
  },
  {
    id: 'FU-B-14',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const d = await restoreDialog(p, 'Budget 2027')
      const t = await d.innerText()
      c.ok(/Also its shares/.test(t), '«Also its shares…»')
      await L.shot(p, 'FU-B-14')
      await p.keyboard.press('Escape')
      return { status: c.result().status === 'PASS' ? 'NOT VERIFIABLE' : 'FAIL', note: 'the option exists; restoring with the shares of people and groups that still exist was not exercised end to end' }
    },
  },
]

export default checks
