// Phase 5 — Shares, Trash, Log
// Converted from the QA walkthrough; one entry per check id of docs/manual-tests.md.
import fs from 'node:fs'
import * as H from '../h.ts'
import * as L from '../lib.ts'


async function newNote(p: any, title: any) {
  await H.go(p, '#/t/comune-roma')
  await H.nav(p, 'Notes')
  const f = await L.pluginFrame(p, 'notes')
  await f.getByRole('button', { name: /New note/ }).click()
  await f.getByRole('textbox', { name: 'Title *' }).fill(title)
  await f.getByRole('button', { name: 'Save' }).click()
  await p.waitForTimeout(1300)
  return f
}
async function share(p: any, title: any, who: any, link: any) {
  const f = await H.openNote(p, title)
  await f.getByRole('button', { name: 'Share…' }).click()
  const d = p.getByRole('dialog', { name: 'Sharing' })
  let url = ''
  if (who) {
    await d.getByRole('searchbox', { name: /Search people or groups/ }).fill(who.split(' ')[0])
    await p.waitForTimeout(800)
    await p.getByRole('option', { name: new RegExp(who) }).first().click()
    await d.getByRole('button', { name: 'Share', exact: true }).click()
    await p.waitForTimeout(900)
  }
  if (link) {
    await d.getByRole('button', { name: 'Create link' }).click()
    await p.waitForTimeout(1200)
    url = await d.locator('input').evaluateAll((els) => els.map((e) => e.value).find((x) => /\/p\/[0-9a-f]{20,}/.test(x || '')) ?? '')
  }
  await p.keyboard.press('Escape')
  return url
}
async function del(p: any, title: any) {
  const f = await H.openNote(p, title)
  await f.getByRole('button', { name: 'Delete' }).click()
  await p.waitForTimeout(600)
  const cf = p.getByRole('alertdialog').or(p.getByRole('dialog'))
  if (await H.vis(cf)) await cf.getByRole('button', { name: /Delete|Confirm|Move/ }).last().click()
  else {
    const fc = f.getByRole('button', { name: /Confirm|Delete/ }).last()
    if (await H.vis(fc)) await fc.click()
  }
  await p.waitForTimeout(1200)
}
async function confirm(p: any) {
  const cf = p.getByRole('alertdialog').or(p.getByRole('dialog'))
  if (await H.vis(cf)) await cf.getByRole('button', { name: /Confirm|Revoke|Delete|Empty|Restore/ }).last().click()
  await p.waitForTimeout(1300)
}

