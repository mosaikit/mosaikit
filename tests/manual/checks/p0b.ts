// Step 0b — English by default
// Converted from the QA walkthrough; one entry per check id of docs/manual-tests.md.
import * as H from '../h.ts'
import * as L from '../lib.ts'


async function clean(b: any, locale: any) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, locale })
  const p = await ctx.newPage()
  await p.goto(L.BASE)
  await p.waitForTimeout(1500)
  return p
}

const checks: L.Check[] = [
  {
    id: 'P0b-01',
    async run({ b }: any) {
      const c = H.checker()
      const p = await clean(b, 'de-DE')
      c.ok(await H.vis(p.getByRole('heading', { name: 'Sign in' })), 'sign-in in English with a German browser')
      await L.shot(p, 'P0b-01')
      await p.context().close()
      return c.result()
    },
  },
  {
    id: 'P0b-02',
    async run({ b }: any) {
      const c = H.checker()
      const p = await clean(b, 'en-US')
      await p.getByRole('combobox', { name: 'Language' }).click()
      await p.getByRole('option', { name: 'Italiano' }).click()
      await p.waitForTimeout(800)
      c.ok(await H.vis(p.getByRole('heading', { name: 'Accedi' })), 'sign-in in Italian at once')
      await p.getByRole('combobox', { name: /^(Tenant|Organizzazione)$/ }).click()
      await p.getByRole('option', { name: 'Comune di Roma' }).click()
      await p.getByLabel('Utente').fill('s.greco')
      await p.getByLabel('Password').fill(L.PASSWORD)
      await p.getByRole('button', { name: 'Accedi' }).click()
      await p.waitForTimeout(2500)
      const side = (await p.locator('[data-sidebar="sidebar"]').getByRole('link').allInnerTexts()).map((s) => s.trim())
      c.ok(side.includes('Note') && side.includes('Attività'), `apps in Italian in the sidebar (${side.join(', ')})`)
      await p.locator('[data-sidebar="sidebar"]').getByRole('link', { name: 'Note', exact: true }).click()
      const f = await L.pluginFrame(p, 'notes')
      const ft = await f.locator('body').innerText()
      c.ok(/Nuova nota|Titolo|personale/.test(ft), 'the Notes app in Italian')
      await L.shot(p, 'P0b-02')
      await p.reload()
      await p.waitForTimeout(2500)
      c.ok(/Home|Note/.test(await p.locator('body').innerText()) && (await p.evaluate(() => document.documentElement.lang)) === 'it', 'Italian kept after reload')
      await p.context().close()
      return c.result()
    },
  },
  {
    id: 'P0b-03',
    async run({ b }: any) {
      const c = H.checker()
      const p = await clean(b, 'it-IT')
      c.ok(await H.vis(p.getByRole('heading', { name: 'Accedi' })), 'Italian by default with an Italian browser')
      await L.shot(p, 'P0b-03')
      await p.context().close()
      return c.result()
    },
  },
  {
    id: 'P0b-04',
    async run({ b }: any) {
      const c = H.checker()
      for (const [loc, btn, user] of [
        ['en-US', 'Sign in', 'Username'],
        ['it-IT', 'Accedi', 'Utente'],
      ]) {
        const p = await clean(b, loc)
        await p.getByRole('combobox', { name: /^(Tenant|Organizzazione)$/ }).click()
        await p.getByRole('option', { name: 'Comune di Roma' }).click()
        await p.getByLabel(user).fill('l.bianchi')
        await p.getByLabel('Password').fill('wrong-password-123')
        await p.getByRole('button', { name: btn }).click()
        await p.waitForTimeout(1500)
        const t = (await p.getByRole('alert').allInnerTexts()).join(' ').trim()
        c.ok(t.length > 5 && !/^[a-z_]+$/.test(t) && !/\b[45]\d\d\b/.test(t), `${loc}: a clear message («${t}»)`)
        c.ok(loc === 'en-US' ? /wrong|incorrect|invalid/i.test(t) : /errat|non corrett|non valid/i.test(t), `${loc}: in the language («${t}»)`)
        await L.shot(p, 'P0b-04-' + loc)
        await p.context().close()
      }
      return c.result()
    },
  },
  {
    id: 'P0b-05',
    async run({ b }: any) {
      const c = H.checker()
      const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-US' })
      const p = await ctx.newPage()
      await p.goto(L.BASE + '#/login/comune-roma')
      await p.waitForTimeout(1500)
      const t = await p.getByRole('main').innerText()
      c.ok(/Comune di Roma/.test(t), 'the tenant already chosen')
      // «already chosen»: preselected in the Tenant menu, which stays to choose another one
      const menu = p.getByRole('combobox', { name: /^(Tenant|Organizzazione)$/ })
      if (await H.vis(menu)) c.ok(/Comune di Roma/.test(await menu.innerText()), 'the tenant preselected in the menu')
      await L.shot(p, 'P0b-05')
      await ctx.close()
      return c.result('the theme of the tenant is checked again in P1-10')
    },
  },
  {
    id: 'P0b-06',
    async run({ b }: any) {
      const p = await (await b.newContext()).newPage()
      const r = await p.request.get(L.BASE)
      const html = await r.text()
      const m = html.match(/property="og:image" content="([^"]+)"/)
      await p.context().close()
      return { status: 'NOT VERIFIABLE', note: `needs an address reachable by an outside crawler; partial check: og:image = ${m ? m[1] : 'missing'}${m && /^https?:\/\//.test(m[1]) ? ' (absolute)' : ''}` }
    },
  },
]

export default checks
