// UX follow-ups
import * as H from '../h.ts'
import * as L from '../lib.ts'

async function section(p: any, name: string) {
  await p.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name, exact: true }).click()
  await p.waitForTimeout(900)
}
/** Signs in to the OIDC tenant through the test provider (as Anna Rossi). */
async function viaProvider(b: any, who: string) {
  const q = await L.page(b)
  await L.fresh(q, '#/login/prova-oidc')
  const btn = q.getByRole('link', { name: /Sign in with/ }).or(q.getByRole('button', { name: /Sign in with/ }))
  await btn.waitFor({ timeout: 20000 })
  await btn.click()
  await q.waitForTimeout(2000)
  await q.getByRole('button', { name: `Sign in as ${who}` }).click()
  await q.waitForTimeout(3500)
  return q
}
async function help(p: any, item: RegExp) {
  await p.getByRole('button', { name: /^Help|^Aiuto/ }).first().click()
  await p.getByRole('menuitem', { name: item }).click()
  await p.waitForTimeout(1200)
}

const checks: L.Check[] = [
  {
    id: 'UX-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/tenants')
      const links = (await p.locator('[data-sidebar="sidebar"]').getByRole('link').allInnerTexts()).map((s: string) => s.trim())
      c.ok(links.includes('Tenants'), `the sidebar says Tenants (${links.join(', ')})`)
      c.ok(await H.vis(p.getByRole('heading', { name: 'Tenants', level: 1 })), 'the page title says Tenants')
      await p.getByRole('link', { name: /Comune di Roma/ }).first().click()
      await p.waitForTimeout(1200)
      const tabs = (await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link').allInnerTexts()).map((s: string) => s.replace(/\d+/g, '').trim())
      for (const n of ['Details', 'People', 'Sign-in', 'Plugins']) c.ok(tabs.includes(n), `the tab ${n} (${tabs.join(', ')})`)
      await L.shot(p, 'UX-01')
      return c.result()
    },
  },
  {
    id: 'UX-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      const f = await H.openNote(p, 'Budget 2027')
      await f.getByRole('button', { name: /Share…/ }).click()
      await p.waitForTimeout(1000)
      const t = await p.getByRole('dialog').innerText()
      for (const n of ['View', 'Edit', 'Manage']) c.ok(new RegExp(`\\b${n}\\b`).test(t), `the Share dialog says ${n}`)
      c.ok(!/\b(Read|Write)\b/.test(t), 'no «Read» or «Write» in the Share dialog')
      await L.shot(p, 'UX-02')
      await H.closeMenus(p)
      return c.result('the levels in an access request and in the Permissions tab of a person are covered by the e2e tests of the labels')
    },
  },
  {
    id: 'UX-03',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      c.ok((await H.menu(p)).some((x) => /Access requests/.test(x)), 'Access requests in the person menu')
      await p.getByRole('menuitem', { name: /Access requests/ }).click()
      await p.waitForTimeout(1200)
      c.ok(/Requests to see or edit your items/.test(await H.text(p)), '«Requests to see or edit your items»')
      await L.shot(p, 'UX-03')
      return c.result()
    },
  },
  {
    id: 'UX-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma/manage/people')
      c.ok(await H.vis(p.getByRole('button', { name: 'Invite people' }).or(p.getByRole('link', { name: 'Invite people' }))), 'Invite people on Manage › People')
      await H.go(p, '#/t/comune-roma/manage/pending')
      c.ok(await H.vis(p.getByRole('button', { name: 'Invite people' }).or(p.getByRole('link', { name: 'Invite people' }))), 'Invite people on Pending')
      await L.shot(p, 'UX-04')
      return c.result()
    },
  },
  {
    id: 'UX-05',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system')
      await section(p, 'Retention')
      c.ok(/notifications/i.test(await H.text(p)), 'System › Retention keeps the notifications too')
      await H.go(p, '#/admin/system')
      await section(p, 'Notifications').catch(() => {})
      c.ok(!/kept, in days|Notifications kept/i.test(await H.text(p)), 'System › Notifications no longer has the retention')
      await L.shot(p, 'UX-05')
      return c.result()
    },
  },
  {
    id: 'UX-06',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system')
      await section(p, 'Keys of outside services')
      const t = await H.text(p)
      c.ok(/Translation service/.test(t), 'the service declared by Notes')
      c.ok(/Used by/.test(t), '«Used by …»')
      c.ok(!/AI provider|text message|SMS|Push|OCR/i.test(t), 'no fixed list of services nobody uses')
      await L.shot(p, 'UX-06', { full: true })
      return c.result()
    },
  },
  {
    id: 'UX-07',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system')
      await section(p, 'Keys of outside services')
      const row = p.getByRole('row', { name: /Translation service/ }).or(p.locator('li', { hasText: 'Translation service' })).first()
      await row.getByRole('button', { name: /Add|Replace|Change|Set/ }).first().click()
      await p.getByLabel(/Key for Translation service/).fill('platform-key-1234')
      await p.getByRole('button', { name: /^Save/ }).last().click()
      await p.waitForTimeout(1200)
      await p.getByRole('switch', { name: /Shared with every tenant: Translation service/ }).click()
      await p.waitForTimeout(1000)
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma/account/keys')
      c.ok(/In use: the key of the platform/.test(await H.text(u)), '«In use: the key of the platform»')
      const row2 = u.locator('li, tr', { hasText: 'Translation service' }).first()
      await row2.getByRole('button', { name: /Add|Replace|Change|Set/ }).first().click()
      await u.getByLabel(/Key for Translation service/).fill('personal-key-5678')
      await u.getByRole('button', { name: /^Save/ }).last().click()
      await u.waitForTimeout(1200)
      const t = await H.text(u)
      c.ok(/In use: your key/.test(t), '«In use: your key»')
      c.ok(!/personal-key-5678/.test(t), 'the key is masked')
      await L.shot(u, 'UX-07')
      return c.result()
    },
  },
  {
    id: 'UX-08',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      await H.go(p, '#/t/comune-roma/account/profile')
      await p.getByLabel('Display name').fill('Sara Greco Rossi')
      await p.getByLabel('Display name').press('Enter')
      await p.waitForTimeout(1500)
      c.ok(await H.vis(p.locator('header').getByText('Sara Greco Rossi')), 'the name changes in the band at once')
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/manage/people')
      const list = await (await L.apiUser('comune-roma', 'e.ricci')).call('GET', '/mosaikit/api/t/comune-roma/manage/members')
      c.ok(JSON.stringify(list).includes('Sara Greco Rossi'), 'the API of Manage › People has the new name')
      c.ok(/Sara Greco Rossi/.test(await H.text(m)), 'Manage › People shows the new name')
      await L.shot(p, 'UX-08')
      // the name of the document again
      await p.getByLabel('Display name').fill('Sara Greco')
      await p.getByLabel('Display name').press('Enter')
      await p.waitForTimeout(1200)
      return c.result()
    },
  },
  {
    id: 'UX-09',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      await H.go(p, '#/t/comune-roma/account/profile')
      await p.locator('input[type=file]').first().setInputFiles(L.fixture('logo-light.svg'))
      await p.waitForTimeout(2000)
      c.ok((await p.locator('img[src*="/api/people/"]').count()) > 0, 'the picture shows in Profile and in the band')
      await p.locator('input[type=file]').first().setInputFiles(L.fixture('not-image.txt'))
      const t = await H.toast(p)
      c.ok(t.length > 5 && !/\b4\d\d\b/.test(t), `the text file is refused with a clear message («${t.slice(0, 120)}»)`)
      await L.shot(p, 'UX-09')
      return c.result()
    },
  },
  {
    id: 'UX-10',
    async run() {
      const c = H.checker()
      const id = L.state().ids['s.greco']
      const own = await L.apiUser('comune-roma', 'e.ricci')
      const r1 = await own.ctx.get(`/mosaikit/api/people/${id}/picture`)
      c.ok(r1.ok(), `the Tenant Manager of the tenant sees the picture (${r1.status()})`)
      const other = await L.apiUser('regione-lazio', 'l.verdi')
      const r2 = await other.ctx.get(`/mosaikit/api/people/${id}/picture`)
      c.ok(!r2.ok(), `a person of another tenant does not (${r2.status()})`)
      return c.result()
    },
  },
  {
    id: 'UX-11',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      await H.go(p, '#/t/comune-roma/account/profile')
      await p.getByRole('button', { name: 'Remove the picture' }).click()
      await p.waitForTimeout(1500)
      c.ok((await p.locator('img[src*="/api/people/"]').count()) === 0, 'the picture is gone')
      c.ok(await H.vis(p.locator('header').getByText('SG', { exact: true })), 'the initials come back')
      await L.shot(p, 'UX-11')
      return c.result()
    },
  },
  {
    id: 'UX-12',
    async run(ctx: any) {
      const c = H.checker()
      const q = await viaProvider(ctx.b, 'Anna Rossi')
      await H.go(q, '#/t/prova-oidc/account/profile')
      c.ok(await q.getByLabel('Display name').isDisabled(), 'the name is read-only (it comes from the provider)')
      c.ok(await H.vis(q.getByText(/Add a picture|Change the picture/)), 'the picture can be changed')
      await L.shot(q, 'UX-12')
      await q.context().close()
      return c.result()
    },
  },
  {
    id: 'UX-13',
    async run(ctx: any) {
      const c = H.checker()
      const en = await L.as(ctx, 'e.ricci')
      await help(en, /What is new/)
      const te = await en.getByRole('dialog').innerText()
      c.ok(te.length > 200, `the notes of the version in English (${te.length} characters)`)
      await H.closeMenus(en)
      const it = await L.as(ctx, 'e.ricci', 'it')
      await help(it, /Novità/)
      const ti = await it.getByRole('dialog').innerText()
      c.ok(ti.length > 200 && ti !== te, 'the notes of the version in Italian')
      await L.shot(it, 'UX-13')
      await H.closeMenus(it)
      return c.result()
    },
  },
  {
    id: 'UX-14',
    async run(ctx: any) {
      const c = H.checker()
      for (const who of ['s.greco', 'e.ricci', 'admin']) {
        const p = await L.as(ctx, who)
        await help(p, /Guide of Mosaikit/)
        const d = p.getByRole('dialog')
        c.ok(await H.vis(d), `${who}: a dialog with the guide`)
        c.ok((await d.getByRole('tab').count()) >= 2 || (await d.getByRole('link').count()) >= 1, `${who}: tabs for the other guides`)
        await L.shot(p, `UX-14-${who}`)
        await H.closeMenus(p)
      }
      return c.result()
    },
  },
  {
    id: 'UX-15',
    async run(ctx: any) {
      const c = H.checker()
      const a = await L.apiAdmin()
      await a.call('PUT', '/mosaikit/api/admin/settings', { values: { 'identity.guide_url': 'http://guide.test/guide' } })
      const p = await L.as(ctx, 'e.ricci')
      await p.context().route('http://guide.test/**', (r: any) => r.fulfill({ contentType: 'text/html', body: '<h1>Guide</h1>' }))
      await p.reload()
      await p.waitForTimeout(1500)
      await p.getByRole('button', { name: /^Help/ }).first().click()
      const [pop] = await Promise.all([p.context().waitForEvent('page', { timeout: 10000 }).catch(() => null), p.getByRole('menuitem', { name: /Guide of Mosaikit/ }).click()])
      c.ok(!!pop && /guide\.test\/guide/.test(pop.url()), `Help › Guide opens that address (${pop ? pop.url() : 'no new page'})`)
      await pop?.close()
      await a.call('PUT', '/mosaikit/api/admin/settings', { values: { 'identity.guide_url': null } })
      return c.result()
    },
  },
  {
    id: 'LANG-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci', 'es')
      const english = /(?<!p{L})(the|and|your|you|with|from|for|are|this|will|have|not|new|add|save|cancel)(?!p{L})/iu
      for (const hash of ['', '/overview', '/manage', '/plugins', '/shares', '/settings', '/account']) {
        await H.go(p, '#/t/comune-roma' + hash)
        await p.waitForTimeout(1200)
        const text: string = await p.evaluate(() => document.body.innerText)
        const left = text.split('\n').map((l) => l.trim()).filter((l) => english.test(l))
        c.ok(left.length === 0, `no English left on ${hash || 'Home'}: ${left.slice(0, 3).join(' | ')}`)
      }
      await L.shot(p, 'LANG-01')
      return c.result()
    },
  },
]

export default checks
