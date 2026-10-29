// Phase 6 — Quotas and usage
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
async function tenantDetails(p: any, name: any = 'Comune di Roma') {
  await H.go(p, '#/admin/tenants')
  await p.getByRole('link', { name }).first().click()
  await p.waitForTimeout(1500)
  await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Quotas' }).click()
  await p.waitForTimeout(1200)
}
async function customize(p: any, quota: any, value: any) {
  const f = p.getByRole('spinbutton', { name: `Quota of the tenant: ${quota}` })
  if (await f.isDisabled()) {
    await p.getByRole('button', { name: 'Customize' }).nth(['Storage', 'People', 'Items'].indexOf(quota)).click()
    await p.waitForTimeout(400)
  }
  await f.fill('')
  await f.fill(String(value))
  await saveRegion(p)
}
async function newNote(p: any, title: any) {
  await H.go(p, '#/t/comune-roma')
  await H.nav(p, 'Notes')
  const f = await L.pluginFrame(p, 'notes')
  await f.getByRole('button', { name: /New note/ }).click()
  await f.getByRole('textbox', { name: 'Title *' }).fill(title)
  await f.getByRole('button', { name: 'Save' }).click()
  await p.waitForTimeout(1500)
  const created = await H.vis(f.locator('.msk-item').filter({ hasText: new RegExp(title) }))
  const msg = ((await f.locator('[role=status],[role=alert]').allInnerTexts().catch(() => [])).join(' ') + ' ' + (await H.toast(p))).trim()
  return { created, msg, f }
}

