// Phase 8 — OIDC sign-in of a tenant (with the test identity provider started by cargo xtask manual-tests)
// Converted from the QA walkthrough; one entry per check id of docs/manual-tests.md.
import * as H from '../h.ts'
import * as L from '../lib.ts'

const IDP = L.IDP

async function signinTab(p: any) {
  await H.go(p, '#/admin/tenants')
  await p.getByRole('link', { name: 'Prova OIDC' }).first().click()
  await p.waitForTimeout(1200)
  await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: /^Sign-in/ }).click()
  await p.waitForTimeout(1200)
}
/** P8-14 put the tenant back on local accounts; the checks that follow work with its provider. */
async function backToOidc(ctx: any) {
  const p = await L.as(ctx, 'admin')
  await signinTab(p)
  const r = p.getByRole('radio', { name: /Identity provider \(OIDC\)/ })
  if (await r.isChecked().catch(() => false)) return
  await r.click()
  const bar = p.getByRole('region', { name: 'Unsaved changes' })
  if (await H.vis(bar)) await bar.getByRole('button', { name: 'Save' }).click()
  await p.waitForTimeout(800)
  const cf = p.getByRole('alertdialog').or(p.getByRole('dialog'))
  if (await H.vis(cf)) await cf.getByRole('button', { name: /Continue|Confirm|Save/ }).last().click()
  await p.waitForTimeout(1500)
}
async function viaProvider(b: any, who: any) {
  const q = await L.page(b)
  await L.fresh(q, '#/login/prova-oidc')
  await q.getByRole('link', { name: /Sign in with/ }).or(q.getByRole('button', { name: /Sign in with/ })).waitFor({ timeout: 20000 })
  await q.getByRole('link', { name: /Sign in with/ }).or(q.getByRole('button', { name: /Sign in with/ })).click()
  await q.waitForTimeout(2000)
  await q.getByRole('button', { name: `Sign in as ${who}` }).click()
  await q.waitForTimeout(3500)
  return q
}

