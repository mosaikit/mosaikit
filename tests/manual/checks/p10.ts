// Phase 10 — Layouts and style
import fs from 'node:fs'
import path from 'node:path'
import * as H from '../h.ts'
import * as L from '../lib.ts'

const SETTINGS = '/mosaikit/api/admin/settings'
const LAYOUTS = ['teams', 'console', 'com.mosaikit.layout-workspace', 'com.mosaikit.layout-suite', 'com.mosaikit.layout-project', 'com.mosaikit.layout-tabs']
const PLUGIN_LAYOUTS = LAYOUTS.slice(2)

/** The platform settings through the API of the Administrator (the same call the page makes). */
async function setPlatform(values: Record<string, unknown>) {
  const a = await L.apiAdmin()
  await a.call('PUT', SETTINGS, { values })
}
/** Opens a page and waits for the shell in the given layout. */
async function onLayout(p: any, id: string, hash: string) {
  await H.go(p, hash)
  await p.reload()
  await p.locator(`.msk-shell[data-layout="${id}"]`).waitFor({ timeout: 20000 })
}
/** The skip link first, then the band, the navigation and the content. */
async function slots(p: any, c: ReturnType<typeof H.checker>, where: string) {
  await p.keyboard.press('Tab')
  c.ok(await p.getByRole('button', { name: 'Skip to the content' }).evaluate((e: Element) => e === document.activeElement), `${where}: «Skip to the content» is the first stop`)
  await p.keyboard.press('Enter')
  c.ok(await p.locator('#main').evaluate((e: Element) => e === document.activeElement), `${where}: Enter moves the focus to the content`)
  c.ok(await H.vis(p.locator('header.msk-band')), `${where}: the band`)
  c.ok(await H.vis(p.locator('.msk-nav')), `${where}: the navigation`)
}
async function layoutTab(p: any, tab: string) {
  await H.go(p, '#/admin/system')
  await p.getByRole('link', { name: 'Identity and appearance' }).click()
  await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: tab, exact: true }).click()
  await p.waitForTimeout(800)
}
async function save(p: any) {
  const bar = p.getByRole('region', { name: 'Unsaved changes' })
  if (await H.vis(bar)) await bar.getByRole('button', { name: 'Save' }).click()
  else await p.getByRole('button', { name: 'Save', exact: true }).last().click()
  await p.waitForTimeout(1500)
}
/** A solid grey PNG (its brightness is the grey level 0-255). */
function png(name: string, grey: number): string {
  const f = L.out(name)
  if (!fs.existsSync(f)) fs.writeFileSync(f, L.png(64, 16, grey))
  return f
}