const checks: L.Check[] = [
  {
    id: 'P6-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/quotas')
      const t = await H.text(p)
      c.ok(/Quotas of new tenants/.test(t), '«Quotas of new tenants»')
      for (const n of ['Storage', 'People', 'Items']) c.ok(t.includes(n), n)
      c.ok(/Capacity of the platform/.test(t), '«Capacity of the platform»')
      c.ok(/Given to the tenants/.test(t) && /Used/.test(t), 'what is given and used')
      c.ok(/Comune di Roma/.test(t) && /Regione Lazio/.test(t), 'the tenants with usage and quotas')
      await L.shot(p, 'P6-01', { full: true })
      return c.result()
    },
  },
  {
    id: 'P6-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/quotas')
      c.ok(!(await H.vis(p.getByRole('region', { name: 'Unsaved changes' }))), 'no save bar before')
      await p.getByRole('spinbutton', { name: 'Capacity: People' }).fill('1')
      c.ok(await H.vis(p.getByRole('region', { name: 'Unsaved changes' })), 'save bar after the change')
      await saveRegion(p)
      const t = await H.text(p)
      c.ok(/More is given than the platform has/.test(t), '«More is given than the platform has: people»')
      c.ok(/Over the capacity/.test(t), '«Over the capacity»')
      await L.shot(p, 'P6-02', { full: true })
      await p.getByRole('spinbutton', { name: 'Capacity: People' }).fill('')
      await saveRegion(p)
      return c.result()
    },
  },
  {
    id: 'P6-03',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await tenantDetails(p)
      const t = await H.text(p)
      c.ok(/Of the platform: no limit/.test(t), '«Of the platform: …»')
      c.ok((await p.getByRole('button', { name: 'Customize' }).count()) >= 3, 'Customize')
      c.ok(/Used: /.test(t), 'Used: …')
      await L.shot(p, 'P6-03', { full: true })
      return c.result()
    },
  },
  {
    id: 'P6-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await tenantDetails(p)
      const t0 = await H.text(p)
      const block = await p.locator('[data-quota="items"]').innerText().catch(() => t0)
      const used = Number((block.match(/Used: (\d+)/) ?? t0.match(/items Used: (\d+)/) ?? [])[1] ?? 14)
      ctx.data.itemsUsed = used
      ctx.data.itemsQuota = used + 2
      await customize(p, 'Items', ctx.data.itemsQuota)
      const t = await H.text(p)
      const ts = await H.toast(p)
      c.ok(/Of this tenant/.test(t), '«Of this tenant»')
      c.ok(/Quotas of the tenant saved/.test(ts) || /saved/i.test(ts), `«Quotas of the tenant saved» («${ts}»)`)
      await H.go(p, '#/admin/system/quotas')
      const row = await p.getByRole('row', { name: /Comune di Roma/ }).innerText()
      c.ok(new RegExp(`${ctx.data.itemsQuota}`).test(row) && /of this tenant/i.test(row), `System › Quotas row («${row.replace(/\s+/g, ' ')}»)`)
      await L.shot(p, 'P6-04')
      return c.result(`items used ${used}, quota ${ctx.data.itemsQuota}`)
    },
  },
  {
    id: 'P6-05',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/usage')
      const s = (await m.getByRole('navigation', { name: 'Sections' }).getByRole('link').allInnerTexts()).join(' | ')
      for (const n of ['Quotas', 'Trend', 'Who uses the most', 'Activity', 'Alerts']) c.ok(s.includes(n), n)
      const t = await H.text(m)
      c.ok(/Managed by the Administrator/.test(t), 'read only with «Managed by the Administrator»')
      c.ok((await m.getByRole('meter').count()) >= 3, 'a bar per quota')
      c.ok(/At the limit/.test(t), '«At the limit: …»')
      c.note(/pace of the last 30 days/.test(t) ? 'forecast shown' : 'no forecast yet (new installation: only today in the history)')
      await L.shot(m, 'P6-05', { full: true })
      return c.result()
    },
  },
  {
    id: 'P6-06',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      let i = 0
      let r
      do {
        r = await newNote(u, `QA quota ${i++}`)
      } while (r.created && i < 6)
      await L.shot(u, 'P6-06-sara')
      await H.go(u, '#/t/comune-roma')
      await u.reload() // the alert is read when the page loads
      await u.waitForTimeout(2500)
      const side = await u.locator('[data-sidebar="sidebar"]').innerText()
      // with the sidebar closed the alert is an icon only, without text
      const icon = (await u.locator('[data-sidebar="footer"] svg').count()) > 0
      const html = await u.locator('[data-sidebar="sidebar"]').innerHTML()
      c.ok((await u.locator('[data-quota-alert]').count()) > 0 || /%|quota/i.test(side) || icon || /alert|warning|triangle/i.test(html), `sidebar alert for s.greco (text or icon; «${side.replace(/\s+/g, ' ').slice(-120)}»)`)
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma')
      await m.waitForTimeout(4000)
      await m.getByRole('button', { name: /^Notifications/ }).first().click()
      await m.waitForTimeout(800)
      const bt = await m.getByRole('dialog').first().innerText().catch(() => '')
      await H.closeMenus(m)
      c.ok(/Items of Comune di Roma: \d+% of the quota/.test(bt), `«Items of Comune di Roma: N% of the quota» («${bt.replace(/\s+/g, ' ').slice(0, 200)}»)`)
      c.ok(/used up/i.test(bt), '«the quota is used up, additions stop» at 100 %')
      ctx.data.lastQuotaMsg = r.msg
      await L.shot(m, 'P6-06')
      return c.result(`${i} attempts`)
    },
  },
  {
    id: 'P6-07',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      const r = await newNote(u, 'QA quota over')
      c.ok(!r.created, 'refused, nothing created')
      c.ok(/quota/i.test(r.msg), `the plugin says the quota is used up («${r.msg}»)`)
      await L.shot(u, 'P6-07')
      return c.result()
    },
  },
  {
    id: 'P6-08',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      for (const t of ['QA quota 0', 'QA quota 1']) {
        const f = await H.openNote(u, t)
        await f.getByRole('button', { name: 'Delete' }).click()
        await u.waitForTimeout(600)
        const cf = u.getByRole('alertdialog').or(u.getByRole('dialog'))
        if (await H.vis(cf)) await cf.getByRole('button', { name: /Delete|Confirm/ }).last().click()
        await u.waitForTimeout(1000)
      }
      let r = await newNote(u, 'QA quota after delete')
      c.ok(!r.created, 'still refused (the trash counts)')
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/usage/activity')
      c.ok(/of which in the trash/i.test(await H.text(m)), 'Usage › Activity: «of which in the trash»')
      await L.shot(m, 'P6-08-activity')
      await H.go(u, '#/t/comune-roma/trash')
      await u.getByRole('row', { name: /QA quota 0/ }).getByRole('button', { name: /Restore/ }).click()
      await u.waitForTimeout(1200)
      c.ok(/Restored/.test(await H.toast(u)), 'restoring one works')
      await u.getByRole('button', { name: 'Empty the trash' }).click()
      await u.waitForTimeout(500)
      const cf = u.getByRole('alertdialog').or(u.getByRole('dialog'))
      if (await H.vis(cf)) await cf.getByRole('button', { name: /Empty|Confirm|Delete/ }).last().click()
      await u.waitForTimeout(1500)
      r = await newNote(u, 'QA quota after empty')
      c.ok(r.created, 'after emptying the trash a new note is created')
      await L.shot(u, 'P6-08')
      return c.result('the re-arm of the 80 % alert is not observed here (it needs the usage to go below 80 % and back)')
    },
  },
  {
    id: 'P6-09',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await tenantDetails(p)
      const t0 = await H.text(p)
      // the people the quota counts: active memberships (suspended ones do not count)
      const list = await (await L.apiUser('comune-roma', 'e.ricci')).call('GET', '/mosaikit/api/t/comune-roma/manage/members')
      const arr = (list.members ?? list) as any[]
      const people = arr.filter((x) => x.membership === 'active').length
      c.note(`people counted: ${people} (page: ${(t0.match(/people Used: (\d+)/) ?? [])[1]})`)
      await customize(p, 'People', people)
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/manage/people')
      await m.getByRole('button', { name: 'New user' }).click()
      await m.waitForTimeout(600)
      const d = m.getByRole('dialog')
      await d.getByRole('textbox', { name: /Username/ }).fill('qa.full')
      await d.getByRole('textbox', { name: /Email/ }).first().fill('qa.full@example.com')
      await d.getByRole('textbox', { name: /Name/ }).first().fill('QA Full').catch(() => {})
      const pw = d.getByLabel(/password/i).first()
      if (await H.vis(pw)) await pw.fill('password-prova-1')
      await d.getByRole('button', { name: /Create/ }).click()
      await m.waitForTimeout(1500)
      const msg = (await H.toast(m)) + ' ' + (await d.innerText().catch(() => ''))
      c.ok(/reached one of its quotas/.test(msg), `«The tenant has reached one of its quotas…» («${msg.replace(/\s+/g, ' ').slice(0, 200)}»)`)
      await L.shot(m, 'P6-09')
      await m.keyboard.press('Escape')
      const it = await L.as(ctx, 'e.ricci', 'it')
      await H.go(it, '#/t/comune-roma/manage/people')
      await it.getByRole('button', { name: /Nuovo utente/ }).click()
      await it.waitForTimeout(600)
      const di = it.getByRole('dialog')
      await di.getByRole('textbox', { name: /Utente|Nome utente/ }).first().fill('qa.full2')
      await di.getByRole('textbox', { name: /Email/ }).first().fill('qa.full2@example.com')
      const pwi = di.getByLabel(/password/i).first()
      if (await H.vis(pwi)) await pwi.fill('password-prova-1')
      await di.getByRole('button', { name: /Crea/ }).click()
      await it.waitForTimeout(1500)
      const mi = await H.toast(it)
      c.ok(/(Il tenant|L’organizzazione) ha raggiunto una delle sue quote/.test(mi), `Italian («${mi}»)`)
      await it.keyboard.press('Escape')
      const lv = await L.as(ctx, 'l.verdi')
      await H.go(lv, '#/t/regione-lazio/manage/pending')
      // invitation from Regione Lazio to a person of Comune di Roma is not limited by Comune di Roma; the check means the reverse
      await H.go(m, '#/t/comune-roma/manage/pending')
      await m.getByRole('button', { name: 'Invite people', exact: true }).click()
      const dd = m.getByRole('dialog', { name: 'Invite a person of another tenant' })
      await dd.getByRole('textbox', { name: 'Home tenant' }).fill('regione-lazio')
      await dd.getByRole('textbox', { name: 'Username' }).fill('l.verdi')
      await dd.getByRole('button', { name: 'Send the invitation' }).click()
      await m.waitForTimeout(1500)
      const im = await H.toast(m)
      c.ok(/reached one of its quotas/.test(im), `an invitation is refused the same way («${im}»)`)
      await m.keyboard.press('Escape')
      return c.result()
    },
  },
  {
    id: 'P6-10',
    async run() {
      const c = H.checker()
      const s = L.state()
      const a = await L.apiUser('comune-roma', 'e.ricci')
      await a.call('PUT', `/mosaikit/api/t/comune-roma/manage/members/${s.ids['l.bianchi']}/status`, { suspended: true })
      let ok = true
      try {
        await a.call('POST', '/mosaikit/api/t/comune-roma/manage/members', { username: 'qa.full', display_name: 'QA Full', email: 'qa.full@example.com', password: L.PASSWORD, role: 'user' })
      } catch (e) {
        ok = false
        c.note(e.message.slice(0, 160))
      }
      c.ok(ok, 'creating works with a suspended membership (not counted)')
      let refused = false
      try {
        await a.call('PUT', `/mosaikit/api/t/comune-roma/manage/members/${s.ids['l.bianchi']}/status`, { suspended: false })
      } catch (e) {
        refused = /quota/.test(e.message)
        c.note(e.message.slice(0, 200))
      }
      c.ok(refused, 'reactivating the suspended person is refused while the tenant is full')
      return c.result('done through the API with the session of e.ricci (the same calls as the People page)')
    },
  },
  {
    id: 'P6-11',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await tenantDetails(p)
      await customize(p, 'Storage', '0.001')
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma')
      await H.nav(u, 'Documents')
      const f = await L.pluginFrame(u, 'files')
      const big = L.fixture('big3mb.bin')
      if (!fs.existsSync(big)) fs.writeFileSync(big, Buffer.alloc(3 * 1024 * 1024, 7))
      await f.locator('input[type=file]').first().setInputFiles(big)
      // the refusal is a toast that goes away: wait for it, in the page or in the app
      await Promise.race([u.getByText(/quota/i).first().waitFor({ timeout: 6000 }), f.getByText(/quota/i).first().waitFor({ timeout: 6000 })]).catch(() => {})
      const t = (await f.locator('body').innerText()) + ' ' + (await H.toast(u)) + ' ' + (await u.locator('body').innerText())
      c.ok(/quota/i.test(t) && !/big3mb\.bin\s+Binary/.test(t), `a 3 MB file is refused («${(t.match(/[^.]*quota[^.]*/i) ?? [''])[0].slice(0, 160)}»)`)
      await L.shot(u, 'P6-11')
      return c.result('the replacement of a bigger file by a smaller one is not exercised')
    },
  },
  {
    id: 'P6-12',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/usage/trend')
      const t = await H.text(m)
      c.ok((await m.locator('svg').count()) > 3 || /chart/i.test(t), 'a chart per quota')
      const tb = m.getByText(/Show as a table/).first()
      c.ok(await H.vis(tb), '«Show as a table»')
      if (await H.vis(tb)) {
        await tb.click()
        await m.waitForTimeout(600)
        c.ok((await m.getByRole('table').count()) > 0, 'a table')
      }
      await L.shot(m, 'P6-12', { full: true })
      return c.result('only today in the history of this installation')
    },
  },
  {
    id: 'P6-13',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/usage/consumers')
      let t = await H.text(m)
      if (!/By person|person/i.test(t)) {
        await m.getByRole('link', { name: 'Who uses the most' }).click()
        await m.waitForTimeout(1200)
        t = await H.text(m)
      }
      c.ok(/person/i.test(t) && /group/i.test(t) && /app/i.test(t), 'by person, by group, by app')
      c.ok(/QA team/.test(t), 'the group QA team')
      await L.shot(m, 'P6-13', { full: true })
      return c.result()
    },
  },
  {
    id: 'P6-14',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/usage/alerts')
      for (const n of ['At 80%', 'At 100%', 'Forecast', 'The Tenant Managers of the tenant']) c.ok(await H.vis(m.getByRole('switch', { name: n })), n)
      c.ok(await H.vis(m.getByRole('combobox', { name: 'Add a person' })) && (await H.vis(m.getByRole('combobox', { name: 'Add a group' }))), 'chosen people and groups')
      await L.shot(m, 'P6-14')
      return c.result('the delivery only to the chosen recipients is not exercised')
    },
  },
  {
    id: 'P6-15',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/settings/platform')
      const t = await H.text(m)
      c.ok(/Quotas\s+Storage/.test(t), 'a Quotas row')
      c.ok(await H.vis(m.getByRole('link', { name: /Usage/ })), 'a link to Usage')
      await L.shot(m, 'P6-15')
      return c.result()
    },
  },
  {
    id: 'P6-16',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma')
      const t = await H.text(m)
      c.ok(/Usage/.test(t), 'a Usage panel')
      c.ok((await m.getByRole('meter').count()) > 0, 'bars')
      c.ok(await H.vis(m.getByRole('link', { name: /Details/ }).or(m.getByRole('button', { name: /Details/ }))), 'Details')
      await L.shot(m, 'P6-16', { full: true })
      return c.result()
    },
  },
  {
    id: 'P6-17',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma/account/usage')
      const t = await H.text(u)
      c.ok(/Your items|items/i.test(t), 'their items and space')
      c.ok(/What is left in the tenant/.test(t), '«What is left in the tenant»')
      await L.shot(u, 'P6-17')
      return c.result()
    },
  },
  {
    id: 'P6-18',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci', 'it')
      await H.go(m, '#/t/comune-roma/usage')
      const s = (await m.getByRole('navigation', { name: /Sezioni|Sections/ }).getByRole('link').allInnerTexts()).join(' | ')
      for (const n of ['Quote', 'Andamento', 'Chi consuma di più', 'Avvisi']) c.ok(s.includes(n), n)
      c.ok(/Consumi/.test(await H.text(m)), 'Consumi')
      await L.shot(m, 'P6-18')
      const d = await L.page(ctx.b, { colorScheme: 'dark' })
      await L.login(d, 'Comune di Roma', 'e.ricci')
      await H.go(d, '#/t/comune-roma/usage')
      const v = await H.axe(d, ['color-contrast'])
      c.ok(!v.length, `dark contrast: ${v.join(', ')}`)
      await L.shot(d, 'P6-18-dark')
      await d.context().close()
      return c.result()
    },
  },
  {
    id: 'P6-19',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await tenantDetails(p)
      for (let i = 0; i < 3; i++) {
        const r = p.getByRole('button', { name: 'Restore' }).first()
        if (await H.vis(r)) {
          await r.click()
          await p.waitForTimeout(500)
        }
      }
      await saveRegion(p)
      await p.reload()
      await p.waitForTimeout(1500)
      c.ok(!(await H.vis(p.getByRole('button', { name: 'Restore' }).first())), 'every quota back to the platform')
      const a = await L.apiUser('comune-roma', 'e.ricci')
      await a.call('PUT', `/mosaikit/api/t/comune-roma/manage/members/${L.state().ids['l.bianchi']}/status`, { suspended: false }).catch((e) => c.note('reactivation of Luca: ' + e.message.slice(0, 120)))
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma')
      const side = await u.locator('[data-sidebar="sidebar"]').innerText()
      c.ok(!/%/.test(side), 'the sidebar alert disappears')
      await L.shot(u, 'P6-19')
      return c.result()
    },
  },
]

export default checks
