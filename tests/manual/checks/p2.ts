// Step 1b — Plugins in English and Italian; Phase 2 — Notifications
// Converted from the QA walkthrough; one entry per check id of docs/manual-tests.md.
import * as H from '../h.ts'
import * as L from '../lib.ts'


async function bellCount(p: any) {
  const n = await p.getByRole('button', { name: /^Notifications|^Notifiche/ }).first().getAttribute('aria-label').catch(() => '')
  const badge = await p.getByRole('button', { name: /^Notifications|^Notifiche/ }).first().innerText().catch(() => '')
  return { label: n ?? '', badge: badge.trim() }
}

const checks: L.Check[] = [
  {
    id: 'P1b-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      await H.go(p, '#/t/comune-roma')
      const side = (await p.locator('[data-sidebar="sidebar"]').getByRole('link').allInnerTexts()).map((s) => s.trim())
      for (const n of ['Notes', 'Tasks', 'Contacts', 'Documents', 'Maps', 'Tools']) c.ok(side.includes(n), n)
      await H.nav(p, 'Tasks')
      const f = await L.pluginFrame(p, 'tasks')
      const t = await f.locator('body').innerText()
      c.ok(/New task|Title|Priority|Due/i.test(t), `Tasks page in English («${t.slice(0, 80).replace(/\s+/g, ' ')}»)`)
      await L.shot(p, 'P1b-01')
      return c.result()
    },
  },
  {
    id: 'P1b-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      await H.go(p, '#/t/comune-roma')
      await p.getByRole('button', { name: /Language/ }).click()
      await p.getByRole('menuitemradio', { name: 'Italiano' }).or(p.getByRole('menuitem', { name: 'Italiano' })).or(p.getByRole('option', { name: 'Italiano' })).first().click()
      await p.waitForTimeout(1500)
      const side = (await p.locator('[data-sidebar="sidebar"]').getByRole('link').allInnerTexts()).map((s) => s.trim())
      c.ok(side.includes('Note') && side.includes('Attività'), `sidebar in Italian (${side.join(', ')})`)
      await p.locator('[data-sidebar="sidebar"]').getByRole('link', { name: 'Note', exact: true }).click()
      const f = await L.pluginFrame(p, 'notes')
      const t = await f.locator('body').innerText()
      c.ok(/Titolo/.test(t), 'fields in Italian (Titolo)')
      c.ok(/personale|lavoro/.test(t), 'choice values in Italian (personale, lavoro)')
      await L.shot(p, 'P1b-02')
      return c.result('switched from the language menu of the top bar, no new sign-in')
    },
  },
  {
    id: 'P1b-03',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      let f = await L.pluginFrame(p, 'notes')
      await f.getByRole('button', { name: /Nuova nota/ }).click()
      await f.getByRole('textbox', { name: /Titolo/ }).fill('QA tag note')
      await f.getByRole('combobox', { name: 'Tag' }).selectOption({ label: 'urgente' }).catch(async () => f.getByRole('combobox', { name: 'Tag' }).selectOption({ index: 3 }))
      await f.getByRole('button', { name: 'Salva' }).click()
      await p.waitForTimeout(1500)
      const it = await f.locator('.msk-item').filter({ hasText: /QA tag note/ }).innerText()
      c.ok(/urgente/.test(it), `tag in Italian («${it.replace(/\s+/g, ' ')}»)`)
      await L.shot(p, 'P1b-03-it')
      await p.getByRole('button', { name: /Lingua|Language/ }).click()
      await p.getByRole('menuitemradio', { name: 'English' }).or(p.getByRole('menuitem', { name: 'English' })).or(p.getByRole('option', { name: 'English' })).first().click()
      await p.waitForTimeout(2000)
      f = await L.pluginFrame(p, 'notes')
      const en = await f.locator('.msk-item').filter({ hasText: /QA tag note/ }).innerText()
      c.ok(/urgent/.test(en) && !/urgente/.test(en), `tag in English after the switch («${en.replace(/\s+/g, ' ')}»)`)
      await L.shot(p, 'P1b-03-en')
      return c.result()
    },
  },
  {
    id: 'P2-01',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma')
      ctx.data.bell0 = await bellCount(u)
      const m = await L.as(ctx, 'l.verdi')
      await H.go(m, '#/t/regione-lazio/manage/pending')
      await m.getByRole('button', { name: 'Invite' }).click()
      const d = m.getByRole('dialog', { name: 'Invite a person of another tenant' })
      await d.getByRole('textbox', { name: 'Home tenant' }).fill('comune-roma')
      await d.getByRole('textbox', { name: 'Username' }).fill('s.greco')
      await d.getByRole('button', { name: 'Send the invitation' }).click()
      await m.waitForTimeout(1500)
      const t = await H.toast(m)
      c.ok(/sent|invit/i.test(t), `invitation sent («${t}»)`)
      await L.shot(m, 'P2-01')
      return c.result('DOC: the invitation is in Manage › Pending › Invite, not in Manage › People')
    },
  },
  {
    id: 'P2-02',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      let after
      for (let i = 0; i < 15; i++) {
        after = await bellCount(u)
        if (after.label !== ctx.data.bell0.label || after.badge !== ctx.data.bell0.badge) break
        await u.waitForTimeout(1000)
      }
      c.ok(after.label !== ctx.data.bell0.label || after.badge !== ctx.data.bell0.badge, `the bell changes by itself (before «${ctx.data.bell0.label}» «${ctx.data.bell0.badge}», after «${after.label}» «${after.badge}»)`)
      await L.shot(u, 'P2-02')
      return c.result()
    },
  },
  {
    id: 'P2-03',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await u.getByRole('button', { name: /^Notifications/ }).first().click()
      await u.waitForTimeout(800)
      const panel = u.getByRole('dialog').first()
      const t = await panel.innerText().catch(() => '')
      c.ok(/Regione Lazio/.test(t), 'the invitation')
      c.ok(await H.vis(panel.getByRole('button', { name: 'Accept' })), 'Accept')
      c.ok(await H.vis(panel.getByRole('button', { name: 'Decline' })), 'Decline')
      c.ok(await H.vis(panel.getByRole('button', { name: /Mark all as read/ })), 'Mark all as read')
      c.ok((await panel.getByRole('link').or(panel.getByRole('button')).filter({ hasText: '' }).count()) > 0, 'a gear')
      c.ok(await H.vis(panel.getByRole('link', { name: /See all/ }).or(panel.getByRole('button', { name: /See all/ }))), 'See all')
      await L.shot(u, 'P2-03')
      return c.result()
    },
  },
  {
    id: 'P2-04',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      const panel = u.getByRole('dialog').first()
      await panel.getByRole('button', { name: 'Accept' }).click()
      await u.waitForTimeout(1500)
      await H.closeMenus(u)
      await u.reload()
      await u.waitForTimeout(2000)
      const sw = u.getByRole('button', { name: /Switch tenant|Tenant:/ }).first()
      if (await H.vis(sw)) {
        await sw.click()
        await u.waitForTimeout(500)
        c.ok(await H.vis(u.getByRole('menuitem', { name: /Regione Lazio/ }).or(u.getByRole('option', { name: /Regione Lazio/ }))), 'Regione Lazio in the tenant switcher')
        await L.shot(u, 'P2-04-switch')
        await H.closeMenus(u)
      } else c.ok(false, 'a tenant switcher')
      const m = await L.as(ctx, 'l.verdi')
      let lab
      for (let i = 0; i < 10; i++) {
        lab = (await bellCount(m)).label
        if (/\d/.test(lab) && !/, 0/.test(lab)) break
        await m.waitForTimeout(1000)
      }
      await m.getByRole('button', { name: /^Notifications/ }).first().click()
      await m.waitForTimeout(800)
      const t = await m.getByRole('dialog').first().innerText().catch(() => '')
      c.ok(/Sara Greco/.test(t) && /accept/i.test(t), `l.verdi notified of the answer («${t.replace(/\s+/g, ' ').slice(0, 120)}»)`)
      await L.shot(m, 'P2-04')
      await H.closeMenus(m)
      return c.result()
    },
  },
  {
    id: 'P2-05',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma')
      await H.nav(u, 'Notes')
      const f = await L.pluginFrame(u, 'notes')
      await f.locator('.msk-item').filter({ hasText: /Meeting notes/ }).click()
      await u.waitForTimeout(800)
      await f.getByRole('button', { name: 'Share…' }).click()
      const d = u.getByRole('dialog', { name: 'Sharing' })
      await d.getByRole('searchbox', { name: /Search people or groups/ }).fill('Luca')
      await u.waitForTimeout(800)
      await u.getByRole('option', { name: /Luca Bianchi/ }).first().click()
      await d.getByRole('button', { name: 'Share', exact: true }).click()
      await u.waitForTimeout(1200)
      await u.keyboard.press('Escape')
      const b = await L.as(ctx, 'l.bianchi')
      await H.go(b, '#/t/comune-roma')
      await b.getByRole('button', { name: /^Notifications/ }).first().click()
      await b.waitForTimeout(800)
      const panel = b.getByRole('dialog').first()
      const t = await panel.innerText()
      c.ok(/Meeting notes/.test(t), 'notification of the share')
      await L.shot(b, 'P2-05')
      await panel.getByText(/Meeting notes/).first().click()
      await b.waitForTimeout(2500)
      c.ok(/com\.mosaikit\.notes|item\//.test(b.url()), `the link opens the item (${b.url()})`)
      await L.shot(b, 'P2-05-open')
      return c.result()
    },
  },
  {
    id: 'P2-06',
    async run(ctx: any) {
      const c = H.checker()
      // Sara shared «Meeting notes» with Luca with Read: give Manage? simpler: Luca has no rights to create links; use the reverse:
      // Luca shares an own note with Sara at Manage level, Sara creates a public link, Luca (owner) is notified.
      const b = await L.as(ctx, 'l.bianchi')
      await H.go(b, '#/t/comune-roma')
      await H.nav(b, 'Notes')
      let f = await L.pluginFrame(b, 'notes')
      await f.getByRole('button', { name: /New note/ }).click()
      await f.getByRole('textbox', { name: 'Title *' }).fill('QA note of Luca')
      await f.getByRole('button', { name: 'Save' }).click()
      await b.waitForTimeout(1200)
      f = await H.openNote(b, 'QA note of Luca')
      await f.getByRole('button', { name: 'Share…' }).click()
      const d = b.getByRole('dialog', { name: 'Sharing' })
      await d.getByRole('searchbox', { name: /Search people or groups/ }).fill('Sara')
      await b.waitForTimeout(800)
      await b.getByRole('option', { name: /Sara Greco/ }).first().click()
      await d.getByRole('combobox', { name: 'Level' }).click()
      await b.getByRole('option', { name: 'Manage' }).click()
      await d.getByRole('button', { name: 'Share', exact: true }).click()
      await b.waitForTimeout(1000)
      await b.keyboard.press('Escape')
      const u = await L.as(ctx, 's.greco')
      f = await H.openNote(u, 'QA note of Luca')
      await f.getByRole('button', { name: 'Share…' }).click()
      const d2 = u.getByRole('dialog', { name: 'Sharing' })
      await d2.getByRole('button', { name: 'Create link' }).click()
      await u.waitForTimeout(1500)
      await u.keyboard.press('Escape')
      await H.go(b, '#/t/comune-roma')
      await b.waitForTimeout(1500)
      await b.getByRole('button', { name: /^Notifications/ }).first().click()
      await b.waitForTimeout(800)
      const t = await b.getByRole('dialog').first().innerText()
      c.ok(/public link/i.test(t) && /QA note of Luca/.test(t), `the owner is notified («${t.replace(/\s+/g, ' ').slice(0, 160)}»)`)
      await L.shot(b, 'P2-06')
      await H.closeMenus(b)
      return c.result()
    },
  },
  {
    id: 'P2-07',
    async run(ctx: any) {
      const c = H.checker()
      const b = await L.as(ctx, 'l.bianchi')
      await H.go(b, '#/t/comune-roma/notifications')
      const t = await H.text(b)
      c.ok(/Unread/.test(t), 'Unread filter')
      c.ok((await b.getByRole('combobox').count()) >= 1 || /Kind|Period/.test(t), 'kind / period')
      c.ok(await H.vis(b.getByRole('searchbox')), 'search')
      const cb = b.getByRole('checkbox').first()
      if (await H.vis(cb)) {
        await cb.check()
        await b.waitForTimeout(500)
        const tt = await H.text(b)
        c.ok(/Mark as read|Delete/.test(tt), 'selection with mark read / delete')
        await L.shot(b, 'P2-07-sel')
        await cb.uncheck()
      } else c.ok(false, 'selection')
      await L.shot(b, 'P2-07')
      return c.result()
    },
  },
  {
    id: 'P2-08',
    async run(ctx: any) {
      const c = H.checker()
      const b = await L.as(ctx, 'l.bianchi')
      await H.go(b, '#/t/comune-roma')
      await b.getByRole('button', { name: /^Notifications/ }).first().click()
      await b.waitForTimeout(600)
      await b.getByRole('dialog').first().getByRole('button', { name: /Mark all as read/ }).click()
      await b.waitForTimeout(1200)
      await H.closeMenus(b)
      const n = await bellCount(b)
      c.ok(!/\d/.test(n.badge), `the badge disappears (label «${n.label}», badge «${n.badge}»)`)
      await L.shot(b, 'P2-08')
      return c.result()
    },
  },
  {
    id: 'P2-09',
    async run(ctx: any) {
      const c = H.checker()
      const b = await L.as(ctx, 'l.bianchi')
      await H.closeMenus(b)
      await H.go(b, '#/t/comune-roma/account/notifications')
      await H.closeMenus(b)
      await L.shot(b, 'P2-09-before', { full: true })
      const t = await H.text(b)
      c.ok(/In the app|In-app/i.test(t) && /Email/i.test(t), 'in-app and email per kind')
      const sel = b.getByRole('combobox').first()
      await sel.click()
      await b.waitForTimeout(300)
      const opts = (await b.getByRole('option').allInnerTexts()).map((s) => s.trim())
      c.ok(opts.some((o) => /Never|Off|No email/i.test(o)) && opts.some((o) => /At once|Immediately|as soon/i.test(o)) && opts.some((o) => /day/i.test(o)), `email off / immediately / daily (${opts.join(' | ')})`)
      await b.getByRole('option').filter({ hasText: /At once|Immediately|as soon/i }).first().click().catch(() => {})
      await b.waitForTimeout(800)
      const sb = b.getByRole('button', { name: 'Save', exact: true })
      if (await H.vis(sb)) await sb.last().click()
      await b.waitForTimeout(1000)
      const v1 = await sel.innerText()
      await b.reload()
      await b.waitForTimeout(2000)
      const v2 = await b.getByRole('combobox').first().innerText()
      c.ok(v1 === v2 && !/Default/.test(v2), `saved after reload («${v1}» → «${v2}»)`)
      await L.shot(b, 'P2-09')
      return c.result()
    },
  },
  {
    id: 'P2-10',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/email')
      const t = await H.text(p)
      for (const n of ['SMTP server', 'Port', 'TLS', 'User', 'Password', 'Sender', 'Footer']) c.ok(new RegExp(n, 'i').test(t), n)
      await L.shot(p, 'P2-10-form', { full: true })
      const host = p.getByRole('textbox', { name: /SMTP server/ })
      await host.fill('127.0.0.1')
      await p.getByRole('spinbutton', { name: /Port/ }).fill('2599').catch(() => {})
      const pw = p.getByLabel(/^Password/).first()
      await pw.fill('smtp-secret-QA42').catch(() => {})
      await p.getByRole('textbox', { name: /Sender/ }).fill('Mosaikit QA <qa@example.org>').catch(() => {})
      const sb = p.getByRole('button', { name: 'Save', exact: true })
      if (await H.vis(sb)) await sb.last().click()
      await p.waitForTimeout(1500)
      await p.reload()
      await p.waitForTimeout(2000)
      const t2 = await H.text(p)
      c.ok(!/smtp-secret-QA42/.test(t2) && !(await p.locator('input[value="smtp-secret-QA42"]').count()), 'password masked after saving')
      const test = p.getByRole('button', { name: /Send a test/i })
      if (await H.vis(test)) {
        await p.getByRole('textbox', { name: 'To', exact: true }).fill('qa@example.org')
        await test.click()
        await p.waitForTimeout(6000)
        // the failure must be told where the person looks (a toast or an alert of the page), in the language of
        // the interface, never as a raw system message
        const m = ((await H.toast(p)) + ' ' + (await p.getByRole('alert').allInnerTexts()).join(' ')).trim()
        c.ok(m.length > 5, `the failure is shown (toast or alert: «${m.slice(0, 160)}»)`)
        c.ok(!/\b5\d\d\b|os error|impossibile|connessione|rifiutata/i.test(m), `no raw system or status text («${m.slice(0, 160)}»)`)
      } else c.ok(false, 'test message')
      await L.shot(p, 'P2-10', { full: true })
      return c.result('no mail server on 127.0.0.1:2599: the failure path only (a local catcher is not available)')
    },
  },
  {
    id: 'P2-11',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.page(ctx.b, { colorScheme: 'dark' })
      await L.login(p, 'Comune di Roma', 's.greco')
      await p.getByRole('button', { name: /^Notifications/ }).first().click()
      await p.waitForTimeout(800)
      const v1 = await H.axe(p, ['color-contrast'])
      await L.shot(p, 'P2-11-panel')
      await H.closeMenus(p)
      await H.go(p, '#/t/comune-roma/notifications')
      const v2 = await H.axe(p, ['color-contrast'])
      await L.shot(p, 'P2-11')
      c.ok(!v1.length && !v2.length, `contrast (panel: ${v1.join(', ')}; page: ${v2.join(', ')})`)
      await p.context().close()
      return c.result()
    },
  },
]

export default checks