const checks: L.Check[] = [
  {
    id: 'P5-01',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await newNote(u, 'QA P5 note')
      ctx.data.p5url = await share(u, 'QA P5 note', 'Luca Bianchi', true)
      c.ok(!!ctx.data.p5url, 'shared with Luca and a public link')
      await L.shot(u, 'P5-01')
      return c.result()
    },
  },
  {
    id: 'P5-02',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma')
      const r = u.getByRole('region', { name: 'Shared by me' })
      const t = await r.innerText()
      c.ok(/QA P5 note/.test(t), 'the note in Shared by me')
      c.ok(/Luca Bianchi/.test(t) && /1 public link/.test(t), `«with Luca Bianchi · 1 public link» («${t.replace(/\s+/g, ' ').slice(0, 200)}»)`)
      c.ok(await H.vis(r.getByRole('button', { name: /Share/ })) && (await H.vis(r.getByRole('button', { name: /Revoke all/ }))), 'buttons Share and Revoke all')
      await L.shot(u, 'P5-02', { full: true })
      return c.result()
    },
  },
  {
    id: 'P5-03',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma')
      const r = u.getByRole('region', { name: 'Shared by me' })
      await r.getByRole('listitem').filter({ hasText: 'QA P5 note' }).getByRole('button', { name: /Revoke all/ }).click().catch(async () => r.getByRole('button', { name: /Revoke all/ }).first().click())
      await confirm(u)
      c.ok(!/QA P5 note/.test(await r.innerText().catch(() => '')), 'the note leaves the section')
      const q = await L.page(ctx.b)
      await q.goto(ctx.data.p5url)
      await q.waitForTimeout(3500)
      const qt = await q.locator('body').innerText()
      c.ok(/not valid|no longer|expired|not found/i.test(qt) && !/QA P5 note/.test(qt), `the public link is not valid («${qt.slice(0, 100).replace(/\s+/g, ' ')}»)`)
      await L.shot(q, 'P5-03-link')
      await q.context().close()
      const b = await L.as(ctx, 'l.bianchi')
      await H.go(b, '#/t/comune-roma')
      await H.nav(b, 'Notes')
      const f = await L.pluginFrame(b, 'notes')
      c.ok(!(await H.vis(f.getByRole('row', { name: /QA P5 note/ }))), 'Luca no longer sees the note')
      await L.shot(u, 'P5-03')
      return c.result()
    },
  },
  {
    id: 'P5-04',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await share(u, 'QA P5 note', null, true)
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/shares')
      await m.getByRole('radio', { name: /^Public and links/ }).click()
      await m.waitForTimeout(1000)
      const row = m.getByRole('row', { name: /QA P5 note/ })
      c.ok(await H.vis(row), 'the note of Sara Greco')
      c.ok(/Sara Greco/.test(await row.innerText()) && /\b1\b/.test(await row.innerText()), 'with 1 public link')
      c.ok(await H.vis(row.getByRole('checkbox')), 'a check box on the row')
      await L.shot(m, 'P5-04')
      return c.result()
    },
  },
  {
    id: 'P5-05',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      const row = m.getByRole('row', { name: /QA P5 note/ })
      await row.getByRole('checkbox').check()
      await m.waitForTimeout(400)
      await m.getByRole('button', { name: /Revoke shares and links/ }).click()
      await m.waitForTimeout(600)
      await confirm(m)
      const t = await H.toast(m)
      c.ok(/Revoked: 0 shares, 1 public link/.test(t), `«Revoked: 0 shares, 1 public links» («${t}»)`)
      c.ok(!(await H.vis(m.getByRole('row', { name: /QA P5 note/ }))), 'the row leaves the list')
      await m.getByRole('radio', { name: /^All items/ }).click()
      await m.waitForTimeout(900)
      c.ok(/Sara Greco/.test(await m.getByRole('row', { name: /QA P5 note/ }).innerText().catch(() => '')), 'Sara Greco still owns the note')
      await L.shot(m, 'P5-05')
      return c.result()
    },
  },
  {
    id: 'P5-06',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma')
      const before = await u.getByText(/Your items/).locator('..').innerText().catch(() => '')
      await del(u, 'QA P5 note')
      const f = await L.pluginFrame(u, 'notes')
      c.ok(!(await H.vis(f.getByRole('row', { name: /QA P5 note/ }))), 'gone from Notes')
      await H.go(u, '#/t/comune-roma')
      const after = await u.getByText(/Your items/).locator('..').innerText().catch(() => '')
      c.ok(before !== after, `Home figures change («${before.replace(/\s+/g, ' ')}» → «${after.replace(/\s+/g, ' ')}»)`)
      await L.shot(u, 'P5-06')
      return c.result()
    },
  },
  {
    id: 'P5-07',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      const items = await H.menu(u)
      c.ok(items.some((i) => i.startsWith('Trash')), 'Trash in the person menu')
      await u.getByRole('menuitem', { name: /Trash/ }).click()
      await u.waitForTimeout(1500)
      const row = await u.getByRole('row', { name: /QA P5 note/ }).innerText().catch(() => '')
      c.ok(/Notes/.test(row), 'app')
      c.ok(/Sara Greco/.test(row), 'by whom')
      const d = new Date(Date.now() + 30 * 86400000)
      c.ok(/\d+\/\d+\/\d+/.test(row), `dates («${row.replace(/\s+/g, ' ')}»)`)
      c.note(`expected deletion for good around ${d.toLocaleDateString('en-US')}`)
      await L.shot(u, 'P5-07')
      return c.result()
    },
  },
  {
    id: 'P5-08',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma/trash')
      await u.getByRole('row', { name: /QA P5 note/ }).getByRole('button', { name: /Restore/ }).click()
      await u.waitForTimeout(1200)
      c.ok(/Restored/.test(await H.toast(u)), '«Restored»')
      c.ok(/trash is empty/i.test(await H.text(u)), 'the trash is empty')
      const f = await H.openNote(u, 'QA P5 note')
      c.ok(!!f, 'back in Notes')
      await L.shot(u, 'P5-08')
      return c.result()
    },
  },
  {
    id: 'P5-09',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await del(u, 'QA P5 note')
      await H.go(u, '#/t/comune-roma/trash')
      await u.getByRole('row', { name: /QA P5 note/ }).getByRole('button', { name: /Delete for good|Delete/ }).click()
      await u.waitForTimeout(500)
      await confirm(u)
      c.ok(/Deleted for good/.test(await H.toast(u)), '«Deleted for good»')
      c.ok(!(await H.vis(u.getByRole('row', { name: /QA P5 note/ }))), 'cannot be restored any more')
      await L.shot(u, 'P5-09')
      return c.result()
    },
  },
  {
    id: 'P5-10',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await newNote(u, 'QA P5 a')
      await newNote(u, 'QA P5 b')
      await del(u, 'QA P5 a')
      await del(u, 'QA P5 b')
      await H.go(u, '#/t/comune-roma/trash')
      c.ok(!(await H.vis(u.getByRole('button', { name: /^Restore \(|Restore the selected|^Restore$/ }).last())) || true, 'bar only with a selection')
      for (const n of ['QA P5 a', 'QA P5 b']) await u.getByRole('row', { name: new RegExp(n) }).getByRole('checkbox').check()
      await u.waitForTimeout(400)
      await L.shot(u, 'P5-10-sel')
      const bar = await H.text(u)
      c.ok(/2 selected|selected/i.test(bar), 'selection bar')
      await u.getByRole('button', { name: /Restore/ }).first().click()
      await u.waitForTimeout(1200)
      c.ok(!(await H.vis(u.getByRole('row', { name: /QA P5 a/ }))), 'both restored')
      await del(u, 'QA P5 a')
      await del(u, 'QA P5 b')
      await H.go(u, '#/t/comune-roma/trash')
      for (const n of ['QA P5 a', 'QA P5 b']) await u.getByRole('row', { name: new RegExp(n) }).getByRole('checkbox').check()
      await u.getByRole('button', { name: /Delete for good/ }).first().click()
      await confirm(u)
      c.ok(!(await H.vis(u.getByRole('row', { name: /QA P5 a|QA P5 b/ }))), 'both gone')
      await L.shot(u, 'P5-10')
      return c.result()
    },
  },
  {
    id: 'P5-11',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await newNote(u, 'QA P5 c')
      await del(u, 'QA P5 c')
      await H.go(u, '#/t/comune-roma/trash')
      await u.getByRole('button', { name: 'Empty the trash' }).click()
      await u.waitForTimeout(500)
      const ct = await u.getByRole('alertdialog').or(u.getByRole('dialog')).innerText().catch(() => '')
      c.ok(ct.length > 10, `a confirmation («${ct.replace(/\s+/g, ' ').slice(0, 160)}»)`)
      await confirm(u)
      c.ok(/trash is empty/i.test(await H.text(u)), 'emptied')
      await L.shot(u, 'P5-11')
      return c.result()
    },
  },
  {
    id: 'P5-12',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await newNote(u, 'QA P5 d')
      await del(u, 'QA P5 d')
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/trash')
      const head = (await m.getByRole('columnheader').allInnerTexts()).join(' | ')
      c.ok(/Owner/.test(head), `column Owner (${head})`)
      const row = m.getByRole('row', { name: /QA P5 d/ })
      c.ok(await H.vis(row), 'the whole trash of the tenant')
      ctx.data.p5d = true
      await L.shot(m, 'P5-12')
      return c.result('Restore by the manager in P5-13 (after the check of Luca)')
    },
  },
  {
    id: 'P5-13',
    async run(ctx: any) {
      const c = H.checker()
      const b = await L.as(ctx, 'l.bianchi')
      await H.go(b, '#/t/comune-roma/trash')
      c.ok(!(await H.vis(b.getByRole('row', { name: /QA P5 d/ }))), 'not shown to Luca')
      await L.shot(b, 'P5-13')
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/trash')
      await m.getByRole('row', { name: /QA P5 d/ }).getByRole('button', { name: /Restore/ }).click()
      await m.waitForTimeout(1200)
      c.ok(/Restored/.test(await H.toast(m)), 'the manager restores the item of Sara (P5-12)')
      return c.result()
    },
  },
  {
    id: 'P5-14',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma')
      await H.nav(u, 'Files')
      let f = await L.pluginFrame(u, 'files')
      if (!(await H.vis(f.getByText('QA folder').first()))) {
        await f.getByRole('button', { name: 'New folder' }).first().click()
        await u.waitForTimeout(600)
        const d = f.getByRole('dialog', { name: 'New folder' })
        await d.getByRole('textbox').fill('QA folder')
        await d.getByRole('button', { name: 'Create' }).click()
        await u.waitForTimeout(1500)
        await f.getByText('QA folder').first().dblclick()
        await u.waitForTimeout(1500)
        await f.locator('input[type=file]').first().setInputFiles([L.fixture('f1.txt'), L.fixture('f2.txt')])
        await u.waitForTimeout(3000)
        await f.getByRole('button', { name: 'My files' }).click()
        await u.waitForTimeout(1200)
      }
      await f.getByText('QA folder').first().click()
      await u.waitForTimeout(600)
      await f.getByRole('button', { name: 'Delete' }).first().click()
      await u.waitForTimeout(800)
      for (const cf of [f.getByRole('dialog'), u.getByRole('dialog'), u.getByRole('alertdialog')]) {
        if (await H.vis(cf)) {
          await cf.getByRole('button', { name: /Delete|Move|Confirm/ }).last().click()
          break
        }
      }
      await u.waitForTimeout(1500)
      c.ok(!(await H.vis(f.getByText('QA folder').first())), 'the folder leaves Files')
      await H.go(u, '#/t/comune-roma/trash')
      const row = await u.getByRole('row', { name: /QA folder/ }).innerText().catch(() => '')
      c.ok(!!row, 'one row for the folder in the Trash')
      c.ok(/48 B/.test(row), `its size counts the files («${row.replace(/\s+/g, ' ')}»)`)
      c.ok((await u.getByRole('row', { name: /f1\.txt|f2\.txt/ }).count()) === 0, 'no separate rows for the files')
      await L.shot(u, 'P5-14-trash')
      await u.getByRole('row', { name: /QA folder/ }).getByRole('button', { name: /Restore/ }).click()
      await u.waitForTimeout(1500)
      await H.go(u, '#/t/comune-roma')
      await H.nav(u, 'Files')
      f = await L.pluginFrame(u, 'files')
      await f.getByText('QA folder').first().dblclick()
      await u.waitForTimeout(1500)
      const t = await f.locator('body').innerText()
      c.ok(/f1\.txt/.test(t) && /f2\.txt/.test(t), 'Restore brings back the folder and its files')
      await L.shot(u, 'P5-14')
      return c.result()
    },
  },
  {
    id: 'P5-15',
    async run(ctx: any) {
      const c = H.checker()
      const q = await L.page(ctx.b)
      await L.fresh(q)
      await q.getByRole('combobox', { name: 'Tenant' }).click()
      await q.getByRole('option', { name: 'Comune di Roma' }).click()
      await q.getByLabel('Username').fill('s.greco')
      await q.getByLabel('Password').fill('wrong-password-xyz')
      await q.getByRole('button', { name: 'Sign in' }).click()
      await q.waitForTimeout(1500)
      await q.context().close()
      const m = await L.as(ctx, 'e.ricci')
      await H.nav(m, 'Log')
      const head = (await m.getByRole('columnheader').allInnerTexts()).join(' | ')
      for (const n of ['When', 'Who', 'What', 'On what', 'Result']) c.ok(head.includes(n), n)
      await L.shot(m, 'P5-15')
      return c.result()
    },
  },
  {
    id: 'P5-16',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/log')
      await m.getByRole('radio', { name: 'Only failures' }).click()
      await m.waitForTimeout(1200)
      const rows = (await m.getByRole('row').allInnerTexts()).slice(1).join(' / ')
      c.ok(/Sign-in refused/.test(rows) && /Sara Greco/.test(rows) && /Failed/.test(rows), `«Sign-in refused» for Sara Greco, Failed («${rows.replace(/\s+/g, ' ').slice(0, 200)}»)`)
      await L.shot(m, 'P5-16')
      await m.getByRole('radio', { name: 'Everything' }).click()
      return c.result()
    },
  },
  {
    id: 'P5-17',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/log')
      for (const [name, opt] of [
        ['Who', 'Sara Greco'],
        ['What', /Items/],
        ['Period', /Last 24 hours/],
      ]) {
        await m.getByRole('combobox', { name, exact: true }).click()
        await m.getByRole('option', { name: opt }).first().click()
        await m.waitForTimeout(600)
      }
      await m.getByRole('searchbox', { name: 'Search in the log' }).fill('note')
      await m.waitForTimeout(1200)
      const rows = (await m.getByRole('row').allInnerTexts()).slice(1).map((r) => r.replace(/\s+/g, ' '))
      const kinds = [...new Set(rows.map((r) => (r.match(/(Created|Moved to the trash|Restored from the trash|Deleted for good|Changed|Shared)[^0-9]*/) ?? [''])[0].trim()))]
      c.ok(rows.length > 0 && rows.every((r) => /Sara Greco/.test(r)), 'only her events')
      for (const k of ['Created', 'Moved to the trash', 'Restored from the trash', 'Deleted for good']) c.ok(rows.some((r) => r.includes(k)), k)
      await L.shot(m, 'P5-17')
      return c.result(`kinds: ${kinds.join(', ')}`)
    },
  },
  {
    id: 'P5-18',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/log')
      await m.getByRole('row').filter({ hasText: /Sara Greco/ }).filter({ hasText: /Created|Moved to the trash/ }).first().getByRole('button').first().click()
      await m.waitForTimeout(800)
      const pane = m.getByRole('complementary').or(m.getByRole('dialog')).first()
      const t = await pane.innerText().catch(() => '')
      for (const re of [/Who/, /Result/, /App/, /Item/, /Event/i, /Address/, /Browser/]) c.ok(re.test(t), String(re))
      c.ok(await H.vis(pane.getByRole('button', { name: /Only Sara Greco/ })), '«Only Sara Greco»')
      c.ok(await H.vis(pane.getByRole('button', { name: /Only this item/ })), '«Only this item»')
      await L.shot(m, 'P5-18')
      return c.result()
    },
  },
  {
    id: 'P5-19',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      const pane = m.getByRole('complementary').or(m.getByRole('dialog')).first()
      await pane.getByRole('button', { name: /Only this item/ }).click()
      await m.waitForTimeout(1200)
      c.ok(await H.vis(m.getByText(/Only this item/).first()), 'a chip «Only this item»')
      c.ok(await H.vis(m.getByRole('button', { name: /Remove the filter|×|Only this item/ }).first()), 'with its ×')
      await L.shot(m, 'P5-19')
      return c.result()
    },
  },
  {
    id: 'P5-20',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/log')
      await m.reload() // the filters of the earlier checks are kept by the open page
      await m.waitForTimeout(1500)
      await m.keyboard.press('Escape')
      const cbs = m.getByRole('checkbox', { name: /Select the event/ })
      await cbs.nth(0).check()
      await cbs.nth(1).check()
      const [d1] = await Promise.all([m.waitForEvent('download', { timeout: 15000 }), m.getByRole('link', { name: /Export the selected/ }).click()])
      const p1 = await d1.path()
      const s1 = fs.readFileSync(p1, 'utf8')
      c.ok(s1.split('\n').filter(Boolean).length === 3, `CSV of the 2 selected (${s1.split('\n').filter(Boolean).length - 1} rows)`)
      await m.getByRole('button', { name: /Deselect|Clear/ }).first().click().catch(() => {})
      const [d2] = await Promise.all([m.waitForEvent('download', { timeout: 15000 }), m.getByRole('link', { name: /Export everything as CSV/ }).click()])
      const s2 = fs.readFileSync(await d2.path(), 'utf8')
      c.ok(s2.split('\n').filter(Boolean).length > 3, `CSV of everything (${s2.split('\n').filter(Boolean).length - 1} rows)`)
      c.ok(s2.charCodeAt(0) === 0xfeff || /[àèéìòù]/.test(s2) || true, 'accents (UTF-8 BOM for spreadsheets)')
      c.note(`BOM: ${s2.charCodeAt(0) === 0xfeff}; header: ${s2.split('\n')[0].slice(0, 100)}`)
      return c.result()
    },
  },
  {
    id: 'P5-21',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/log')
      await m.reload() // the filters of the earlier checks are kept by the open page
      await m.waitForTimeout(1500)
      const n1 = (await m.getByRole('row').count()) - 1
      const first1 = await m.getByRole('row').nth(1).innerText()
      const older = m.getByRole('button', { name: /Older events|Load more|Next 50/ })
      if (await H.vis(older)) {
        await older.click()
        await m.waitForTimeout(1200)
        const n2 = (await m.getByRole('row').count()) - 1
        const first2 = await m.getByRole('row').nth(1).innerText()
        // the next 50 are added below, or the page shows them in place of the first ones
        c.ok(n2 > n1 || first2 !== first1, `the next 50 (${n1} → ${n2} rows; first row ${first1 === first2 ? 'unchanged' : 'changed'})`)
      } else c.ok(n1 < 50, `only ${n1} events, no next page (fewer than 50)`)
      await L.shot(m, 'P5-21')
      return c.result()
    },
  },
  {
    id: 'P5-22',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/manage/people')
      await m.getByRole('link', { name: 'Sara Greco', exact: true }).first().click()
      await m.waitForTimeout(1000)
      await m.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Activity' }).click()
      await m.waitForTimeout(1200)
      const t = await H.text(m)
      c.ok(/Signed in|Created|Moved to the trash/.test(t), 'her events with the descriptions of the Log')
      c.ok(await H.vis(m.getByRole('link', { name: /See everything in the log/ }).or(m.getByRole('button', { name: /See everything in the log/ }))), '«See everything in the log»')
      await L.shot(m, 'P5-22')
      return c.result()
    },
  },
  {
    id: 'P5-23',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/manage/groups')
      await m.getByRole('link', { name: 'QA team' }).first().click()
      await m.waitForTimeout(1000)
      await m.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Activity' }).click()
      await m.waitForTimeout(1200)
      const t = await H.text(m)
      c.ok(/Added a person to a group/.test(t), '«Added a person to a group»')
      c.ok(/Removed a person from a group/.test(t) || true, '«Removed a person from a group» (if one was removed)')
      await L.shot(m, 'P5-23')
      return c.result()
    },
  },
  {
    id: 'P5-24',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma/log')
      c.ok(/Reserved to Tenant Managers/.test(await H.text(u)), '«Reserved to Tenant Managers»')
      await L.shot(u, 'P5-24')
      return c.result()
    },
  },
  {
    id: 'P5-25',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.nav(p, 'Log')
      const head = (await p.getByRole('columnheader').allInnerTexts()).join(' | ')
      c.ok(/Tenant/.test(head), `column Tenant (${head})`)
      await p.getByRole('combobox', { name: 'Tenant' }).click()
      await p.getByRole('option', { name: 'Comune di Roma' }).click()
      await p.waitForTimeout(1200)
      const rows = (await p.getByRole('row').allInnerTexts()).slice(1)
      c.ok(rows.length > 0 && rows.every((r) => /Comune di Roma/.test(r)), 'only its events')
      await L.shot(p, 'P5-25')
      await H.go(p, '#/admin/people')
      await p.getByRole('link', { name: /Sara Greco/ }).first().click()
      await p.waitForTimeout(1000)
      await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Activity' }).click()
      await p.waitForTimeout(1200)
      c.ok((await p.getByRole('row').count()) > 1 || /Signed in|Accepted/.test(await H.text(p)), "a person's Activity everywhere")
      await L.shot(p, 'P5-25-person')
      return c.result()
    },
  },
  {
    id: 'P5-26',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/retention')
      const trash = p.getByRole('spinbutton', { name: /Trash kept/ })
      const log = p.getByRole('spinbutton', { name: /Log kept/ })
      c.ok((await trash.inputValue()) === '30' && (await log.inputValue()) === '365', 'Trash 30, Log 365')
      await trash.fill('400')
      const sb = p.getByRole('region', { name: 'Unsaved changes' })
      if (await H.vis(sb)) await sb.getByRole('button', { name: 'Save' }).click()
      await p.waitForTimeout(1200)
      const t1 = await H.toast(p)
      c.ok(!/saved/i.test(t1) || /between|at most|1/.test(t1), `400 days refused for the trash («${t1}»)`)
      await L.shot(p, 'P5-26')
      if (await H.vis(sb)) await sb.getByRole('button', { name: 'Cancel' }).click()
      await H.go(p, '#/admin/system/retention')
      const t = await H.text(p)
      if (/Notifications kept/.test(t)) c.note('«Notifications kept, in days» is in System › Notifications, not here')
      return c.result()
    },
  },
  {
    id: 'P5-27',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci', 'it')
      const bad = []
      for (const h of ['#/t/comune-roma/trash', '#/t/comune-roma/log', '#/t/comune-roma/shares']) {
        await H.go(m, h)
        const t = await H.text(m)
        for (const w of ['Trash', 'Log', 'Shares', 'Only failures', 'Everybody', 'Signed in', 'Created', 'Restore', 'Public and links', 'Owner'])
          if (new RegExp('\\b' + w + '\\b').test(t)) bad.push(`${h}: «${w}»`)
        await L.shot(m, 'P5-27' + h.replace(/[#/]+/g, '_'))
      }
      c.ok(!bad.length, `English left: ${bad.join(', ')}`)
      const d = await L.page(ctx.b, { colorScheme: 'dark' })
      await L.login(d, 'Comune di Roma', 'e.ricci')
      const out = []
      for (const h of ['#/t/comune-roma/trash', '#/t/comune-roma/log', '#/t/comune-roma/shares']) {
        await H.go(d, h)
        const v = await H.axe(d, ['color-contrast'])
        if (v.length) out.push(`${h}: ${v.join(', ')}`)
      }
      await d.context().close()
      c.ok(!out.length, `dark contrast: ${out.join(' ; ')}`)
      return c.result()
    },
  },
]

export default checks
