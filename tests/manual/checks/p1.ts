// Phase 1 — Settings on three levels
// Converted from the QA walkthrough; one entry per check id of docs/manual-tests.md.
import * as H from '../h.ts'
import * as L from '../lib.ts'

const F = (n: string) => L.fixture(n)

async function upload(p: any, label: any, file: any) {
  await p.getByLabel(`Upload: ${label}`).setInputFiles(F(file))
  await p.waitForTimeout(1500)
}
async function saveBar(p: any) {
  return H.vis(p.getByText('Unsaved changes'))
}
async function save(p: any) {
  await p.getByRole('button', { name: 'Save', exact: true }).last().click()
  await p.waitForTimeout(1200)
}
async function tab(p: any, name: any) {
  await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name, exact: true }).click()
  await p.waitForTimeout(1000)
}
async function signinPage(b: any, hash: any = '', opts: any = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-US', ...opts })
  const p = await ctx.newPage()
  await p.goto(L.BASE + hash)
  await p.waitForTimeout(2000)
  return p
}

const checks: L.Check[] = [
  {
    id: 'P1-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system')
      const links = (await p.getByRole('navigation', { name: 'Sections' }).getByRole('link').allInnerTexts()).map((s) => s.trim())
      for (const n of ['Administrators', 'Passwords and sessions', 'Keys of outside services', 'Embedding', 'Email', 'Identity and appearance']) c.ok(links.includes(n), n)
      const you = await p.getByRole('row', { name: /admin/ }).first().innerText()
      if (/\btu\b/.test(you)) c.ok(false, 'the own row of the Administrator shows «tu» (Italian) in the English interface (ui/host/src/app/pages/admin.tsx:542)')
      await L.shot(p, 'P1-01')
      return c.result(`sections: ${links.join(', ')}`)
    },
  },
  {
    id: 'P1-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/identity')
      c.ok(!(await saveBar(p)), 'no save bar before a change')
      ctx.data.welcome = 'Welcome to the QA instance ' + Date.now().toString().slice(-5)
      await p.getByRole('textbox', { name: 'Welcome text' }).fill(ctx.data.welcome)
      c.ok(await saveBar(p), 'save bar after a change')
      await save(p)
      await upload(p, 'Logo for light backgrounds', 'logo-light.svg')
      await upload(p, 'Logo for dark backgrounds', 'logo-dark.svg')
      await L.shot(p, 'P1-02-admin', { full: true })
      const q = await signinPage(ctx.b)
      const t = await q.locator('body').innerText()
      c.ok(t.includes(ctx.data.welcome), 'the new welcome text on the sign-in page')
      const imgs = await q.locator('img').evaluateAll((els) => els.map((e) => e.getAttribute('src')))
      c.ok(imgs.some((s) => /logo/i.test(s || '')), `the logo on the sign-in page (img: ${imgs.join(', ')})`)
      await L.shot(q, 'P1-02')
      await q.context().close()
      return c.result()
    },
  },
  {
    id: 'P1-03',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/identity')
      for (const f of ['not-image.txt', 'big.png', 'evil.svg']) {
        await upload(p, 'Browser icon', f).catch(() => {})
        const t = await H.toast(p)
        c.ok(t.length > 5 && !/\b4\d\d\b/.test(t), `${f}: refused with a clear message («${t}»)`)
        await L.shot(p, 'P1-03-' + f)
        await p.waitForTimeout(4000)
      }
      return c.result()
    },
  },
  {
    id: 'P1-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/identity')
      await tab(p, 'Theme and mode')
      await p.getByRole('button', { name: /Tessera/ }).first().click()
      await p.waitForTimeout(800)
      if (await saveBar(p)) await save(p)
      await p.waitForTimeout(1200)
      c.ok((await p.evaluate(() => document.documentElement.dataset.preset)) === 'tessera', 'Tessera for the Administrator')
      const band = await p.locator('header').first().evaluate((e) => getComputedStyle(e).backgroundColor)
      c.note(`band ${band}`)
      await L.shot(p, 'P1-04-admin')
      const q = await signinPage(ctx.b)
      c.ok((await q.evaluate(() => document.documentElement.dataset.preset)) === 'tessera', 'sign-in page in Tessera')
      await L.shot(q, 'P1-04')
      await q.context().close()
      return c.result()
    },
  },
  {
    id: 'P1-05',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/identity')
      await tab(p, 'Languages and formats')
      await L.shot(p, 'P1-05-before', { full: true })
      const it = p.getByRole('checkbox', { name: /Italiano|Italian/ }).or(p.getByRole('switch', { name: /Italiano|Italian/ }))
      await it.first().click()
      await p.waitForTimeout(500)
      if (await saveBar(p)) await save(p)
      const q = await signinPage(ctx.b)
      c.ok(!(await H.vis(q.getByRole('combobox', { name: 'Language' }))), 'no language menu on the sign-in page')
      await L.shot(q, 'P1-05')
      await q.context().close()
      const u = await L.page(ctx.b)
      await L.login(u, 'Comune di Roma', 's.greco')
      c.ok(!(await H.vis(u.getByRole('button', { name: /Language/ }))), 'no language menu in the top bar of a tenant')
      await L.shot(u, 'P1-05-user')
      await u.context().close()
      await H.go(p, '#/admin/system/identity')
      await tab(p, 'Languages and formats')
      await it.first().click()
      await p.waitForTimeout(500)
      if (await saveBar(p)) await save(p)
      return c.result('Italian offered again at the end')
    },
  },
  {
    id: 'P1-06',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/identity')
      await tab(p, 'Top bar')
      await L.shot(p, 'P1-06-admin', { full: true })
      const sw = (n) => p.getByRole('switch', { name: n })
      await sw(/Search/).first().click()
      await sw(/Help|Guide/).first().click()
      if (await saveBar(p)) await save(p)
      const u = await L.page(ctx.b)
      await L.login(u, 'Comune di Roma', 's.greco')
      c.ok(!(await H.vis(u.getByRole('button', { name: /Search everywhere/ }))), 'no search box')
      await u.keyboard.press('Control+k')
      await u.waitForTimeout(500)
      c.ok(!(await H.vis(u.getByRole('dialog'))) && !(await H.vis(u.getByRole('combobox', { name: /Search/ }))), 'Ctrl K does nothing')
      const items = await H.menu(u)
      c.ok(items.some((i) => /Guided tour|Guide|What is new|Keyboard/.test(i)), `help items in the person menu (${items.join(', ')})`)
      await L.shot(u, 'P1-06-user')
      await H.closeMenus(u)
      await sw(/Logo/).first().click()
      if (await saveBar(p)) await save(p)
      await u.reload()
      await u.waitForTimeout(2000)
      await L.shot(u, 'P1-06-nologo')
      const corner = await u.locator('[data-sidebar="sidebar"]').first().evaluate(() => !!document.querySelector('[data-sidebar="header"] [data-sidebar="trigger"], [data-sidebar="header"] button'))
      c.ok(corner, 'logo off: the sidebar button takes the corner')
      await u.context().close()
      for (const n of [/Search/, /Help|Guide/, /Logo/]) {
        const s = sw(n).first()
        if ((await s.getAttribute('aria-checked')) !== 'true') await s.click()
      }
      if (await saveBar(p)) await save(p)
      return c.result('everything back on at the end')
    },
  },
  {
    id: 'P1-07',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/security')
      await p.getByRole('spinbutton', { name: 'Minimum length of the password' }).fill('')
      await p.getByRole('spinbutton', { name: 'Minimum length of the password' }).fill('12')
      await save(p)
      const u = await L.page(ctx.b)
      await L.login(u, 'Comune di Roma', 's.greco')
      await H.go(u, '#/t/comune-roma/account/security')
      const t = await H.text(u)
      c.ok(/12/.test(t), 'the hint says 12')
      await u.getByLabel('Current password').fill(L.PASSWORD)
      await u.getByLabel('New password', { exact: true }).fill('abcdefghij')
      await u.getByLabel(/Repeat|Confirm/).fill('abcdefghij').catch(() => {})
      const btn = u.getByRole('button', { name: 'Update password' })
      if (await btn.isDisabled()) c.note('the button stays disabled with a 10-character password (refused in the form)')
      else {
        await btn.click()
        await u.waitForTimeout(1200)
      }
      const msg = (await H.toast(u)) + ' ' + (await H.text(u))
      c.ok(/At least 12/i.test(msg), 'the hint says «At least 12»')
      c.ok(!/Password (changed|updated)/i.test(msg), 'a 10-character password is refused')
      await L.shot(u, 'P1-07')
      await u.context().close()
      return c.result()
    },
  },
  {
    id: 'P1-08',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/identity')
      await tab(p, 'Theme and mode')
      const s = p.getByRole('switch', { name: /Tenants may customize it/ }).first()
      if ((await s.getAttribute('aria-checked')) === 'true') await s.click()
      if (await saveBar(p)) await save(p)
      await L.shot(p, 'P1-08-admin')
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/settings')
      await m.getByRole('link', { name: 'Identity and appearance' }).click()
      await m.waitForTimeout(800)
      await tab(m, 'Theme and mode').catch(() => {})
      const t = await H.text(m)
      c.ok(/Managed by the Administrator/.test(t), 'the theme row is locked («Managed by the Administrator»)')
      await L.shot(m, 'P1-08')
      return c.result()
    },
  },
  {
    id: 'P1-09',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/security')
      await p.getByRole('spinbutton', { name: 'Minimum length of the password' }).fill('')
      await p.getByRole('spinbutton', { name: 'Minimum length of the password' }).fill('10')
      await save(p)
      await H.go(p, '#/admin/system/security')
      c.ok((await p.getByRole('spinbutton', { name: 'Minimum length of the password' }).inputValue()) === '10', 'back to 10')
      await H.go(p, '#/admin/system/identity')
      await tab(p, 'Theme and mode')
      const s = p.getByRole('switch', { name: /Tenants may customize it/ }).first()
      if ((await s.getAttribute('aria-checked')) !== 'true') await s.click()
      if (await saveBar(p)) await save(p)
      return c.result('also the theme switch of P1-08 back on')
    },
  },
  {
    id: 'P1-10',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/settings')
      await m.getByRole('link', { name: 'Identity and appearance' }).click()
      await m.waitForTimeout(800)
      await tab(m, 'Theme and mode').catch(() => {})
      await L.shot(m, 'P1-10-before', { full: true })
      const cust = m.getByRole('button', { name: 'Customize' }).first()
      if (await H.vis(cust)) await cust.click()
      await m.getByRole('button', { name: /Mosaikit/ }).first().click()
      await m.waitForTimeout(800)
      if (await saveBar(m)) await save(m)
      await m.waitForTimeout(1000)
      let t = await H.text(m)
      c.ok(/Customized/.test(t), 'marked Customized')
      c.ok((await m.evaluate(() => document.documentElement.dataset.preset)) === 'mosaikit', 'the tenant in its own theme (Mosaikit while the platform has Tessera)')
      const q = await signinPage(ctx.b, '#/login/comune-roma')
      c.ok((await q.evaluate(() => document.documentElement.dataset.preset)) === 'mosaikit', '#/login/comune-roma in the theme of the tenant (P0b-05)')
      await L.shot(q, 'P1-10-signin')
      await q.context().close()
      await L.shot(m, 'P1-10')
      await m.getByRole('button', { name: 'Restore' }).first().click()
      await m.waitForTimeout(1200)
      if (await saveBar(m)) await save(m)
      t = await H.text(m)
      c.ok(/Inherited/.test(t), 'Restore: Inherited')
      return c.result('the platform theme was Tessera (P1-04): the tenant customized Mosaikit, the inverse of the text of the check')
    },
  },
  {
    id: 'P1-11',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/settings')
      await m.getByRole('link', { name: 'Passwords and sessions' }).click()
      await m.waitForTimeout(1000)
      const t = await H.text(m)
      c.ok(/Platform minimum: 10/.test(t), '«Platform minimum: N»')
      await L.shot(m, 'P1-11-before', { full: true })
      const cust = m.getByRole('button', { name: 'Customize' }).first()
      if (await H.vis(cust)) await cust.click()
      const f = m.getByRole('spinbutton', { name: 'Minimum length of the password' })
      await f.fill('8')
      await m.waitForTimeout(400)
      if (await saveBar(m)) await save(m)
      const msg1 = (await H.toast(m)) + ' ' + (await H.text(m))
      c.ok(/below|at least|minimum|stricter/i.test(msg1) && !/saved/i.test(await H.toast(m)), `8 refused («${msg1.slice(0, 120)}»)`)
      await L.shot(m, 'P1-11-refused')
      await f.fill('14')
      if (await saveBar(m)) await save(m)
      const msg2 = await H.toast(m)
      c.ok(/saved/i.test(msg2), `14 accepted («${msg2}»)`)
      await L.shot(m, 'P1-11')
      const r = m.getByRole('button', { name: 'Restore' }).first()
      if (await H.vis(r)) await r.click()
      if (await saveBar(m)) await save(m)
      return c.result('restored at the end')
    },
  },
  {
    id: 'P1-12',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/settings')
      await m.getByRole('link', { name: 'Managed by the platform' }).click()
      await m.waitForTimeout(1000)
      const t = await H.text(m)
      c.ok(/Sign-in method|Local accounts/i.test(t), 'sign-in method')
      c.ok((await m.locator('svg.lucide-lock, [data-lucide="lock"], svg[class*="lock"]').count()) > 0, 'padlocks')
      await L.shot(m, 'P1-12', { full: true })
      return c.result()
    },
  },
  {
    id: 'P1-13',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/settings')
      await m.getByRole('link', { name: 'Identity and appearance' }).click()
      await m.waitForTimeout(1000)
      await L.shot(m, 'P1-13-before', { full: true })
      const cust = m.getByRole('button', { name: /Customize/ })
      const name = m.getByRole('textbox', { name: 'Name' })
      if (!(await name.isEditable().catch(() => false))) await cust.first().click()
      await name.fill('Comune di Roma QA')
      if (await saveBar(m)) await save(m)
      await upload(m, 'Logo for light backgrounds', 'logo-light.svg')
      await m.reload()
      await m.waitForTimeout(2000)
      const band = await m.locator('header').first().innerText().catch(() => '')
      const bandImgs = await m.locator('header img, [data-sidebar] img').count()
      c.ok(/Comune di Roma QA/.test(band) || bandImgs > 0, `tenant name or logo in the band («${band.replace(/\s+/g, ' ').slice(0, 80)}», ${bandImgs} img)`)
      await L.shot(m, 'P1-13')
      const q = await signinPage(ctx.b, '#/login/comune-roma')
      const qt = await q.locator('body').innerText()
      const qi = await q.locator('img').count()
      c.ok(/Comune di Roma QA/.test(qt), 'tenant name on #/login/comune-roma')
      c.ok(qi > 0, 'tenant logo on #/login/comune-roma')
      await L.shot(q, 'P1-13-signin')
      await q.context().close()
      await name.fill('Comune di Roma').catch(() => {})
      const r = m.getByRole('button', { name: 'Restore' }).first()
      if (await H.vis(r)) await r.click()
      if (await saveBar(m)) await save(m)
      return c.result('name restored at the end')
    },
  },
  {
    id: 'P1-14',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/keys')
      const old = p.getByRole('listitem').filter({ hasText: 'Translation service' })
      if (!(await H.vis(p.getByRole('button', { name: 'Add Translation service' })))) {
        await old.getByRole('button', { name: /Remove|Delete/ }).first().click()
        await p.waitForTimeout(500)
        const cf = p.getByRole('alertdialog').or(p.getByRole('dialog'))
        if (await H.vis(cf)) await cf.getByRole('button', { name: /Remove|Delete|Confirm/ }).last().click()
        await p.waitForTimeout(1000)
      }
      await p.getByRole('button', { name: 'Add Translation service' }).click()
      await p.waitForTimeout(600)
      const d = p.getByRole('listitem').filter({ has: p.getByRole('textbox', { name: 'Key for Translation service' }) })
      await d.getByRole('textbox', { name: 'Key for Translation service' }).fill('sk-qa-translation-ABCD1234')
      const share = d.getByRole('checkbox').or(d.getByRole('switch')).first()
      if (await H.vis(share)) await share.click()
      else c.note('no «shared with tenants» control in the form of the key')
      await L.shot(p, 'P1-14-dialog')
      await d.getByRole('button', { name: 'Save' }).click()
      await p.waitForTimeout(1200)
      const t = await H.text(p)
      c.ok(/1234/.test(t) && !/sk-qa-translation/.test(t), 'only the last four characters')
      const row = p.getByRole('listitem').filter({ hasText: 'Translation service' })
      const sh = row.getByRole('switch', { name: /Shared with every tenant/ })
      c.ok(await H.vis(sh), '«Shared with every tenant» (after saving)')
      if (await H.vis(sh)) await sh.click()
      await p.waitForTimeout(800)
      c.ok(await H.vis(row.getByRole('button', { name: /Change/ })), 'Change (the check says «Replace»)')
      await L.shot(p, 'P1-14')
      await row.getByRole('button', { name: /Change/ }).click()
      await p.waitForTimeout(500)
      await row.getByRole('textbox').fill('sk-qa-translation-WXYZ5678')
      await row.getByRole('button', { name: 'Save' }).click()
      await p.waitForTimeout(1000)
      c.ok(/5678/.test(await H.text(p)), 'Change works')
      await row.getByRole('button', { name: /Remove|Delete/ }).first().click()
      await p.waitForTimeout(500)
      const conf = p.getByRole('alertdialog').or(p.getByRole('dialog'))
      if (await H.vis(conf)) await conf.getByRole('button', { name: /Remove|Delete|Confirm/ }).last().click()
      await p.waitForTimeout(1000)
      c.ok(await H.vis(p.getByRole('button', { name: 'Add Translation service' })), 'Remove works')
      await L.shot(p, 'P1-14-removed')
      return c.result()
    },
  },
  {
    id: 'P1-15',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma/account/keys')
      await L.shot(u, 'P1-15-before', { full: true })
      // the services are the ones the installed plugins declare (Notes: Translation service)
      const row = u.locator('li, tr', { hasText: 'Translation service' }).first()
      await row.getByRole('button', { name: /Add|Replace|Change|Set/ }).first().click()
      await u.waitForTimeout(600)
      await u.getByRole('textbox', { name: 'Key for Translation service' }).fill('personal-key-QA-9876')
      await u.getByRole('button', { name: /^Save/ }).last().click()
      await u.waitForTimeout(1200)
      const t = await H.text(u)
      c.ok(/9876/.test(t) && !/personal-key-QA/.test(t), 'saved and masked')
      await L.shot(u, 'P1-15')
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/account')
      const links = (await p.getByRole('navigation', { name: 'Sections' }).getByRole('link').allInnerTexts()).map((s) => s.trim())
      c.ok(!links.includes('Keys'), `the Administrator has no Keys in Account (${links.join(', ')})`)
      return c.result()
    },
  },
  {
    id: 'P1-16',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/embedding')
      await p.getByRole('textbox', { name: 'Sites that may embed public pages' }).fill('https://www.example.org')
      await p.getByRole('button', { name: 'Add' }).click()
      if (await saveBar(p)) await save(p)
      await p.waitForTimeout(800)
      c.ok(/www\.example\.org/.test(await H.text(p)), 'accepted')
      await L.shot(p, 'P1-16-admin')
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/settings')
      await m.getByRole('link', { name: 'Embedding' }).click()
      await m.waitForTimeout(1000)
      const t = await H.text(m)
      c.ok(/www\.example\.org/.test(t), 'the tenant sees the sites of the platform to choose')
      c.ok(!(await H.vis(m.getByRole('textbox', { name: /https/ }))), 'no free text field for other sites')
      await L.shot(m, 'P1-16', { full: true })
      return c.result()
    },
  },
]

export default checks
