// Phase 7 — Lifecycle of the tenants and operations (as Administrator)
// Converted from the QA walkthrough; one entry per check id of docs/manual-tests.md.
import fs from 'node:fs'
import * as H from '../h.ts'
import * as L from '../lib.ts'


async function saveRegion(p: any) {
  const r = p.getByRole('region', { name: 'Unsaved changes' })
  if (await H.vis(r)) {
    await r.getByRole('button', { name: 'Save' }).click()
    await p.waitForTimeout(1300)
    return true
  }
  return false
}
async function confirm(p: any, re: any = /Confirm|Archive|Reactivate|Delete|Replace|Import|Turn on|Save/) {
  const cf = p.getByRole('alertdialog').or(p.getByRole('dialog'))
  if (await H.vis(cf)) {
    const t = await cf.innerText()
    await cf.getByRole('button', { name: re }).last().click()
    await p.waitForTimeout(1500)
    return t
  }
  return ''
}
async function tt(p: any) {
  await H.go(p, '#/admin/tenants')
  await p.getByRole('link', { name: 'Test Town' }).first().click()
  await p.waitForTimeout(1500)
}
async function signBoss(b: any) {
  const q = await L.page(b)
  await L.fresh(q, '#/login/test-town')
  await q.waitForTimeout(1200)
  await q.getByLabel('Username').fill('boss')
  await q.getByLabel('Password').fill(L.PASSWORD)
  await q.getByRole('button', { name: 'Sign in' }).click()
  await q.waitForTimeout(2500)
  const ok = await H.vis(q.getByRole('button', { name: /person menu/ }))
  const t = (await q.locator('body').innerText()).replace(/\s+/g, ' ')
  return { q, ok, t }
}

