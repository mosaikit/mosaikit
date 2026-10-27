// Follow-ups A and B, then P8-14 (Prova OIDC back to local accounts)
// Converted from the QA walkthrough; one entry per check id of docs/manual-tests.md.
import * as H from '../h.ts'
import * as L from '../lib.ts'

const IDP = L.IDP

async function signinTab(p: any, name: any = 'Prova OIDC') {
  await H.go(p, '#/admin/tenants')
  await p.getByRole('link', { name }).first().click()
  await p.waitForTimeout(1200)
  await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: /^Sign-in/ }).click()
  await p.waitForTimeout(1200)
}
async function saveRegion(p: any) {
  const r = p.getByRole('region', { name: 'Unsaved changes' })
  if (await H.vis(r)) {
    await r.getByRole('button', { name: 'Save' }).click()
    await p.waitForTimeout(900)
    const cf = p.getByRole('alertdialog').or(p.getByRole('dialog'))
    if (await H.vis(cf)) await cf.getByRole('button', { name: /Continue|Confirm|Save/ }).last().click()
    await p.waitForTimeout(1300)
  }
}
async function viaProvider(b: any, who: any, slug: any = 'prova-oidc') {
  const q = await L.page(b)
  await L.fresh(q, `#/login/${slug}`)
  const btn = q.getByRole('link', { name: /Sign in with/ }).or(q.getByRole('button', { name: /Sign in with/ }))
  await btn.waitFor({ timeout: 20000 })
  await btn.click()
  await q.waitForTimeout(2000)
  await q.getByRole('button', { name: `Sign in as ${who}` }).click()
  await q.waitForTimeout(3500)
  return q
}

