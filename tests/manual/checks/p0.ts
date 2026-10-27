// Phase 0 — The new shell is the product
// Converted from the QA walkthrough; one entry per check id of docs/manual-tests.md.
import * as H from '../h.ts'
import * as L from '../lib.ts'


const checks: L.Check[] = [
  {
    id: 'P0-01',
    async run({ b }: any) {
      const c = H.checker()
      const p = await L.page(b)
      await L.fresh(p)
      await p.waitForTimeout(1500)
      const hero = p.getByRole('region', { name: 'Mosaikit' })
      c.ok(await H.vis(hero), 'brand panel')
      const html = await hero.innerHTML().catch(() => '')
      c.ok(/F3EDE2/i.test(html) || /f3ede2/.test(html), 'negative symbol (cream tiles) in the brand panel')
      const tiles = await p.locator('.login-tile').count()
      c.ok(tiles > 0, 'tiles in the corner')
      const yellow = await p.locator('.login-tile').evaluateAll((els) => els.filter((e) => /240, 178, 58/.test(getComputedStyle(e).backgroundColor)).length)
      c.ok(yellow > 0, 'some yellow tiles')
      c.ok(await H.vis(hero.getByText(/Mosaikit \d/)), 'version at the bottom')
      c.ok(await H.vis(p.getByRole('combobox', { name: 'Language' })), 'language')
      c.ok(await H.vis(p.getByRole('button', { name: /^Mode/ })), 'mode button')
      c.ok(await H.vis(p.getByRole('button', { name: 'Sign in' })), 'form')
      c.ok(await H.vis(p.getByRole('navigation', { name: 'Legal notes' })), 'legal links')
      const legalRight = await p.getByRole('navigation', { name: 'Legal notes' }).evaluate((e) => e.getBoundingClientRect().right > window.innerWidth * 0.8)
      c.ok(legalRight, 'legal links at the bottom right')
      await L.shot(p, 'P0-01')
      await p.context().close()
      return c.result(`${tiles} tiles, ${yellow} yellow`)
    },
  },
  {
    id: 'P0-02',
    async run({ b }: any) {
      const c = H.checker()
      const p = await L.page(b)
      await L.fresh(p)
      await p.waitForTimeout(1200)
      const href = await p.evaluate(() => document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? '')
      const svg = href.startsWith('data:') ? decodeURIComponent(href.split(',')[1] ?? '') : ''
      c.ok(/8a1c2b/i.test(svg) && /f0b23a/i.test(svg), `favicon with burgundy and yellow tiles (href: ${href.slice(0, 60)})`)
      await L.shot(p, 'P0-02')
      await p.context().close()
      return c.result()
    },
  },
  {
    id: 'P0-03',
    async run({ b }: any) {
      const c = H.checker()
      for (const w of [900, 390]) {
        const p = await L.page(b, { viewport: { width: w, height: 820 } })
        await L.fresh(p)
        await p.waitForTimeout(1200)
        c.ok(!(await H.vis(p.getByRole('region', { name: 'Mosaikit' }))), `${w}px: brand panel hidden`)
        c.ok(await H.vis(p.getByRole('main').getByText('Mosaikit', { exact: true })), `${w}px: name above the form`)
        const scroll = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
        c.ok(!scroll, `${w}px: no horizontal scroll`)
        await L.shot(p, `P0-03-${w}`)
        await p.context().close()
      }
      return c.result()
    },
  },
  {
    id: 'P0-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      // the tenant context (apps of the sidebar) arrives right after the sign-in
      await p.locator('[data-sidebar="sidebar"]').getByRole('link', { name: 'Notes', exact: true }).waitFor({ timeout: 20000 }).catch(() => {})
      await p.getByRole('heading', { name: 'Home', level: 1 }).waitFor({ timeout: 20000 }).catch(() => {})
      c.ok(await H.vis(p.getByRole('heading', { name: 'Home', level: 1 })), 'Home')
      c.ok(await H.vis(p.getByText('Comune di Roma').first()), 'tenant Comune di Roma')
      const side = p.locator('[data-sidebar="sidebar"]')
      for (const n of ['Home', 'Notes', 'Tasks', 'Files']) c.ok(await H.vis(side.getByRole('link', { name: n, exact: true })), `sidebar ${n}`)
      for (const [n, re] of [
        ['sidebar button', /Open or close the sidebar/],
        ['search', /Search everywhere/],
        ['language', /Language/],
        ['mode', /^Mode/],
        ['help', /^Help/],
        ['bell', /^Notifications/],
        ['person menu', /person menu/],
      ])
        c.ok(await H.vis(p.getByRole('button', { name: re })), `top bar: ${n}`)
      await L.shot(p, 'P0-04')
      return c.result()
    },
  },
  {
    id: 'P0-05',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      const items = await H.menu(p)
      for (const n of ['Account', 'Notifications', 'Sign out']) c.ok(items.some((i) => i.startsWith(n)), n)
      await L.shot(p, 'P0-05')
      await H.closeMenus(p)
      const hasTrash = items.some((i) => i.startsWith('Trash'))
      return c.result(`menu: ${items.join(', ')}${hasTrash ? ' — DOC: the check says Trash is not there yet, it is there since phase 5' : ''}`)
    },
  },
  {
    id: 'P0-06',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      await H.nav(p, 'Notes')
      const f = await L.pluginFrame(p, 'notes')
      await f.getByRole('button', { name: /New note/ }).click()
      await f.getByRole('textbox', { name: 'Title *' }).fill('QA P0-06 note')
      await f.getByRole('textbox', { name: 'Text' }).fill('Created by the QA walkthrough')
      await f.getByRole('button', { name: 'Save' }).click()
      await p.waitForTimeout(1500)
      c.ok(await H.vis(f.getByRole('row', { name: /QA P0-06 note/ })), 'the new note in the list')
      await L.shot(p, 'P0-06')
      return c.result()
    },
  },
  {
    id: 'P0-07',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      await H.go(p, '#/t/comune-roma')
      await H.nav(p, 'Notes')
      const f = await L.pluginFrame(p, 'notes')
      await f.getByRole('row', { name: /QA P0-06 note/ }).click()
      await p.waitForTimeout(800)
      await f.getByRole('button', { name: 'Share…' }).click()
      await p.waitForTimeout(1000)
      const d = p.getByRole('dialog', { name: 'Sharing' })
      c.ok(await H.vis(d.getByRole('searchbox', { name: /Search people or groups/ })), 'people and groups')
      c.ok(await H.vis(d.getByRole('combobox', { name: 'Level' })), 'level')
      c.ok(await H.vis(d.getByRole('button', { name: 'Create link' })), 'public link')
      c.ok(await H.vis(d.getByRole('searchbox', { name: 'New owner' })), 'transfer of ownership')
      await L.shot(p, 'P0-07')
      return c.result()
    },
  },
  {
    id: 'P0-08',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      const d = p.getByRole('dialog', { name: 'Sharing' })
      await d.getByRole('button', { name: 'Create link' }).click()
      await p.waitForTimeout(1200)
      const url = await d.locator('input').evaluateAll((els) => els.map((e) => e.value).find((v) => /\/p\/[0-9a-f]{20,}/.test(v || '')) ?? '')
      c.ok(!!url, 'a link to copy')
      await L.shot(p, 'P0-08-dialog')
      if (url) {
        const q = await L.page(ctx.b)
        await q.goto(url.startsWith('http') ? url : L.ORIGIN + url)
        await q.waitForTimeout(2000)
        const t = await q.locator('body').innerText()
        c.ok(/QA P0-06 note/.test(t), 'public page shows the note')
        c.ok(!(await H.vis(q.getByRole('button', { name: 'Save' }))), 'read only (no Save)')
        await L.shot(q, 'P0-08')
        await q.context().close()
        ctx.data.publicUrl = url
      }
      await p.keyboard.press('Escape')
      return c.result(url ? `link ${url}` : '')
    },
  },
  {
    id: 'P0-09',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      await H.go(p, '#/t/comune-roma')
      await p.getByRole('button', { name: /^Help/ }).click()
      await p.waitForTimeout(400)
      const items = (await p.getByRole('menuitem').allInnerTexts()).map((s) => s.trim())
      for (const n of ['Guided tour', 'Guide', 'What is new', 'Keyboard shortcuts']) c.ok(items.some((i) => i.includes(n)), n)
      const all = await p.getByRole('menu').innerText().catch(() => '')
      c.ok(/\d+\.\d+\.\d+/.test(all), 'version')
      await L.shot(p, 'P0-09')
      await H.closeMenus(p)
      return c.result(`items: ${items.join(' | ')} — DOC: «the items say they come later» is outdated, they work since phase 9`)
    },
  },
  {
    id: 'P0-10',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma')
      const side = p.locator('[data-sidebar="sidebar"]')
      await p.getByRole('button', { name: /Open or close the sidebar/ }).click()
      await p.waitForTimeout(600)
      const links = (await side.getByRole('link').allInnerTexts()).map((s) => s.trim()).filter(Boolean)
      for (const n of ['Tenant overview', 'Notes', 'Manage', 'Plugins', 'Shares', 'Usage', 'Tenant settings']) c.ok(links.includes(n), `sidebar ${n}`)
      c.ok(await H.vis(side.getByText('Tenant management')), 'group label Tenant management (sidebar open)')
      await L.shot(p, 'P0-10')
      await p.getByRole('button', { name: /Open or close the sidebar/ }).click()
      return c.result(`sidebar: ${links.join(', ')}`)
    },
  },
  {
    id: 'P0-11',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma/manage/people')
      const bar = p.getByRole('toolbar')
      const before = await H.vis(bar)
      await p.getByRole('row', { name: /Luca Bianchi/ }).getByRole('checkbox').check()
      await p.waitForTimeout(500)
      c.ok(!before, 'no action bar before a selection')
      c.ok(await H.vis(p.getByRole('toolbar')) || (await H.vis(p.getByText(/1 selected/i))), 'action bar with a selection')
      await L.shot(p, 'P0-11')
      await p.getByRole('row', { name: /Luca Bianchi/ }).getByRole('checkbox').uncheck()
      return c.result()
    },
  },
  {
    id: 'P0-12',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma/manage/people')
      await p.getByRole('link', { name: 'Giulia Marini' }).first().click()
      await p.waitForTimeout(1000)
      const btn = p.getByRole('button', { name: /Remove from the tenant/ })
      if (!(await H.vis(btn))) {
        await p.getByRole('button', { name: /More|⋯|Other actions/ }).first().click().catch(() => {})
        await p.waitForTimeout(400)
      }
      await p.getByRole(/menuitem|button/.test('') ? 'menuitem' : 'button', { name: /Remove from the tenant/ }).first().click().catch(async () => {
        await p.getByText(/Remove from the tenant/).first().click()
      })
      await p.waitForTimeout(800)
      const dlg = p.getByRole('dialog').or(p.getByRole('alertdialog'))
      const t = await dlg.innerText().catch(() => '')
      // with items it asks who gets them; a person without items is only told what happens to the account
      c.ok(/owner|items/i.test(t) || /home tenant: the account is disabled/i.test(t), 'asks who gets the items (new owner), or says what happens to the account when there are none')
      await L.shot(p, 'P0-12-dialog')
      const sb = dlg.getByRole('searchbox').or(dlg.getByRole('combobox')).first()
      if (await H.vis(sb)) {
        await sb.click()
        await sb.fill('Elena').catch(() => {})
        await p.waitForTimeout(600)
        await p.getByRole('option', { name: /Elena Ricci/ }).first().click().catch(() => {})
      }
      await dlg.getByRole('button', { name: /^Remove/ }).last().click()
      await p.waitForTimeout(1200)
      await H.go(p, '#/t/comune-roma/manage/people')
      c.ok(!(await H.vis(p.getByRole('row', { name: /Giulia Marini/ }))), 'Giulia Marini removed')
      await L.shot(p, 'P0-12')
      return c.result(t.replace(/\s+/g, ' ').slice(0, 160))
    },
  },
  {
    id: 'P0-13',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.nav(p, 'Shares')
      const t = await H.text(p)
      c.ok(/QA P0-06 note/.test(t), 'the shared note of Sara')
      for (const re of [/owner/i, /app/i]) c.ok(re.test(t) || (await p.getByRole('combobox').count()) > 0, `filter ${re}`)
      c.ok(await H.vis(p.getByRole('searchbox').or(p.getByRole('textbox', { name: /title|search/i }))), 'filter by title')
      c.ok(await H.vis(p.getByRole('radio', { name: /Public/ }).or(p.getByRole('button', { name: /Public/ })).or(p.getByRole('tab', { name: /Public/ }))), 'Public filter')
      c.ok(await H.vis(p.getByRole('button', { name: /Revoke/ })), 'Revoke')
      await L.shot(p, 'P0-13', { full: true })
      return c.result()
    },
  },
  {
    id: 'P0-14',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.nav(p, 'Usage')
      const t = await H.text(p)
      c.ok(/Quotas|Storage|People|Items/.test(t), 'figures of the tenant')
      c.ok(/Notes|Tasks|KPI|Activity/i.test(t), 'KPIs of the plugins')
      await L.shot(p, 'P0-14', { full: true })
      return c.result()
    },
  },
  {
    id: 'P0-15',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.getByText(/Active tenants|Tenants/).first().waitFor({ timeout: 20000 }).catch(() => {}) // the figures arrive after the page
      c.ok(await H.vis(p.getByRole('heading', { name: 'Platform overview' })), 'Platform overview')
      c.ok(await H.vis(p.getByText('Platform', { exact: true }).first()), 'Platform badge in the band')
      const t = await H.text(p)
      c.ok(/Tenants|People|Plugins/.test(t), 'KPIs')
      await L.shot(p, 'P0-15')
      return c.result('second factor: TOTP computed from the registered secret (not a real authenticator app)')
    },
  },
  {
    id: 'P0-16',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const links = (await p.locator('[data-sidebar="sidebar"]').getByRole('link').allInnerTexts()).map((s) => s.trim()).filter(Boolean)
      // the first entry reads «Overview» when the sidebar is closed (icons with short labels)
      c.ok(links.includes('Platform overview') || links.includes('Overview'), 'Platform overview')
      for (const n of ['Tenants', 'People', 'Plugins', 'Monitoring', 'Log', 'System']) c.ok(links.includes(n), n)
      await L.shot(p, 'P0-16')
      return c.result(`sidebar: ${links.join(', ')}`)
    },
  },
  {
    id: 'P0-17',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/tenants')
      await p.getByRole('link', { name: 'Comune di Roma' }).first().click()
      await p.waitForTimeout(1200)
      c.ok(await H.vis(p.getByRole('navigation', { name: /Breadcrumb/i })), 'breadcrumb')
      c.ok(await H.vis(p.getByText(/^active$/i).first()) || (await H.vis(p.locator('[data-slot="badge"]').first())), 'status badge')
      const more = p.getByRole('button', { name: /More|⋯|actions/i }).first()
      if (await H.vis(more)) {
        await more.click()
        await p.waitForTimeout(400)
        const items = (await p.getByRole('menuitem').allInnerTexts()).join(' | ')
        c.ok(/Suspend|Reactivate/i.test(items), `⋯ with suspend/reactivate (${items})`)
        await L.shot(p, 'P0-17-menu')
        await H.closeMenus(p)
      } else c.ok(false, '⋯ menu')
      c.ok((await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link').count()) > 1, 'tabs')
      await L.shot(p, 'P0-17')
      return c.result()
    },
  },
  {
    id: 'P0-18',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.nav(p, 'Plugins')
      const t = await H.text(p)
      for (const n of ['Installed', 'Updates', 'Catalog']) c.ok(t.includes(n), n)
      c.ok(await H.vis(p.getByRole('button', { name: /Install from file/ })), 'Install from file')
      c.ok(/Turn off|Turn on|Activate|Deactivate|On\b/i.test(t) || (await p.getByRole('switch').count()) > 0, 'activate / deactivate')
      await L.shot(p, 'P0-18', { full: true })
      return c.result()
    },
  },
  {
    id: 'P0-19',
    async run(ctx: any) {
      const c = H.checker()
      const out = []
      for (const [who, hashes] of [
        ['s.greco', ['#/t/comune-roma', '#/t/comune-roma/account/profile', '#/t/comune-roma/notifications']],
        ['e.ricci', ['#/t/comune-roma/manage/people', '#/t/comune-roma/shares', '#/t/comune-roma/usage', '#/t/comune-roma/settings']],
        ['admin', ['#/admin', '#/admin/tenants', '#/admin/plugins', '#/admin/system']],
      ]) {
        const p = await L.page(ctx.b, { colorScheme: 'dark' })
        if (who === 'admin') await L.adminLogin(p)
        else await L.login(p, 'Comune di Roma', who)
        for (const h of hashes) {
          await H.go(p, h)
          const dark = await p.evaluate(() => document.documentElement.classList.contains('dark'))
          if (!dark) c.ok(false, `${h}: not dark with the system in dark mode (mode Automatic)`)
          const v = await H.axe(p, ['color-contrast'])
          if (v.length) out.push(`${h}: ${v.join(', ')}`)
          await L.shot(p, 'P0-19' + h.replace(/[#/]+/g, '_'))
        }
        await p.context().close()
      }
      c.ok(!out.length, `contrast in dark mode: ${out.join(' ; ')}`)
      return c.result('dark mode through the system preference (Automatic); light mode is covered by the other checks')
    },
  },
  {
    id: 'P0-20',
    async run({ b }: any) {
      const c = H.checker()
      const p = await L.page(b)
      await L.fresh(p)
      await p.route('**/api/**', (r) => r.fulfill({ status: 502, body: 'Bad Gateway' }))
      await p.reload()
      await p.waitForTimeout(2500)
      const t = await p.locator('body').innerText()
      c.ok(/not responding/i.test(t), '«The server is not responding. Trying again…»')
      c.ok(!/502/.test(t), 'no «502»')
      c.ok(!/No tenant available/i.test(t), 'no «No tenant available»')
      await L.shot(p, 'P0-20-down')
      await p.unroute('**/api/**')
      await p.waitForTimeout(16000)
      c.ok(await H.vis(p.getByLabel('Username')), 'the form comes back by itself')
      await L.shot(p, 'P0-20-up')
      await p.context().close()
      return c.result('server outage simulated by answering 502 to /api (the QA server keeps running)')
    },
  },
]

export default checks