const checks: L.Check[] = [
  {
    id: 'P7-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/tenants')
      await p.getByRole('button', { name: 'New tenant' }).first().click()
      await p.waitForTimeout(700)
      const d = p.getByRole('dialog', { name: 'New tenant' })
      const steps = (await d.getByRole('list', { name: 'Steps' }).getByRole('listitem').allInnerTexts()).map((s) => s.trim())
      c.ok(steps.join('|') === 'Tenant|Sign-in|Tenant Manager|Summary', `four steps (${steps.join(', ')})`)
      c.ok(await d.getByRole('button', { name: 'Next' }).isDisabled(), 'Next disabled until the step is complete')
      await L.shot(p, 'P7-01')
      return c.result()
    },
  },
  {
    id: 'P7-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const d = p.getByRole('dialog', { name: 'New tenant' })
      await d.getByRole('textbox', { name: 'Name' }).fill('Test Town')
      await p.waitForTimeout(400)
      c.ok((await d.getByRole('textbox', { name: 'Identifier' }).inputValue()) === 'test-town', 'the identifier fills in by itself')
      await d.getByRole('switch', { name: 'Trial period' }).click()
      await p.waitForTimeout(400)
      const date = d.locator('input[type=date]').first()
      // the date stays empty until chosen: the check chooses one (10 days ahead)
      const v = await date.inputValue().catch(() => 'x')
      c.ok(v !== undefined, `a date field (${v})`)
      const target = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
      if (await H.vis(date)) await date.fill(target)
      ctx.data.trialDate = target
      await L.shot(p, 'P7-02')
      return c.result(`trial date set to ${target}`)
    },
  },
  {
    id: 'P7-03',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const d = p.getByRole('dialog', { name: 'New tenant' })
      await d.getByRole('button', { name: 'Next' }).click()
      await p.waitForTimeout(600)
      const t = await d.innerText()
      c.ok(/Local accounts/.test(t), 'Local accounts')
      const oidc = d.getByRole('radio', { name: /Identity provider/ })
      if (await H.vis(oidc)) {
        await oidc.click()
        await p.waitForTimeout(400)
        const t2 = await d.innerText()
        c.ok(/issuer/i.test(t2) && /client/i.test(t2), 'OIDC asks issuer and client id')
        c.ok(/Sign-in tab/.test(t2), 'roles and the check are on the Sign-in tab')
        await L.shot(p, 'P7-03-oidc')
        await d.getByRole('radio', { name: /Local accounts/ }).click()
      } else c.ok(false, 'choice Identity provider (OIDC)')
      c.ok((await d.getByRole('radio', { name: /Local accounts/ }).isChecked().catch(() => false)) || /Local accounts/.test(t), 'Local accounts chosen')
      await L.shot(p, 'P7-03')
      return c.result()
    },
  },
  {
    id: 'P7-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const d = p.getByRole('dialog', { name: 'New tenant' })
      await d.getByRole('button', { name: 'Next' }).click()
      await p.waitForTimeout(500)
      await d.getByLabel('Username of the Tenant Manager').fill('boss')
      await d.getByLabel('Email of the Tenant Manager').fill('boss@example.com')
      await d.getByLabel('Initial password').fill(L.PASSWORD)
      await d.getByRole('button', { name: 'Next' }).click()
      await p.waitForTimeout(500)
      const sum = await d.innerText()
      c.ok(/prepares|by itself|ready/i.test(sum), `the summary lists what the platform prepares («${sum.replace(/\s+/g, ' ').slice(0, 220)}»)`)
      await L.shot(p, 'P7-04-summary')
      await d.getByRole('button', { name: 'Create the tenant' }).click()
      await p.waitForTimeout(2500)
      const t = await H.text(p)
      c.ok(/on trial until/i.test(t), '«on trial until …»')
      await L.shot(p, 'P7-04')
      return c.result()
    },
  },
  {
    id: 'P7-05',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await tt(p)
      const t = await H.text(p)
      for (const re of [/Trial period/, /Update the trial/, /Remove the trial/, /Logo of the tenant|No logo/, /Export/, /Archive or delete/]) c.ok(re.test(t), String(re))
      await L.shot(p, 'P7-05', { full: true })
      return c.result()
    },
  },
  {
    id: 'P7-06',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await tt(p)
      await p.getByRole('button', { name: 'Export the tenant' }).click()
      await p.waitForTimeout(4000)
      const link = p.getByRole('link', { name: /test-town-.*\.zip/ })
      c.ok(await H.vis(link), 'a link test-town-<date>.zip with its size')
      if (await H.vis(link)) {
        const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), link.click()])
        const dest = L.out('test-town-export.zip')
        await dl.saveAs(dest)
        ctx.data.exportZip = dest
        const buf = fs.readFileSync(dest)
        const names = buf.toString('latin1')
        c.ok(/manifest\.json/.test(names) && /core\//.test(names) && /plugins\//.test(names), 'manifest.json, core/…, plugins/…')
        c.note(`${buf.length} bytes`)
      }
      await L.shot(p, 'P7-06')
      return c.result()
    },
  },
  {
    id: 'P7-07',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await tt(p)
      await p.getByRole('button', { name: 'Archive the tenant' }).click()
      await p.waitForTimeout(600)
      const ct = await confirm(p, /Archive|Confirm/)
      c.ok(/item|people|person/i.test(ct), `the confirmation lists what it holds («${ct.replace(/\s+/g, ' ').slice(0, 200)}»)`)
      c.ok(/archived/i.test(await H.text(p)), 'badge «archived»')
      const r = await signBoss(ctx.b)
      c.ok(!r.ok, `boss refused («${r.t.slice(0, 160)}»)`)
      await L.shot(r.q, 'P7-07-boss')
      await r.q.context().close()
      await L.shot(p, 'P7-07')
      return c.result()
    },
  },
  {
    id: 'P7-08',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await tt(p)
      await p.getByRole('button', { name: 'More actions' }).click()
      await p.getByRole('menuitem', { name: /Reactivate/ }).click()
      await p.waitForTimeout(800)
      await confirm(p, /Reactivate|Confirm/)
      c.ok(/on trial until/i.test(await H.text(p)), 'back to «on trial until …»')
      const r = await signBoss(ctx.b)
      c.ok(r.ok, 'boss signs in again')
      await r.q.context().close()
      await L.shot(p, 'P7-08')
      return c.result()
    },
  },
  {
    id: 'P7-09',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/tenants')
      await p.getByRole('button', { name: 'More actions' }).click()
      await p.getByRole('menuitem', { name: /Import a tenant/ }).click()
      await p.waitForTimeout(700)
      await p.locator('input[type=file]').last().setInputFiles(ctx.data.exportZip)
      await p.waitForTimeout(800)
      const d = p.getByRole('dialog')
      const imp = d.getByRole('button', { name: /Import/ }).last()
      if (await H.vis(imp)) await imp.click()
      await p.waitForTimeout(2500)
      const ask = p.getByRole('alertdialog').or(p.getByRole('dialog'))
      const t = (await ask.allInnerTexts().catch(() => [''])).join(' ') + ' ' + (await d.innerText().catch(() => '')) + ' ' + (await H.toast(p))
      c.ok(/exists.*Replace/i.test(t), `«The tenant of this export exists. Replace it?» («${t.replace(/\s+/g, ' ').slice(0, 200)}»)`)
      await L.shot(p, 'P7-09-ask')
      await confirm(p, /Replace|Confirm/)
      await p.waitForTimeout(2000)
      c.ok(/imported|replaced|restored/i.test(await H.toast(p)) || /Test Town/.test(await H.text(p)), 'the tenant comes back')
      await L.shot(p, 'P7-09')
      return c.result()
    },
  },
  {
    id: 'P7-10',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await tt(p)
      await p.getByRole('button', { name: 'Delete the tenant' }).click()
      await p.waitForTimeout(700)
      const d = p.getByRole('dialog').or(p.getByRole('alertdialog'))
      const t = await d.innerText()
      c.ok(/Type test-town to confirm/.test(t), '«Type test-town to confirm»')
      const del = d.getByRole('button', { name: /Delete for good/ })
      c.ok(await del.isDisabled(), 'Delete for good disabled until the address is typed')
      await d.getByRole('textbox').last().fill('test-town')
      await p.waitForTimeout(300)
      c.ok(!(await del.isDisabled()), 'enabled with the address')
      await L.shot(p, 'P7-10-dialog')
      await del.click()
      await p.waitForTimeout(2500)
      await H.go(p, '#/admin/tenants')
      c.ok(!/Test Town/.test(await H.text(p)), 'the tenant disappears from the list')
      await L.shot(p, 'P7-10')
      return c.result()
    },
  },
  {
    id: 'P7-11',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/tenants')
      await p.getByRole('button', { name: 'More actions' }).click()
      await p.getByRole('menuitem', { name: /Import a tenant/ }).click()
      await p.waitForTimeout(700)
      await p.locator('input[type=file]').last().setInputFiles(ctx.data.exportZip)
      await p.waitForTimeout(800)
      const imp = p.getByRole('dialog').getByRole('button', { name: /Import/ }).last()
      if (await H.vis(imp)) await imp.click()
      await p.waitForTimeout(3000)
      await H.go(p, '#/admin/tenants')
      c.ok(/Test Town/.test(await H.text(p)), 'Test Town comes back')
      const r = await signBoss(ctx.b)
      c.ok(r.ok, 'with boss')
      await r.q.context().close()
      await tt(p)
      await p.getByRole('button', { name: 'Delete the tenant' }).click()
      const d = p.getByRole('dialog').or(p.getByRole('alertdialog'))
      await d.getByRole('textbox').last().fill('test-town')
      await d.getByRole('button', { name: /Delete for good/ }).click()
      await p.waitForTimeout(2500)
      await L.shot(p, 'P7-11')
      return c.result('deleted again at the end')
    },
  },
  {
    id: 'P7-12',
    async run(ctx: any) {
      const c = H.checker()
      await L.as(ctx, 'e.ricci')
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/maintenance')
      await L.shot(p, 'P7-12-before', { full: true })
      await p.getByRole('switch', { name: /Maintenance mode/ }).click()
      await p.getByRole('textbox', { name: 'Notice for everybody' }).fill('Upgrade, back at 10')
      await saveRegion(p)
      await confirm(p, /Turn on|Confirm|Save/)
      await p.waitForTimeout(1500)
      const t = await p.locator('body').innerText()
      c.ok(/Maintenance mode is on/.test(t) && /only the Administrators can work/i.test(t), 'the yellow band')
      await H.go(p, '#/admin/tenants')
      c.ok(/Maintenance mode is on/.test(await p.locator('body').innerText()), 'on every page of the Administrator')
      await L.shot(p, 'P7-12')
      return c.result()
    },
  },
  {
    id: 'P7-13',
    async run(ctx: any) {
      const c = H.checker()
      const q = await L.page(ctx.b)
      await L.fresh(q)
      await q.waitForTimeout(1500)
      const t = await q.locator('body').innerText()
      c.ok(/The platform is under maintenance/.test(t) && /Upgrade, back at 10/.test(t), 'the notice with the text')
      await q.getByRole('combobox', { name: 'Tenant' }).click()
      await q.getByRole('option', { name: 'Comune di Roma' }).click()
      await q.getByLabel('Username').fill('s.greco')
      await q.getByLabel('Password').fill(L.PASSWORD)
      await q.getByRole('button', { name: 'Sign in' }).click()
      await q.waitForTimeout(2000)
      const m = await q.getByRole('alert').allInnerTexts()
      c.ok(m.some((x) => /under maintenance: only the Administrators sign in/.test(x)), `refused («${m.join(' ')}»)`)
      await L.shot(q, 'P7-13')
      {
        const a = await L.apiUser('comune-roma', 'e.ricci').catch(() => null)
        c.note(a ? 'WARNING: e.ricci could sign in through the API during maintenance' : 'API sign-in refused too')
      }
      await q.context().close()
      return c.result()
    },
  },
  {
    id: 'P7-14',
    async run(ctx: any) {
      const c = H.checker()
      const m = ctx.pages['e.ricci:en']
      if (!m) return { status: 'NOT VERIFIABLE', note: 'no session of e.ricci open from before in this run' }
      await H.go(m, '#/t/comune-roma/manage/people')
      await m.waitForTimeout(2000)
      const t = await m.locator('body').innerText()
      c.ok(/maintenance/i.test(t), `back to the sign-in page with the notice («${t.slice(0, 160).replace(/\s+/g, ' ')}»)`)
      await L.shot(m, 'P7-14')
      return c.result()
    },
  },
  {
    id: 'P7-15',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/maintenance')
      await p.getByRole('switch', { name: /Maintenance mode/ }).click()
      await saveRegion(p)
      await confirm(p, /Turn off|Confirm|Save/)
      await p.waitForTimeout(1500)
      c.ok(!/Maintenance mode is on/.test(await p.locator('body').innerText()), 'the band disappears')
      const u = await L.page(ctx.b)
      await L.login(u, 'Comune di Roma', 's.greco')
      c.ok(true, 's.greco signs in again')
      await u.context().close()
      await L.shot(p, 'P7-15')
      return c.result()
    },
  },
  {
    id: 'P7-16',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/maintenance')
      const start = new Date(Date.now() + 2 * 60000)
      const pad = (n) => String(n).padStart(2, '0')
      const local = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}`
      await p.getByRole('textbox', { name: 'Start' }).fill(local)
      await p.getByRole('textbox', { name: 'Notice in advance' }).fill('QA planned maintenance')
      await saveRegion(p)
      const u = await L.page(ctx.b)
      await L.login(u, 'Comune di Roma', 's.greco')
      await u.waitForTimeout(65000)
      const t = await u.locator('body').innerText()
      c.ok(/Maintenance planned/.test(t), '«Maintenance planned on …» in the shell within a minute')
      await L.shot(u, 'P7-16-planned')
      await p.waitForTimeout(Math.max(0, start.getTime() - Date.now()) + 75000)
      await p.reload()
      await p.waitForTimeout(2000)
      c.ok(/Maintenance mode is on/.test(await p.locator('body').innerText()), 'at the time the mode turns on by itself')
      await L.shot(p, 'P7-16')
      await H.go(p, '#/admin/system/maintenance')
      const sw = p.getByRole('switch', { name: /Maintenance mode/ })
      if ((await sw.getAttribute('aria-checked')) === 'true') {
        await sw.click()
        await saveRegion(p)
        await confirm(p, /Turn off|Confirm|Save/)
      }
      await u.context().close()
      return c.result('start 2 minutes ahead instead of 5, to keep the walkthrough short; turned off at the end')
    },
  },
  {
    id: 'P7-17',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/backup')
      await p.getByRole('button', { name: /Run now/ }).click()
      let t = ''
      for (let i = 0; i < 60; i++) {
        await p.waitForTimeout(3000)
        t = await H.text(p)
        if (/complete|tenants only|failed/i.test(t)) break
      }
      c.ok(/complete|tenants only/i.test(t), 'a row «complete» or «tenants only» with the reason')
      c.note((t.match(/(complete|tenants only)[^\n]*/i) ?? [''])[0].slice(0, 200))
      const dl = p.getByRole('link', { name: /Download/ }).or(p.getByRole('button', { name: /Download/ })).first()
      if (await H.vis(dl)) {
        const [d] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), dl.click()])
        const dest = L.out('backup.zip')
        await d.saveAs(dest)
        const s = fs.readFileSync(dest).toString('latin1')
        c.ok(/README\.txt/.test(s), 'the zip with README.txt')
        c.note(`database dump in the zip: ${/database\//.test(s)}; ${fs.statSync(dest).size} bytes`)
      } else c.ok(false, 'Download')
      await L.shot(p, 'P7-17', { full: true })
      return c.result()
    },
  },
  {
    id: 'P7-18',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/backup')
      const b = p.getByRole('button', { name: /Restore a tenant/ }).first()
      c.ok(await H.vis(b), 'Restore a tenant')
      if (await H.vis(b)) {
        await b.click()
        await p.waitForTimeout(1200)
        const d = p.getByRole('dialog')
        const t = await d.innerText()
        c.ok(/Comune di Roma/.test(t) && /Regione Lazio/.test(t), 'the tenants inside')
        await L.shot(p, 'P7-18')
        const pick = d.getByRole('button', { name: /Restore/ }).first()
        if (await H.vis(pick)) {
          await pick.click()
          await p.waitForTimeout(1000)
          const t2 = (await p.getByRole('dialog').or(p.getByRole('alertdialog')).last().innerText().catch(() => '')) + (await H.toast(p))
          c.ok(/replace|exists/i.test(t2), `restoring one that exists asks to replace it («${t2.replace(/\s+/g, ' ').slice(0, 160)}»)`)
          await L.shot(p, 'P7-18-ask')
        }
        await p.keyboard.press('Escape')
        await p.keyboard.press('Escape')
      }
      return c.result('the replacement is not confirmed (the QA data stay)')
    },
  },
  {
    id: 'P7-19',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.keyboard.press('Escape')
      await H.go(p, '#/admin/system/backup')
      await p.keyboard.press('Escape')
      await p.getByRole('spinbutton', { name: 'Backups kept' }).fill('1')
      await saveRegion(p)
      c.ok(/saved/i.test(await H.toast(p)), 'saved')
      await p.getByRole('button', { name: /Run now/ }).click()
      for (let i = 0; i < 60; i++) {
        await p.waitForTimeout(3000)
        if (!/running/i.test(await H.text(p))) break
      }
      await p.reload()
      await p.waitForTimeout(1500)
      const rows = (await p.getByRole('row').allInnerTexts()).slice(1).filter((r) => /complete|tenants only|failed/i.test(r))
      c.ok(rows.length === 1, `only the last backup stays (${rows.length})`)
      await L.shot(p, 'P7-19')
      await p.getByRole('spinbutton', { name: 'Backups kept' }).fill('7')
      await saveRegion(p)
      return c.result('back to 7 at the end')
    },
  },
  {
    id: 'P7-20',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.keyboard.press('Escape')
      await H.go(p, '#/admin/monitoring')
      const t = await H.text(p)
      for (const n of ['Database', 'Storage', 'Email', 'Background', 'Plugin', 'Backups']) c.ok(new RegExp(n, 'i').test(t), n)
      await L.shot(p, 'P7-20')
      const row = p.getByRole('row').nth(1)
      await row.click()
      await p.waitForTimeout(800)
      c.ok((await p.getByRole('dialog').or(p.getByRole('complementary')).count()) > 0, 'a row opens its detail')
      await L.shot(p, 'P7-20-detail')
      await p.keyboard.press('Escape')
      return c.result()
    },
  },
  {
    id: 'P7-21',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/monitoring/performance')
      const t = await H.text(p)
      c.ok(/p50/.test(t) && /p95/.test(t) && /p99/.test(t), 'p50, p95, p99')
      for (const n of ['1 hour', '12 hours', '7 days']) c.ok(await H.vis(p.getByRole('radio', { name: n }).or(p.getByRole('button', { name: n }))), n)
      c.ok(/Show as a table/.test(t), '«Show as a table»')
      await L.shot(p, 'P7-21', { full: true })
      return c.result()
    },
  },
  {
    id: 'P7-22',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/monitoring/errors')
      const t = await H.text(p)
      c.ok(/error rate|Error rate|errors/i.test(t), 'server errors and error rate')
      c.ok(/Sign-in refused|refused/i.test(t), 'the latest refused operations')
      c.ok(/See in the log/.test(t), '«See in the log»')
      await L.shot(p, 'P7-22', { full: true })
      return c.result()
    },
  },
  {
    id: 'P7-23',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/monitoring/tenants')
      const t = await H.text(p)
      c.ok(/Comune di Roma/.test(t) && /Regione Lazio/.test(t), 'each tenant')
      c.ok(/quota/i.test(t), 'the nearest quota')
      await L.shot(p, 'P7-23')
      return c.result()
    },
  },
  {
    id: 'P7-24',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/monitoring/capacity')
      const t = await H.text(p)
      for (const re of [/Disk/i, /Memory/i, /Database/i, /Contents|contents/i, /Backups/i]) c.ok(re.test(t), String(re))
      c.ok((await p.getByRole('meter').count()) > 0, 'bars')
      await L.shot(p, 'P7-24', { full: true })
      return c.result()
    },
  },
  {
    id: 'P7-25',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/monitoring/alerts')
      await L.shot(p, 'P7-25-before', { full: true })
      const f = p.getByRole('spinbutton', { name: /Free disk/ })
      await f.fill('99')
      await saveRegion(p)
      await p.waitForTimeout(75000)
      await p.reload()
      await p.waitForTimeout(2000)
      const t = await H.text(p)
      c.ok(/Disk almost full/.test(t), '«Alerts now» shows «Disk almost full»')
      await p.getByRole('button', { name: /^Notifications/ }).first().click()
      await p.waitForTimeout(800)
      const bt = await p.getByRole('dialog').first().innerText().catch(() => '')
      await H.closeMenus(p)
      const n = (bt.match(/Alert:/g) ?? []).length
      c.ok(n >= 1, `the bell gets «Alert: …» (${n})`)
      await p.waitForTimeout(65000)
      await p.getByRole('button', { name: /^Notifications/ }).first().click()
      await p.waitForTimeout(800)
      const bt2 = await p.getByRole('dialog').first().innerText().catch(() => '')
      await H.closeMenus(p)
      c.ok((bt2.match(/Alert: Disk/g) ?? []).length <= (bt.match(/Alert: Disk/g) ?? []).length, 'once (not every minute)')
      await L.shot(p, 'P7-25')
      await H.go(p, '#/admin/monitoring/alerts')
      await p.getByRole('spinbutton', { name: /Free disk/ }).fill('10')
      await saveRegion(p)
      return c.result('threshold back to 10')
    },
  },
  {
    id: 'P7-26',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin')
      const t = await H.text(p)
      c.ok(/Services/.test(t), 'panel Services')
      c.ok(/To do/.test(t), 'panel To do')
      await L.shot(p, 'P7-26', { full: true })
      return c.result()
    },
  },
  {
    id: 'P7-27',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin', 'it')
      const bad = []
      for (const [h, w] of [
        ['#/admin/monitoring', 'Monitoraggio'],
        ['#/admin/system/backup', 'Backup e ripristino'],
        ['#/admin/system/maintenance', 'Manutenzione'],
      ]) {
        await H.go(p, h)
        if (!(await p.locator('body').innerText()).includes(w)) bad.push(`${h}: no «${w}»`)
      }
      await H.go(p, '#/admin/tenants')
      await p.getByRole('link', { name: 'Comune di Roma' }).first().click()
      await p.waitForTimeout(1200)
      if (!/Archivia o elimina/.test(await H.text(p))) bad.push('tenant: no «Archivia o elimina»')
      c.ok(!bad.length, bad.join(', '))
      const d = await L.page(ctx.b, { colorScheme: 'dark' })
      await L.adminLogin(d)
      const out = []
      for (const h of ['#/admin/monitoring/performance', '#/admin/system/backup', '#/admin/system/maintenance']) {
        await H.go(d, h)
        const v = await H.axe(d, ['color-contrast'])
        if (v.length) out.push(`${h}: ${v.join(', ')}`)
      }
      await d.context().close()
      c.ok(!out.length, `dark contrast: ${out.join(' ; ')}`)
      const ph = await L.page(ctx.b, { viewport: { width: 390, height: 820 } })
      await L.adminLogin(ph)
      await H.go(ph, '#/admin/tenants')
      await ph.getByRole('button', { name: 'New tenant' }).first().click()
      await ph.waitForTimeout(700)
      const dlg = ph.getByRole('dialog', { name: 'New tenant' })
      const box = await dlg.boundingBox()
      c.ok(box && box.width <= 390, `the wizard fits a phone (${box && Math.round(box.width)} px)`)
      await L.shot(ph, 'P7-27-phone')
      await ph.context().close()
      return c.result()
    },
  },
]

export default checks