const checks: L.Check[] = [
  {
    id: 'FU-A-01',
    async run() {
      return { status: 'NOT VERIFIABLE', note: 'needs `cargo xtask release docker` and a running compose: Docker must not be touched in this walkthrough' }
    },
  },
  {
    id: 'FU-A-02',
    async run(ctx: any) {
      const c = H.checker()
      const s = L.state()
      const m = await L.apiUser('comune-roma', 'e.ricci')
      const profiles = await m.call('GET', '/mosaikit/api/t/comune-roma/manage/profiles')
      const reader = (profiles.profiles ?? profiles).find((x) => x.name === 'Reader')
      await m.call('PUT', `/mosaikit/api/t/comune-roma/manage/members/${s.ids['l.bianchi']}/profile`, { profile: reader.id })
      for (const lang of ['en', 'it']) {
        const u = await L.page(ctx.b)
        await L.login(u, 'Comune di Roma', 'l.bianchi', L.PASSWORD, lang)
        await H.go(u, '#/t/comune-roma/p/com.mosaikit.notes')
        const f = await L.pluginFrame(u, 'notes')
        await f.getByRole('button', { name: lang === 'it' ? /Nuova nota/ : /New note/ }).click()
        await f.getByRole('textbox', { name: lang === 'it' ? /Titolo/ : 'Title *' }).fill('QA FU-A-02')
        await f.getByRole('button', { name: lang === 'it' ? 'Salva' : 'Save' }).click()
        await u.waitForTimeout(1500)
        const t = await f.locator('body').innerText()
        const msg = (t.match(lang === 'it' ? /[^\n]*(profilo|permess)[^\n]*/i : /[^\n]*permission profile[^\n]*/i) ?? [''])[0]
        c.ok(!!msg && !/[a-z]+_[a-z_]+/.test(msg), `${lang}: translated message, no code («${msg}»)`)
        await L.shot(u, 'FU-A-02-' + lang)
        await u.context().close()
      }
      await m.call('PUT', `/mosaikit/api/t/comune-roma/manage/members/${s.ids['l.bianchi']}/profile`, { profile: null })
      return c.result(`l.bianchi on the profile Reader (no personal grant) during the check, then back to the default profile`)
    },
  },
  {
    id: 'FU-A-03',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma')
      await H.nav(u, 'Contacts')
      const f = await L.pluginFrame(u, 'contacts')
      await f.getByRole('button', { name: /New/ }).first().click()
      await u.waitForTimeout(500)
      const tb = f.getByRole('textbox')
      await tb.first().fill('QA Contact')
      const em = f.getByRole('textbox', { name: /mail/i })
      await em.fill('x')
      await f.getByRole('button', { name: 'Save' }).click()
      await u.waitForTimeout(1500)
      const t = await f.locator('body').innerText()
      c.ok(/invalid email: x/i.test(t), `«invalid email: x» (${(t.match(/[^\n]*(invalid|Invalid)[^\n]*/) ?? [''])[0]})`)
      c.ok(!/Invalid request/.test(t), 'not «Invalid request»')
      await L.shot(u, 'FU-A-03')
      return c.result()
    },
  },
  {
    id: 'FU-A-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await signinTab(p)
      const t = await H.text(p)
      c.ok(/Front-channel logout address/.test(t) && /frontchannel-logout/.test(t), 'Front-channel logout address')
      await p.getByRole('button', { name: 'Check the configuration' }).click()
      await p.waitForTimeout(3500)
      const r = (await p.getByRole('list', { name: 'Result of the check' }).innerText().catch(() => '')) || (await H.text(p))
      c.ok(/Front-channel logout/.test(r), 'a line «Front-channel logout»')
      await L.shot(p, 'FU-A-04', { full: true })
      return c.result()
    },
  },
  {
    id: 'FU-A-05',
    async run(ctx: any) {
      const c = H.checker()
      const q = await viaProvider(ctx.b, 'Anna Rossi')
      const t2 = await q.context().newPage()
      await t2.goto(IDP + '/logout')
      await t2.waitForTimeout(4000)
      const fr = t2.frames().map((f) => f.url())
      let inner = ''
      for (const f of t2.frames()) inner += await f.locator('body').innerText().catch(() => '')
      c.ok(/Signed out/.test(inner), '«Signed out» page of the provider')
      c.ok(/Signed out of Mosaikit/.test(inner), `a frame «Signed out of Mosaikit.» (frames: ${fr.join(', ').slice(0, 200)})`)
      await L.shot(t2, 'FU-A-05-idp')
      await q.reload()
      await q.waitForTimeout(2500)
      c.ok(await H.vis(q.getByRole('link', { name: /Sign in with/ }).or(q.getByRole('button', { name: /Sign in/ }))), 'a reload shows the sign-in page')
      await L.shot(q, 'FU-A-05')
      await q.context().close()
      return c.result()
    },
  },
  {
    id: 'FU-A-06',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await signinTab(p)
      const sw = p.getByRole('switch', { name: /Groups of the provider in Mosaikit/ })
      if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click()
      await p.waitForTimeout(400)
      const pre = p.getByLabel('Only the groups starting with')
      if (await H.vis(pre)) await pre.fill('')
      await saveRegion(p)
      c.ok(/saved/i.test(await H.toast(p)) || (await sw.getAttribute('aria-checked')) === 'true', 'saved')
      await L.shot(p, 'FU-A-06', { full: true })
      return c.result()
    },
  },
  {
    id: 'FU-A-07',
    async run(ctx: any) {
      const c = H.checker()
      const b = await viaProvider(ctx.b, 'Bruno Neri')
      await b.context().close()
      const a = await viaProvider(ctx.b, 'Anna Rossi')
      await H.go(a, '#/t/prova-oidc/manage/groups')
      const t = await H.text(a)
      for (const g of ['staff', 'mosaikit-managers', 'mosaikit-users']) c.ok(t.includes(g), g)
      c.ok(/From the identity provider/.test(t), '«From the identity provider»')
      // the groups are cards: «staff», its badge and «2 members»
      const row = (t.match(/staff\s+From the identity provider\s+(\d+ members?)/) ?? [])[1] ?? ''
      c.ok(/^2 members/.test(row), `staff has Anna and Bruno («${row}»)`)
      c.ok(!(await H.vis(a.getByRole('button', { name: /Delete/ }))), 'no delete')
      await L.shot(a, 'FU-A-07')
      ctx.pages['anna'] = a
      return c.result()
    },
  },
  {
    id: 'FU-A-08',
    async run(ctx: any) {
      const c = H.checker()
      const a = ctx.pages['anna']
      await a.getByRole('link', { name: 'staff' }).first().click()
      await a.waitForTimeout(1200)
      const t = await H.text(a)
      c.ok(/From the identity provider/.test(t), 'badge')
      c.ok(!(await H.vis(a.getByRole('button', { name: 'Add a member' }))), 'no «Add a member»')
      await a.getByRole('button', { name: 'More actions' }).click().catch(() => {})
      await a.waitForTimeout(300)
      const items = (await a.getByRole('menuitem').allInnerTexts()).join(' | ')
      await H.closeMenus(a)
      c.ok(!/Delete the group/.test(items), `no «Delete the group» (${items})`)
      c.ok(!(await H.vis(a.getByRole('button', { name: /^Remove/ }))), 'no Remove')
      await L.shot(a, 'FU-A-08')
      return c.result()
    },
  },
  {
    id: 'FU-A-09',
    async run(ctx: any) {
      const c = H.checker()
      const a = ctx.pages['anna']
      await H.go(a, '#/t/prova-oidc')
      await H.nav(a, 'Notes')
      const f = await L.pluginFrame(a, 'notes')
      await f.getByRole('button', { name: /New note/ }).click()
      await f.getByRole('textbox', { name: 'Title *' }).fill('QA note for staff')
      await f.getByRole('button', { name: 'Save' }).click()
      await a.waitForTimeout(1500)
      const ff = await H.openNote(a, 'QA note for staff')
      await ff.getByRole('button', { name: 'Share…' }).click()
      const d = a.getByRole('dialog', { name: 'Sharing' })
      await d.getByRole('searchbox', { name: /Search people or groups/ }).fill('staff')
      await a.waitForTimeout(900)
      await a.getByRole('option', { name: /staff/ }).first().click()
      await d.getByRole('button', { name: 'Share', exact: true }).click()
      await a.waitForTimeout(1000)
      await a.keyboard.press('Escape')
      const b = await viaProvider(ctx.b, 'Bruno Neri')
      await H.go(b, '#/t/prova-oidc')
      await H.nav(b, 'Notes')
      const fb = await L.pluginFrame(b, 'notes')
      c.ok(await H.vis(fb.getByRole('row', { name: /QA note for staff/ })), 'Bruno sees the note')
      await L.shot(b, 'FU-A-09')
      await b.context().close()
      return c.result()
    },
  },
  {
    id: 'FU-A-10',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await signinTab(p)
      await p.getByLabel('Only the groups starting with').fill('mosaikit-')
      await saveRegion(p)
      const b = await viaProvider(ctx.b, 'Bruno Neri')
      await b.context().close()
      const a = await viaProvider(ctx.b, 'Anna Rossi').catch(() => null)
      const viewer = ctx.pages['anna'] && !ctx.pages['anna'].isClosed() ? ctx.pages['anna'] : a
      await H.go(viewer, '#/t/prova-oidc/manage/groups')
      const t = await H.text(viewer)
      c.ok(/staff/.test(t), 'staff stays')
      await viewer.getByRole('link', { name: 'staff' }).first().click()
      await viewer.waitForTimeout(1000)
      const st = await H.text(viewer)
      c.ok(!/Bruno Neri/.test(st), 'Bruno leaves staff')
      await L.shot(viewer, 'FU-A-10-staff')
      await H.go(viewer, '#/t/prova-oidc/manage/groups')
      await viewer.getByRole('link', { name: 'mosaikit-users' }).first().click()
      await viewer.waitForTimeout(1000)
      c.ok(/Bruno Neri/.test(await H.text(viewer)), 'he stays in mosaikit-users')
      await L.shot(viewer, 'FU-A-10')
      return c.result('Anna signed in again too, so she also leaves staff (the check expects her to stay until her next sign-in)')
    },
  },
  {
    id: 'FU-A-11',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/tenants')
      if (!/Prova OIDC 2/.test(await H.text(p))) {
        await p.getByRole('button', { name: 'New tenant' }).click()
        const d = p.getByRole('dialog', { name: 'New tenant' })
        await d.getByLabel('Name', { exact: true }).fill('Prova OIDC 2')
        await d.getByLabel('Identifier').fill('prova-oidc2')
        await d.getByRole('button', { name: 'Next' }).click()
        await d.getByRole('button', { name: 'Next' }).click()
        await d.getByLabel('Username of the Tenant Manager').fill('manager2')
        await d.getByLabel('Email of the Tenant Manager').fill('manager2@example.com')
        await d.getByLabel('Initial password').fill(L.PASSWORD)
        await d.getByRole('button', { name: 'Next' }).click()
        await d.getByRole('button', { name: 'Create the tenant' }).click()
        await p.waitForTimeout(2500)
      }
      const m = await L.apiUser('prova-oidc2', 'manager2')
      await m.call('POST', '/mosaikit/api/t/prova-oidc2/manage/groups', { name: 'staff' }).catch((e) => c.note('group: ' + e.message.slice(0, 100)))
      await signinTab(p, 'Prova OIDC 2')
      await p.getByRole('radio', { name: /Identity provider \(OIDC\)/ }).click()
      await p.getByLabel('Address of the provider (issuer)').fill(IDP)
      await p.getByLabel('Client id').fill('mosaikit')
      await p.getByLabel('Client secret').fill('fake-secret')
      await p.getByRole('radio', { name: /Groups of the identity provider/ }).click()
      await p.getByLabel('Groups of the Tenant Managers').fill('mosaikit-managers')
      await p.getByLabel('Groups of the Users').fill('mosaikit-users')
      const sw = p.getByRole('switch', { name: /Groups of the provider in Mosaikit/ })
      if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click()
      await saveRegion(p)
      const b = await viaProvider(ctx.b, 'Bruno Neri', 'prova-oidc2')
      await b.context().close()
      const a = await viaProvider(ctx.b, 'Anna Rossi', 'prova-oidc2')
      await H.go(a, '#/t/prova-oidc2/manage/groups')
      const t = await H.text(a)
      c.ok(/staff \(identity provider\)/.test(t), '«staff (identity provider)»')
      c.ok(/\bstaff\b(?! \()/.test(t), 'the group of Mosaikit stays as it was')
      await L.shot(a, 'FU-A-11')
      await a.context().close()
      return c.result()
    },
  },
  {
    id: 'FU-A-12',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin', 'it')
      await H.go(p, '#/admin/tenants')
      await p.getByRole('link', { name: 'Prova OIDC' }).first().click()
      await p.waitForTimeout(1000)
      await p.getByRole('link', { name: /^Accesso/ }).last().click()
      await p.waitForTimeout(1200)
      const t = await H.text(p)
      const en = ['Groups of the provider in Mosaikit', 'Only the groups starting with', 'Front-channel logout address'].filter((w) => t.includes(w))
      c.ok(!en.length, `Sign-in tab in Italian (English left: ${en.join(', ')})`)
      const q = await viaProvider(ctx.b, 'Anna Rossi')
      await q.evaluate(() => localStorage.setItem('msk_lang', 'it'))
      await H.go(q, '#/t/prova-oidc/manage/groups')
      await q.reload()
      await q.waitForTimeout(2000)
      c.ok(/Dal provider di identità|provider di identità/i.test(await H.text(q)), 'Manage › Groups in Italian')
      await L.shot(q, 'FU-A-12-it')
      await q.context().close()
      const d = await L.page(ctx.b, { colorScheme: 'dark' })
      await L.adminLogin(d)
      await signinTab(d)
      const v = await H.axe(d, ['color-contrast'])
      c.ok(!v.length, `dark contrast of the Sign-in tab: ${v.join(', ')}`)
      await d.context().close()
      return c.result()
    },
  },
  {
    id: 'P8-14',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await signinTab(p)
      await p.getByRole('radio', { name: /Local accounts/ }).click()
      await saveRegion(p)
      const q = await L.page(ctx.b)
      await L.fresh(q, '#/login/prova-oidc')
      await q.getByLabel('Username').waitFor({ timeout: 15000 }).catch(() => {})
      c.ok(await H.vis(q.getByLabel('Password')), '#/login/prova-oidc shows username and password again')
      await L.shot(q, 'P8-14')
      await q.context().close()
      return c.result()
    },
  },
]

export default checks