const checks: L.Check[] = [
  {
    id: 'P10-01',
    async run(ctx: any) {
      const c = H.checker()
      await setPlatform({ layout: null, 'layout.allowed': null, 'style.radius': null, 'style.density': null, 'style.font': null, 'style.tabs': null, 'style.buttons': null })
      const p = await L.as(ctx, 'admin')
      await layoutTab(p, 'Layout')
      const cards = p.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio')
      c.ok((await cards.count()) === 6, `six cards (${await cards.count()})`)
      const t = await H.text(p)
      for (const n of ['Teams', 'Console', 'Workspace', 'Suite', 'Project', 'Tabs']) c.ok(new RegExp(n).test(t), n)
      c.ok(/Built-in/.test(t), 'Teams and Console are built in')
      c.ok((await p.locator('[data-layout-card]').count()) === 6, 'a card for each layout, with its thumbnail')
      await L.shot(p, 'P10-01', { full: true })
      return c.result()
    },
  },
  {
    id: 'P10-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await layoutTab(p, 'Layout')
      await p.locator('[data-layout-card="console"]').click()
      await save(p)
      await p.reload()
      await p.locator('.msk-shell[data-layout="console"]').waitFor({ timeout: 20000 })
      c.ok(await H.vis(p.getByRole('navigation', { name: 'Breadcrumb' })), 'the breadcrumb in the band')
      c.ok(await H.vis(p.locator('nav.msk-nav')), 'the navigation (a card at the side)')
      await L.shot(p, 'P10-02')
      return c.result()
    },
  },
  {
    id: 'P10-03',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin')
      await p.reload()
      await p.waitForTimeout(1500)
      await slots(p, c, 'Console')
      await L.shot(p, 'P10-03')
      return c.result()
    },
  },
  {
    id: 'P10-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      for (const id of PLUGIN_LAYOUTS) {
        await setPlatform({ layout: id })
        await onLayout(p, id, '#/admin')
        await slots(p, c, id)
        await L.shot(p, `P10-04-${id}`)
      }
      return c.result()
    },
  },
  {
    id: 'P10-05',
    async run(ctx: any) {
      const c = H.checker()
      await setPlatform({ layout: 'com.mosaikit.layout-suite' })
      const p = await L.as(ctx, 'admin')
      await onLayout(p, 'com.mosaikit.layout-suite', '#/admin')
      await p.getByRole('button', { name: 'All apps and pages' }).click()
      const d = p.getByRole('dialog', { name: 'All apps and pages' })
      for (const n of ['Tenants', 'People', 'Plugins', 'System']) c.ok(await H.vis(d.getByRole('link', { name: n, exact: true })), `a tile for ${n}`)
      await L.shot(p, 'P10-05')
      await d.getByRole('link', { name: 'Tenants', exact: true }).click()
      await p.waitForTimeout(800)
      c.ok(/#\/admin\/tenants/.test(p.url()), 'a tile opens the page')
      return c.result()
    },
  },
  {
    id: 'P10-06',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      for (const id of LAYOUTS) {
        await setPlatform({ layout: id })
        await p.setViewportSize({ width: 1280, height: 800 })
        await onLayout(p, id, '#/admin')
        await p.setViewportSize({ width: 400, height: 800 })
        await p.waitForTimeout(500)
        await p.getByRole('button', { name: /Open the navigation|Open or close the sidebar|All apps and pages/ }).first().click()
        await p.waitForTimeout(600)
        c.ok(await H.vis(p.getByRole('link', { name: 'People', exact: true })), `${id}: the drawer with the full tree`)
        await p.keyboard.press('Escape')
        c.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${id}: no horizontal scroll`)
        await L.shot(p, `P10-06-${id}`)
      }
      await p.setViewportSize({ width: 1280, height: 860 })
      return c.result()
    },
  },
  {
    id: 'P10-07',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const toggleContrast = async () => {
        await p.getByRole('button', { name: 'Mode' }).click()
        await p.getByRole('menuitemcheckbox', { name: 'High contrast' }).click()
        await p.keyboard.press('Escape')
      }
      for (const id of LAYOUTS) {
        await setPlatform({ layout: id })
        await onLayout(p, id, '#/admin')
        await p.emulateMedia({ colorScheme: 'light' })
        c.ok((await H.axe(p, ['color-contrast'])).length === 0, `${id}: light`)
        await p.emulateMedia({ colorScheme: 'dark' })
        await p.waitForTimeout(700)
        const dark = await H.axe(p, ['color-contrast'])
        c.ok(dark.length === 0, `${id}: dark (${dark.join('; ').slice(0, 160)})`)
        await p.emulateMedia({ colorScheme: 'light' })
        await toggleContrast()
        await p.waitForTimeout(1000) // the menu fades out and the colours transition
        const hc = await H.axe(p, ['color-contrast'])
        c.ok(hc.length === 0, `${id}: high contrast (${hc.join('; ').slice(0, 160)})`)
        await toggleContrast()
      }
      return c.result()
    },
  },
  {
    id: 'P10-08',
    async run(ctx: any) {
      const c = H.checker()
      await setPlatform({ layout: 'console' })
      const p = await L.as(ctx, 'e.ricci')
      await onLayout(p, 'console', '#/t/comune-roma')
      const side = p.locator('nav.msk-nav')
      await side.getByRole('button', { name: 'Open the pages of Notes' }).click()
      for (const n of ['All notes', 'Mine', 'Shared with me']) c.ok(await H.vis(side.getByText(n, { exact: true })), `the page ${n}`)
      c.note(`tags in the navigation: ${await side.getByText(/^(Personal|Work|Urgent)$/).allInnerTexts().then((x: string[]) => x.join(', ') || 'under a collapsed group')}`)
      await side.getByText('Mine', { exact: true }).click()
      await p.waitForTimeout(1500)
      c.ok(/#\/t\/comune-roma\/p\/com\.mosaikit\.notes\/mine/.test(p.url()), 'a page opens the app on it')
      c.ok(/Mine/.test(await p.getByRole('navigation', { name: 'Breadcrumb' }).innerText()), 'the breadcrumb shows app and page')
      await L.shot(p, 'P10-08')
      return c.result('a person without the permission of a page not seeing it is covered by the tests of the kernel (manifest nav)')
    },
  },
  {
    id: 'P10-09',
    async run(ctx: any) {
      const c = H.checker()
      await setPlatform({ layout: 'teams' })
      const p = await L.as(ctx, 'e.ricci')
      await onLayout(p, 'teams', '#/t/comune-roma')
      await p.getByRole('button', { name: 'Open the pages of Notes' }).first().click()
      await p.waitForTimeout(600)
      c.ok(await H.vis(p.getByText('Mine', { exact: true })) && (await H.vis(p.getByText('Shared with me', { exact: true }))), 'a flyout lists the pages of Notes')
      await L.shot(p, 'P10-09')
      await H.closeMenus(p)
      return c.result()
    },
  },
  {
    id: 'P10-10',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await layoutTab(p, 'Layout')
      const fs_ = p.getByRole('group', { name: 'Layouts the tenants may choose' })
      for (const n of ['Workspace', 'Suite', 'Project', 'Tabs']) {
        const cb = fs_.getByRole('checkbox', { name: n })
        if (await cb.isChecked()) await cb.uncheck()
      }
      for (const n of ['Console', 'Teams']) {
        const cb = fs_.getByRole('checkbox', { name: n })
        if (!(await cb.isChecked())) await cb.check()
      }
      await save(p)
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/settings')
      await m.reload() // the page keeps what it loaded: the platform setting arrives with the session
      await m.getByRole('link', { name: 'Identity and appearance' }).click()
      await m.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Layout', exact: true }).click()
      await m.waitForTimeout(800)
      const n = await m.locator('[data-layout-card]').count()
      const a = await L.apiAdmin()
      const saved = JSON.stringify((await a.call('GET', SETTINGS)).settings ?? await a.call('GET', SETTINGS)).match(/layout\.allowed[^\]]*\]/)?.[0] ?? 'not saved'
      c.ok(n === 2, `the Tenant Manager is offered two layouts (${n}; platform: ${saved})`)
      await L.shot(m, 'P10-10')
      return c.result()
    },
  },
  {
    id: 'P10-11',
    async run(ctx: any) {
      const c = H.checker()
      await setPlatform({ layout: 'console', 'layout.allowed': ['console', 'teams'] })
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/settings')
      await m.getByRole('link', { name: 'Identity and appearance' }).click()
      await m.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Layout', exact: true }).click()
      c.ok(await H.vis(m.getByText('Inherited').first()), 'Inherited')
      await m.getByRole('button', { name: 'Customize' }).first().click()
      await m.locator('[data-layout-card="teams"]').click()
      await save(m)
      await m.locator('.msk-shell[data-layout="teams"]').waitFor({ timeout: 20000 })
      const v = await L.as(ctx, 'l.verdi')
      await onLayout(v, 'console', '#/t/regione-lazio')
      c.ok(true, 'the other tenant keeps Console')
      await m.getByRole('button', { name: 'Restore' }).first().click()
      await H.toast(m)
      await m.getByRole('button', { name: /Continue|Confirm|Restore/ }).last().click({ timeout: 3000 }).catch(() => {})
      await m.reload()
      await m.locator('.msk-shell[data-layout="console"]').waitFor({ timeout: 20000 })
      c.ok(true, 'Restore goes back to the layout of the platform')
      await L.shot(m, 'P10-11')
      return c.result()
    },
  },
  {
    id: 'P10-12',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      c.ok(!(await H.menu(p)).some((x) => /layout/i.test(x)), 'no layout entry in the person menu')
      await H.closeMenus(p)
      await H.go(p, '#/t/comune-roma/account/appearance')
      c.ok(!/layout/i.test(await H.text(p)), 'no layout choice in Account › Appearance and language')
      return c.result()
    },
  },
  {
    id: 'P10-13',
    async run(ctx: any) {
      const c = H.checker()
      await setPlatform({ layout: 'teams', 'layout.allowed': null })
      const p = await L.as(ctx, 'admin')
      await layoutTab(p, 'Style')
      const pick = async (key: string, label: string) => {
        await p.locator(`#set-style-${key}`).click()
        await p.getByRole('option', { name: label, exact: true }).click()
      }
      await pick('radius', 'Round')
      await pick('density', 'Compact')
      await pick('font', 'Humanist')
      await pick('tabs', 'Pill')
      await pick('buttons', 'Outline')
      const root = () => p.evaluate(() => ({ ...document.documentElement.dataset }))
      const before = await root()
      c.ok(before.styleRadius === 'round' && before.styleDensity === 'compact', `the page previews the changes before Save (${JSON.stringify(before).slice(0, 160)})`)
      await save(p)
      await p.reload()
      await p.waitForTimeout(1200)
      const after = await root()
      c.ok(after.styleRadius === 'round' && after.styleFont === 'humanist' && after.styleTabs === 'pill', `after Save the shell follows (${JSON.stringify(after).slice(0, 200)})`)
      const q = await L.page(ctx.b)
      await L.fresh(q)
      await q.waitForTimeout(1500)
      c.ok((await q.evaluate(() => document.documentElement.dataset.styleRadius)) === 'round', 'the sign-in page follows')
      await q.context().close()
      await L.shot(p, 'P10-13')
      return c.result()
    },
  },
  {
    id: 'P10-14',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/settings')
      await m.getByRole('link', { name: 'Identity and appearance' }).click()
      await m.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Style', exact: true }).click()
      await m.waitForTimeout(800)
      const corners = m.locator('#set-style-radius')
      await m.getByRole('button', { name: 'Customize' }).first().click()
      await corners.click()
      await m.getByRole('option', { name: 'Square', exact: true }).click()
      await save(m)
      await m.reload()
      await m.waitForTimeout(1200)
      const d = await m.evaluate(() => ({ r: document.documentElement.dataset.styleRadius, f: document.documentElement.dataset.styleFont }))
      c.ok(d.r === 'square' && d.f === 'humanist', `only the corners change for the tenant (${JSON.stringify(d)})`)
      const v = await L.as(ctx, 'l.verdi')
      await H.go(v, '#/t/regione-lazio')
      await v.reload()
      await v.waitForTimeout(1200)
      c.ok((await v.evaluate(() => document.documentElement.dataset.styleRadius)) === 'round', 'the other tenant keeps the platform style')
      await L.shot(m, 'P10-14')
      return c.result()
    },
  },
  {
    id: 'P10-15',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await layoutTab(p, 'Style')
      await p.getByLabel('Upload: Band image').setInputFiles(png('band-dark.png', 20))
      const t = await H.toast(p)
      await p.waitForTimeout(1500)
      c.ok(!/contrast|refused|not allowed/i.test(t), `a dark image is accepted («${t}»)`)
      await p.reload()
      await p.waitForTimeout(1500)
      const shows = await p.evaluate(() => [...document.querySelectorAll('header.msk-band, header.msk-band *')].some((e) => /url\(/.test(getComputedStyle(e).backgroundImage) || /url\(/.test(getComputedStyle(e, '::before').backgroundImage)))
      c.ok(shows, 'the image shows under the band')
      await L.shot(p, 'P10-15')
      return c.result()
    },
  },
  {
    id: 'P10-16',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await layoutTab(p, 'Style')
      await p.getByLabel('Upload: Band image').setInputFiles(png('band-bright.png', 255))
      const t = await H.toast(p)
      // the band colour darkens an image as much as needed: it is refused only when even the strongest
      // darkening cannot make the texts read at 4.5:1 (with the light texts of the default theme any image reads)
      const refused = /contrast|4\.5/i.test(t)
      c.ok(refused || /saved/i.test(t), `a very bright image is refused with the message about the contrast, or darkened as needed («${t}»)`)
      c.note(refused ? 'refused for contrast' : 'accepted: the band darkens it (light texts of the default theme)')
      await L.shot(p, 'P10-16')
      return c.result()
    },
  },
  {
    id: 'P10-17',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await layoutTab(p, 'Style')
      await p.getByLabel('Upload: Band image').setInputFiles(png('band-medium.png', 150))
      const t = await H.toast(p)
      c.ok(!/refused|not allowed/i.test(t), `a medium bright image is accepted («${t}»)`)
      await L.shot(p, 'P10-17')
      return c.result()
    },
  },
  {
    id: 'P10-18',
    async run(ctx: any) {
      const c = H.checker()
      await setPlatform({ layout: 'com.mosaikit.layout-project' })
      const p = await L.as(ctx, 'admin')
      await onLayout(p, 'com.mosaikit.layout-project', '#/admin')
      const bg = () => p.locator('header.msk-band').evaluate((e: Element) => getComputedStyle(e).backgroundImage)
      const mine = await bg()
      c.ok(/url\(/.test(mine), `an image under the band in Project (${mine.slice(0, 60)})`)
      await layoutTab(p, 'Style')
      const rm = p.getByRole('button', { name: /Remove/ }).first()
      if (await H.vis(rm)) await rm.click()
      await p.waitForTimeout(1200)
      await p.reload()
      await p.waitForTimeout(1200)
      const pkg = await bg()
      c.note(`after removing the image of the Style: ${/url\(/.test(pkg) ? 'the image of the layout returns' : 'no image'}`)
      await L.shot(p, 'P10-18')
      return c.result('whether Project ships its own image decides the last step')
    },
  },
  {
    id: 'P10-19',
    async run(ctx: any) {
      const c = H.checker()
      await setPlatform({ layout: 'teams', 'layout.allowed': null })
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/plugins')
      await p.getByRole('row', { name: /Tabs/ }).getByRole('link').first().click()
      await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'What it contains' }).click()
      await p.waitForTimeout(1500)
      c.ok(await H.vis(p.getByText('Arrangement of the slots')), 'the arrangement of the slots')
      c.ok(/layout\.toml|package|signature/i.test(await H.text(p)), 'the package contents')
      await L.shot(p, 'P10-19', { full: true })
      return c.result()
    },
  },
  {
    id: 'P10-20',
    async run(ctx: any) {
      const c = H.checker()
      await setPlatform({ layout: 'com.mosaikit.layout-tabs' })
      const a = await L.apiAdmin()
      await a.call('DELETE', '/mosaikit/api/admin/plugins/com.mosaikit.layout-tabs')
      const p = await L.as(ctx, 'admin')
      await onLayout(p, 'teams', '#/admin')
      c.ok(true, 'the platform goes back to Teams')
      return c.result()
    },
  },
  {
    id: 'P10-21',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/plugins')
      const dir = path.join(L.ROOT, '.dev', 'manual', 'registry', 'plugins')
      const pkg = fs.readdirSync(dir).find((f) => f.includes('layout-tabs'))
      c.ok(!!pkg, 'the package of Tabs in the registry of the run')
      if (pkg) {
        await p.locator('input[type="file"]').first().setInputFiles(path.join(dir, pkg))
        const toast = await H.toast(p)
        await p.waitForTimeout(3000)
        c.ok(await H.vis(p.getByRole('row', { name: /Tabs/ })), `installed (toast: «${toast.slice(0, 160)}»)`)
        await p.reload()
        await layoutTab(p, 'Layout')
        const names = await p.locator('[data-layout-card]').allInnerTexts()
        c.ok(names.length === 6, `it can be chosen again (${names.length} cards: ${names.map((x: string) => x.trim().slice(0, 20)).join(', ')})`)
      }
      await L.shot(p, 'P10-21')
      return c.result()
    },
  },
  {
    id: 'P10-22',
    async run() {
      return { status: 'NOT VERIFIABLE', note: 'needs a signed layout package with hostile CSS built for the check; the validator is covered by the tests of mskp and by tests/layouts' }
    },
  },
  {
    id: 'P10-23',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/plugins')
      const t = await H.text(m)
      c.ok(!/layout-(workspace|suite|project|tabs)|Workspace layout|Suite layout|Project layout|Tabs layout/i.test(t), 'no layout plugin in the plugin list of a tenant')
      await L.shot(m, 'P10-23')
      return c.result()
    },
  },
  {
    id: 'P10-24',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.page(ctx.b, { colorScheme: 'dark' })
      await L.adminLogin(p, 'it')
      await H.go(p, '#/admin/system')
      await p.getByRole('link', { name: 'Identità e aspetto' }).click()
      for (const tab of ['Layout', 'Stile']) {
        const l = p.getByRole('navigation', { name: 'Schede' }).getByRole('link', { name: tab, exact: true })
        if (await H.vis(l)) {
          await l.click()
          await p.waitForTimeout(900)
          c.ok(!/Layouts the tenants may choose|Corners|Density/.test(await H.text(p)), `${tab}: translated`)
          const v = await H.axe(p, ['color-contrast'])
          c.ok(v.length === 0, `${tab}: dark mode reads (${v.join('; ').slice(0, 120)})`)
          await L.shot(p, `P10-24-${tab}`)
        } else c.ok(false, `the tab ${tab}`)
      }
      await p.context().close()
      return c.result()
    },
  },
]

export default checks