const checks: L.Check[] = [
  {
    id: 'P8-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/tenants')
      if (!/Prova OIDC/.test(await H.text(p))) {
        await p.getByRole('button', { name: 'New tenant' }).click()
        const d = p.getByRole('dialog', { name: 'New tenant' })
        await d.getByLabel('Name', { exact: true }).fill('Prova OIDC')
        await d.getByLabel('Identifier').fill('prova-oidc')
        await d.getByRole('button', { name: 'Next' }).click()
        await d.getByRole('button', { name: 'Next' }).click()
        await d.getByLabel('Username of the Tenant Manager').fill('manager')
        await d.getByLabel('Initial password').fill(L.PASSWORD)
        await d.getByRole('button', { name: 'Next' }).click()
        await d.getByRole('button', { name: 'Create the tenant' }).click()
        await p.waitForTimeout(2500)
      }
      await signinTab(p)
      const t = await H.text(p)
      c.ok(/Local accounts/.test(t) && /Identity provider \(OIDC\)/.test(t), 'two choices')
      c.ok(await p.getByRole('radio', { name: /Local accounts/ }).isChecked().catch(() => false), 'Local accounts chosen')
      c.ok(/Local accounts\s*1|1 local account/i.test(t), 'Accounts: 1 local account')
      await L.shot(p, 'P8-01', { full: true })
      return c.result()
    },
  },
  {
    id: 'P8-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await signinTab(p)
      await p.getByRole('radio', { name: /Identity provider \(OIDC\)/ }).click()
      await p.waitForTimeout(500)
      await p.getByLabel('Address of the provider (issuer)').fill(IDP)
      await p.getByLabel('Client id').fill('mosaikit')
      await p.getByLabel('Client secret').fill('fake-secret')
      await p.getByLabel('Text of the button').fill('Test provider')
      await p.waitForTimeout(500)
      const t = await H.text(p)
      for (const n of ['Return address (redirect URI)', 'Back-channel logout address', 'Address after the sign-out']) c.ok(t.includes(n), n)
      c.ok((await p.getByRole('button', { name: /^Copy/ }).count()) >= 3, 'copy buttons')
      ctx.data.bcl = await p.getByLabel('Back-channel logout address').inputValue().catch(async () => {
        const all = await p.locator('input[readonly], code').evaluateAll((els) => els.map((e) => e.value || e.textContent))
        return all.find((x) => /backchannel/.test(x || '')) ?? ''
      })
      await L.shot(p, 'P8-02', { full: true })
      return c.result(`back-channel address ${ctx.data.bcl}`)
    },
  },
  {
    id: 'P8-03',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.getByRole('button', { name: 'Check the configuration' }).click()
      await p.waitForTimeout(3500)
      const t = await H.text(p)
      for (const re of [/discovery/i, /PKCE/, /signing keys|keys/i, /sign-out/i, /back-channel/i]) c.ok(re.test(t), String(re))
      const list = (await p.getByRole('list', { name: 'Result of the check' }).innerText().catch(() => '')) || ''
      c.ok(list.length > 0 && !/Error/.test(list), `every line green (no Error): «${list.replace(/\s+/g, ' ').slice(0, 120)}»`)
      await L.shot(p, 'P8-03', { full: true })
      return c.result()
    },
  },
  {
    id: 'P8-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.getByLabel('Address of the provider (issuer)').fill('http://127.0.0.1:1')
      await p.getByRole('button', { name: 'Check the configuration' }).click()
      await p.waitForTimeout(5000)
      // the result is a list named «Result of the check» (an aria-label, not visible text)
      const res = (await p.getByRole('list', { name: 'Result of the check' }).innerText().catch(() => '')) || ''
      c.ok(/Error|Discovery document/i.test(res), 'a red line')
      c.ok(!/os error|\b10061\b|ECONNREFUSED/i.test(res), `the reason without a raw code («${res.replace(/\s+/g, ' ').slice(0, 220)}»)`)
      await L.shot(p, 'P8-04')
      await p.getByLabel('Address of the provider (issuer)').fill(IDP)
      return c.result()
    },
  },
  {
    id: 'P8-05',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.getByRole('radio', { name: /Groups of the identity provider/ }).click()
      await p.waitForTimeout(400)
      await p.getByLabel('Groups of the Tenant Managers').fill('mosaikit-managers')
      await p.getByLabel('Groups of the Users').fill('mosaikit-users')
      const r = p.getByRole('region', { name: 'Unsaved changes' })
      await r.getByRole('button', { name: 'Save' }).click()
      await p.waitForTimeout(800)
      const cf = p.getByRole('alertdialog').or(p.getByRole('dialog'))
      const ct = await cf.innerText().catch(() => '')
      c.ok(/local accounts of the tenant can no longer sign in/.test(ct), `a confirmation about the local account («${ct.replace(/\s+/g, ' ').slice(0, 160)}»)`)
      if (await H.vis(cf)) await cf.getByRole('button', { name: /Continue|Confirm|Save/ }).last().click()
      await p.waitForTimeout(1500)
      c.ok(/Sign-in saved/.test(await H.toast(p)), '«Sign-in saved»')
      c.ok(/ends with/.test(await H.text(p)), 'the secret shows only its last four characters')
      await L.shot(p, 'P8-05', { full: true })
      return c.result()
    },
  },
  {
    id: 'P8-06',
    async run(ctx: any) {
      const c = H.checker()
      const q = await L.page(ctx.b)
      await L.fresh(q, '#/login/prova-oidc')
      await q.getByRole('link', { name: /Sign in with/ }).or(q.getByRole('button', { name: /Sign in with/ })).waitFor({ timeout: 20000 }).catch(() => {})
      c.ok(await H.vis(q.getByRole('link', { name: 'Sign in with Test provider' }).or(q.getByRole('button', { name: 'Sign in with Test provider' }))), '«Sign in with Test provider»')
      c.ok(!(await H.vis(q.getByLabel('Password'))), 'no username and password')
      await L.shot(q, 'P8-06')
      await q.context().close()
      return c.result()
    },
  },
  {
    id: 'P8-07',
    async run(ctx: any) {
      const c = H.checker()
      const q = await viaProvider(ctx.b, 'Anna Rossi')
      c.ok(/prova-oidc/.test(q.url()), `in Prova OIDC (${q.url()})`)
      const side = (await q.locator('[data-sidebar="sidebar"]').getByRole('link').allInnerTexts()).map((s) => s.trim())
      c.ok(side.includes('Manage'), `Tenant Manager (Manage in the sidebar: ${side.join(', ')})`)
      await L.shot(q, 'P8-07')
      ctx.pages['anna'] = q
      return c.result()
    },
  },
  {
    id: 'P8-08',
    async run(ctx: any) {
      const c = H.checker()
      const q = ctx.pages['anna']
      await H.go(q, '#/t/prova-oidc/account/security')
      const t = await H.text(q)
      c.ok(/Identity provider of the tenant \(OIDC\)/.test(t), '«Identity provider of the tenant (OIDC)»')
      c.ok(!/Change password/.test(t) && !(await H.vis(q.getByRole('button', { name: 'Update password' }))), 'no Change password')
      await L.shot(q, 'P8-08')
      return c.result()
    },
  },
  {
    id: 'P8-09',
    async run(ctx: any) {
      const c = H.checker()
      const q = ctx.pages['anna']
      await H.go(q, '#/t/prova-oidc/manage/people')
      c.ok(!(await H.vis(q.getByRole('button', { name: 'New user' }))), 'no «New user»')
      const act = q.getByRole('button', { name: /^Actions for/ }).first()
      if (await H.vis(act)) {
        await act.click()
        await q.waitForTimeout(400)
        const items = (await q.getByRole('menuitem').allInnerTexts()).join(' | ')
        c.ok(!/password/i.test(items), `no password link nor reset in the menu (${items})`)
        await H.closeMenus(q)
      }
      await L.shot(q, 'P8-09')
      return c.result()
    },
  },
  {
    id: 'P8-10',
    async run(ctx: any) {
      const c = H.checker()
      const q = ctx.pages['anna']
      const seen = []
      q.on('framenavigated', (f) => f === q.mainFrame() && seen.push(f.url()))
      await q.getByRole('button', { name: /person menu/ }).click()
      await q.getByRole('menuitem', { name: 'Sign out' }).click()
      await q.waitForTimeout(4000)
      c.ok(seen.some((u) => u.startsWith(IDP)), `passes through the provider (${seen.map((u) => u.slice(0, 60)).join(' → ')})`)
      c.ok(L.APP_PORT_RE.test(q.url()) && (await H.vis(q.getByRole('button', { name: /Sign in/ }))), 'back to the sign-in page')
      await L.shot(q, 'P8-10')
      await q.context().close()
      return c.result()
    },
  },
  {
    id: 'P8-11',
    async run(ctx: any) {
      const c = H.checker()
      const q = await viaProvider(ctx.b, 'Bruno Neri')
      const side = (await q.locator('[data-sidebar="sidebar"]').getByRole('link').allInnerTexts()).map((s) => s.trim())
      c.ok(side.length > 0 && !side.includes('Manage'), `User (no Manage: ${side.join(', ')})`)
      await L.shot(q, 'P8-11')
      await q.context().close()
      return c.result()
    },
  },
  {
    id: 'P8-12',
    async run(ctx: any) {
      const c = H.checker()
      const q = await viaProvider(ctx.b, 'Carla Bassi')
      const t = await q.locator('body').innerText()
      c.ok(/not in a group allowed in this tenant/.test(t), '«Your account of the provider is not in a group allowed in this tenant»')
      await L.shot(q, 'P8-12')
      await q.context().close()
      return c.result()
    },
  },
  {
    id: 'P8-13',
    async run(ctx: any) {
      const c = H.checker()
      const q = await viaProvider(ctx.b, 'Anna Rossi')
      const url = ctx.data.bcl || L.BASE + 'api/auth/oidc/prova-oidc/backchannel-logout'
      const r = await q.request.post(IDP + '/_admin/backchannel', { data: { url, sub: 'anna.rossi' } })
      const body = await r.text()
      c.ok(r.ok() && /\d/.test(body), `the answer (${r.status()} ${body.slice(0, 120)})`)
      await H.go(q, '#/t/prova-oidc/manage/people')
      await q.waitForTimeout(2000)
      c.ok(await H.vis(q.getByRole('button', { name: /Sign in/ })), 'the next action asks to sign in again')
      await L.shot(q, 'P8-13')
      await q.context().close()
      return c.result()
    },
  },
  {
    id: 'P8-15',
    async run(ctx: any) {
      await backToOidc(ctx)
      const c = H.checker()
      const q = await viaProvider(ctx.b, 'Anna Rossi')
      await H.go(q, '#/t/prova-oidc/settings/platform')
      const t = await H.text(q)
      c.ok(/Identity provider of the tenant \(OIDC\)/.test(t), 'sign-in method «Identity provider of the tenant (OIDC)» with the padlock')
      await L.shot(q, 'P8-15')
      ctx.pages['anna'] = q
      return c.result()
    },
  },
  {
    id: 'P8-16',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin', 'it')
      await H.go(p, '#/admin/tenants')
      await p.getByRole('link', { name: 'Prova OIDC' }).first().click()
      await p.waitForTimeout(1200)
      const tabs = (await p.getByRole('navigation').last().getByRole('link').allInnerTexts()).join(' | ')
      await p.getByRole('link', { name: /^Accesso/ }).last().click()
      await p.waitForTimeout(1200)
      c.note(`tabs in Italian: ${tabs}`)
      const t = await H.text(p)
      const en = ['Local accounts', 'Where roles come from', 'Check the configuration', 'Text of the button'].filter((w) => t.includes(w))
      c.ok(!en.length, `Sign-in tab in Italian (English left: ${en.join(', ')})`)
      await L.shot(p, 'P8-16-it', { full: true })
      const q = await L.page(ctx.b, { colorScheme: 'dark' })
      await L.fresh(q, '#/login/prova-oidc', 'it')
      await q.getByRole('link', { name: /Accedi con/ }).or(q.getByRole('button', { name: /Accedi con/ })).waitFor({ timeout: 20000 }).catch(() => {})
      c.ok(await H.vis(q.getByRole('link', { name: /Accedi con/ }).or(q.getByRole('button', { name: /Accedi con/ }))), 'sign-in page in Italian («Accedi con …»)')
      const v = await H.axe(q, ['color-contrast'])
      c.ok(!v.length, `dark contrast of the sign-in page: ${v.join(', ')}`)
      await L.shot(q, 'P8-16-dark')
      await q.context().close()
      return c.result()
    },
  },
]

export default checks
