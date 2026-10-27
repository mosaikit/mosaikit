// Phase 4 — Plugins
// Converted from the QA walkthrough; one entry per check id of docs/manual-tests.md.
import * as H from '../h.ts'
import * as L from '../lib.ts'


async function plugin(p: any, name: any, tab: any) {
  await H.go(p, '#/admin/plugins')
  await p.getByRole('link', { name: new RegExp('^' + name + ' com\\.') }).first().click()
  await p.waitForTimeout(1300)
  if (tab) {
    await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: new RegExp('^' + tab) }).click()
    await p.waitForTimeout(1200)
  }
}
async function bellText(p: any) {
  await p.getByRole('button', { name: /^Notifications/ }).first().click()
  await p.waitForTimeout(800)
  const t = await p.getByRole('dialog').first().innerText().catch(() => '')
  await H.closeMenus(p)
  return t
}
async function tenantPlugins(p: any, slug: any = 'comune-roma') {
  await H.go(p, `#/t/${slug}/plugins`)
}

const checks: L.Check[] = [
  {
    id: 'P4-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/plugins')
      const rows = (await p.getByRole('row').allInnerTexts()).slice(1)
      c.ok(rows.length >= 7, `every plugin (${rows.length})`)
      c.ok(rows.some((r) => /Note review[\s\S]*Extension/.test(r)), 'Note review is an Extension')
      const icons = await p.getByRole('row').locator('svg').count()
      c.ok(icons >= rows.length, `icons (${icons} svg)`)
      await p.getByRole('radio', { name: /^Extensions/ }).click()
      await p.waitForTimeout(700)
      const ext = (await p.getByRole('row').allInnerTexts()).slice(1)
      c.ok(ext.length === 1 && /Note review/.test(ext[0]), `filter Extensions narrows (${ext.length})`)
      await L.shot(p, 'P4-01')
      await p.getByRole('radio', { name: /^All/ }).click()
      c.note('the Signature column shows the raw public key (base64): hard to read')
      return c.result()
    },
  },
  {
    id: 'P4-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/plugins')
      c.ok(!(await H.vis(p.getByRole('button', { name: 'Uninstall' }))), 'no selection bar before')
      await p.getByRole('checkbox', { name: 'Select Contacts' }).check()
      await p.getByRole('checkbox', { name: 'Select Files' }).check()
      await p.waitForTimeout(500)
      for (const n of ['Turn off', 'Uninstall', 'Deselect']) c.ok(await H.vis(p.getByRole('button', { name: n })), n)
      await L.shot(p, 'P4-02')
      await p.getByRole('button', { name: 'Deselect' }).click().catch(() => {})
      return c.result('Update shows only with an update (none in this installation)')
    },
  },
  {
    id: 'P4-03',
    async run(ctx: any) {
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/plugins')
      await p.getByRole('radio', { name: /^Updates/ }).click()
      await p.waitForTimeout(800)
      const u = await H.text(p)
      await L.shot(p, 'P4-03-updates')
      await p.getByRole('radio', { name: /^Catalog/ }).click()
      await p.waitForTimeout(800)
      const k = await H.text(p)
      await L.shot(p, 'P4-03-catalog')
      await p.getByRole('radio', { name: /^Installed/ }).click()
      return { status: 'NOT VERIFIABLE', note: `the registry of this installation holds only the installed versions: Updates and Catalog are empty («${u.split('\n').slice(-1)[0]}» / «${k.split('\n').slice(-1)[0]}»); the empty states are shown` }
    },
  },
  {
    id: 'P4-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await plugin(p, 'Notes')
      c.ok(await H.vis(p.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Plugins' })), 'breadcrumb to Plugins')
      c.ok(await H.vis(p.getByText('active', { exact: true }).first()), 'status badge')
      const tabs = (await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link').allInnerTexts()).map((s) => s.trim())
      for (const n of ['Overview', 'What it asks', 'Tenants', 'Extensions']) c.ok(tabs.some((t) => t.startsWith(n)), n)
      await p.getByRole('button', { name: 'More actions' }).click()
      await p.waitForTimeout(400)
      const items = (await p.getByRole('menuitem').allInnerTexts()).join(' | ')
      c.ok(/Turn off/.test(items) && /Uninstall/.test(items), `⋯ Turn off and Uninstall (${items})`)
      await L.shot(p, 'P4-04')
      await H.closeMenus(p)
      return c.result()
    },
  },
  {
    id: 'P4-05',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await plugin(p, 'Notes', 'What it asks')
      const t = await H.text(p)
      for (const re of [/Logic on the server/i, /Reacts to changes/i, /files/i, /network/i, /Calls the plugins/i, /database/i]) c.ok(re.test(t), String(re))
      await L.shot(p, 'P4-05', { full: true })
      return c.result()
    },
  },
  {
    id: 'P4-06',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await plugin(p, 'Notes', 'Extensions')
      const t = await H.text(p)
      c.ok(/Note review/.test(t) && /active|installed/i.test(t), 'Note review (active)')
      await L.shot(p, 'P4-06')
      await p.getByRole('main').getByRole('link', { name: /Note review/ }).first().click()
      await p.waitForTimeout(1200)
      await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: /^What it asks/ }).click()
      await p.waitForTimeout(1000)
      const w = await H.text(p)
      c.ok(/Reviewed/.test(w), 'the field «Reviewed»')
      c.ok(/Mark as reviewed/.test(w), 'the action «Mark as reviewed»')
      await L.shot(p, 'P4-06-review', { full: true })
      return c.result()
    },
  },
  {
    id: 'P4-07',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await plugin(p, 'Notes', 'Tenants')
      c.ok(await H.vis(p.getByRole('switch', { name: 'Available to every tenant' })), '«Available to every tenant» on top')
      c.ok(await H.vis(p.getByRole('switch', { name: 'Available to Comune di Roma' })), 'one row per tenant with Available')
      c.ok(/In the tenant/.test(await H.text(p)), 'whether the tenant turned it on')
      await L.shot(p, 'P4-07')
      return c.result('Restore appears in P4-10')
    },
  },
  {
    id: 'P4-08',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await plugin(p, 'Notes', 'Tenants')
      await p.getByRole('switch', { name: 'Available to Regione Lazio' }).click()
      await p.waitForTimeout(1200)
      const t = await H.toast(p)
      c.ok(/Availability updated/.test(t), `«Availability updated» («${t}»)`)
      await H.go(p, '#/admin/tenants')
      await p.getByRole('link', { name: 'Regione Lazio' }).first().click()
      await p.waitForTimeout(1000)
      await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: /^Plugins/ }).click()
      await p.waitForTimeout(1000)
      const row = await p.getByRole('row', { name: /^Notes/ }).innerText().catch(() => '')
      c.ok(/not available/i.test(row), `Notes «not available» («${row.replace(/\s+/g, ' ')}»)`)
      await L.shot(p, 'P4-08')
      return c.result()
    },
  },
  {
    id: 'P4-09',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'l.verdi')
      await H.go(m, '#/t/regione-lazio')
      const side = (await m.locator('[data-sidebar="sidebar"]').getByRole('link').allInnerTexts()).map((s) => s.trim())
      c.ok(!side.includes('Notes'), `Notes gone from the sidebar (${side.join(', ')})`)
      const bt = await bellText(m)
      c.ok(/Notes is no longer available/.test(bt), `bell «Notes is no longer available to the tenant» («${bt.replace(/\s+/g, ' ').slice(0, 140)}»)`)
      await tenantPlugins(m, 'regione-lazio')
      const t = await H.text(m)
      c.ok(!/^Notes Personal/m.test(t), 'Notes gone from Plugins')
      c.ok(/Turn on Notes first/.test(t), '*Note review* says «Turn on Notes first»')
      await L.shot(m, 'P4-09')
      return c.result()
    },
  },
  {
    id: 'P4-10',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await plugin(p, 'Notes', 'Tenants')
      const rb = p.getByRole('row', { name: /Regione Lazio/ }).getByRole('button', { name: /Restore/ })
      c.ok(await H.vis(rb), 'Restore for Regione Lazio')
      if (await H.vis(rb)) await rb.click()
      else await p.getByRole('switch', { name: 'Available to Regione Lazio' }).click()
      await p.waitForTimeout(1500)
      const m = await L.as(ctx, 'l.verdi')
      await H.go(m, '#/t/regione-lazio')
      const bt = await bellText(m)
      c.ok(/Notes is available/.test(bt), `«Notes is available to the tenant» («${bt.replace(/\s+/g, ' ').slice(0, 140)}»)`)
      await L.shot(p, 'P4-10')
      return c.result()
    },
  },
  {
    id: 'P4-11',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await tenantPlugins(m)
      const head = (await m.getByRole('columnheader').allInnerTexts()).join(' | ')
      c.ok(/Kind/.test(head) && /Version/.test(head) && /On/.test(head), `kind, version, On (${head})`)
      c.ok(await H.vis(m.getByRole('switch', { name: 'Notes on in the tenant' })), 'On switch')
      c.ok((await m.getByRole('button', { name: 'Access and permissions' }).count()) >= 6, 'Access and permissions')
      c.ok((await m.getByRole('button', { name: 'Open' }).count()) >= 6, 'Open for the apps')
      const nr = await m.getByRole('row', { name: /^Note review/ }).innerText()
      if (/Open/.test(nr)) c.note('Note review (an extension, not an app) also has «Open»')
      await L.shot(m, 'P4-11', { full: true })
      return c.result()
    },
  },
  {
    id: 'P4-12',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await tenantPlugins(m)
      await m.getByRole('switch', { name: 'Tasks on in the tenant' }).click()
      await m.waitForTimeout(1000)
      const cf = m.getByRole('alertdialog').or(m.getByRole('dialog'))
      if (await H.vis(cf)) await cf.getByRole('button', { name: /Turn off|Confirm/ }).last().click()
      const t = await H.toast(m)
      c.ok(/Turned off/.test(t), `«Turned off for the tenant» («${t}»)`)
      const u = await L.page(ctx.b)
      await L.login(u, 'Comune di Roma', 's.greco')
      const side = (await u.locator('[data-sidebar="sidebar"]').getByRole('link').allInnerTexts()).map((s) => s.trim())
      c.ok(!side.includes('Tasks'), `no Tasks for s.greco (${side.join(', ')})`)
      await L.shot(u, 'P4-12')
      await u.context().close()
      return c.result()
    },
  },
  {
    id: 'P4-13',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await tenantPlugins(m)
      await m.getByRole('switch', { name: 'Notes on in the tenant' }).click()
      await m.waitForTimeout(800)
      const cf = m.getByRole('alertdialog').or(m.getByRole('dialog'))
      const ct = await cf.innerText().catch(() => '')
      c.ok(/Note review/.test(ct), `the confirmation names Note review («${ct.replace(/\s+/g, ' ').slice(0, 160)}»)`)
      await L.shot(m, 'P4-13-confirm')
      if (await H.vis(cf)) await cf.getByRole('button', { name: /Turn off|Confirm/ }).last().click()
      await m.waitForTimeout(1200)
      c.ok(/Turn on Notes first/.test(await H.text(m)), '«Turn on Notes first»')
      await L.shot(m, 'P4-13')
      for (const n of ['Notes', 'Tasks']) {
        const s = m.getByRole('switch', { name: `${n} on in the tenant` })
        if ((await s.getAttribute('aria-checked')) !== 'true') {
          await s.click()
          await m.waitForTimeout(1000)
        }
      }
      const nr = m.getByRole('switch', { name: 'Note review on in the tenant' })
      if ((await nr.getAttribute('aria-checked')) !== 'true') {
        await nr.click()
        await m.waitForTimeout(800)
        c.note('Note review had to be turned on again by hand after Notes came back')
      }
      return c.result('Notes and Tasks on again')
    },
  },
  {
    id: 'P4-14',
    async run(ctx: any) {
      const c = H.checker()
      // Notes and Tasks are on again after P4-13; its extension is a switch of its own
      await L.ensureOn('com.mosaikit.notes', 'com.mosaikit.tasks', 'com.mosaikit.note-review')
      // a new sign-in: the page kept from P4-12 was open while Notes went off and on
      await ctx.pages['s.greco:en']?.close().catch(() => {})
      delete ctx.pages['s.greco:en']
      const u = await L.as(ctx, 's.greco')
      const f = await H.openNote(u, 'Shopping list')
      const head = (await f.getByRole('columnheader').allInnerTexts()).join(' | ')
      c.ok(/Reviewed/i.test(head), 'column «Reviewed»')
      const g = f.getByRole('group', { name: 'Note review' })
      c.ok(await H.vis(g), 'box Note review in the detail')
      c.ok(await H.vis(g.getByRole('checkbox', { name: 'Reviewed' })) && (await H.vis(g.getByRole('textbox', { name: 'Reviewed by' }))), 'Reviewed and Reviewed by')
      c.ok(await H.vis(g.getByRole('button', { name: 'Mark as reviewed' })), '«Mark as reviewed»')
      await L.shot(u, 'P4-14')
      return c.result()
    },
  },
  {
    id: 'P4-15',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      const f = await H.openNote(u, 'Shopping list')
      const g = f.getByRole('group', { name: 'Note review' })
      await g.getByRole('button', { name: 'Mark as reviewed' }).click()
      await u.waitForTimeout(1500)
      c.ok(await g.getByRole('checkbox', { name: 'Reviewed' }).isChecked(), 'the box ticks')
      c.ok(/Sara Greco/.test(await g.getByRole('textbox', { name: 'Reviewed by' }).inputValue()), '«Reviewed by» Sara Greco')
      const row = await f.getByRole('row', { name: /Shopping list/ }).innerText()
      c.ok(/✓|yes|Yes/.test(row), `the column shows ✓ («${row.replace(/\s+/g, ' ')}»)`)
      await L.shot(u, 'P4-15')
      return c.result()
    },
  },
  {
    id: 'P4-16',
    async run(ctx: any) {
      const c = H.checker()
      // «Meeting notes» of Sara is shared with Luca read only (P2-05)
      const b = await L.as(ctx, 'l.bianchi')
      const f = await H.openNote(b, 'Meeting notes')
      const g = f.getByRole('group', { name: 'Note review' })
      c.ok(await H.vis(g), 'box Note review')
      c.ok(!(await H.vis(g.getByRole('button', { name: 'Mark as reviewed' }))) || (await g.getByRole('button', { name: 'Mark as reviewed' }).isDisabled()), 'no button')
      const ro = await g.getByRole('checkbox', { name: 'Reviewed' }).isDisabled().catch(() => true)
      c.ok(ro, 'fields read only')
      await L.shot(b, 'P4-16')
      return c.result()
    },
  },
  {
    id: 'P4-17',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco', 'it')
      await H.go(u, '#/t/comune-roma')
      await H.nav(u, 'Note')
      const f = await L.pluginFrame(u, 'notes')
      await f.getByRole('row', { name: /Shopping list/ }).click()
      await u.waitForTimeout(1000)
      const t = await f.locator('body').innerText()
      c.ok(/Revisionata/.test(t), '«Revisionata»')
      c.ok(/Segna come revisionata/.test(t), '«Segna come revisionata»')
      await L.shot(u, 'P4-17-note')
      const m = await L.as(ctx, 'e.ricci', 'it')
      await H.go(m, '#/t/comune-roma/plugins')
      const mt = await H.text(m)
      c.ok(/Estensione/.test(mt) && /App/.test(mt), 'kinds App / Estensione')
      await L.shot(m, 'P4-17')
      return c.result()
    },
  },
  {
    id: 'P4-18',
    async run(ctx: any) {
      const c = H.checker()
      const url = await (async () => {
        const u = await L.as(ctx, 'e.ricci')
        const f = await H.openNote(u, 'Budget 2027')
        await f.getByRole('button', { name: 'Share…' }).click()
        const d = u.getByRole('dialog', { name: 'Sharing' })
        await d.getByRole('button', { name: 'Create link' }).click()
        await u.waitForTimeout(1200)
        const v = await d.locator('input').evaluateAll((els) => els.map((e) => e.value).find((x) => /\/p\/[0-9a-f]{20,}/.test(x || '')) ?? '')
        await u.keyboard.press('Escape')
        return v
      })()
      const q = await L.page(ctx.b)
      await q.goto(url)
      await q.waitForTimeout(4000)
      const ok1 = /Budget 2027/.test(await q.locator('body').innerText())
      const m = await L.as(ctx, 'e.ricci')
      await tenantPlugins(m)
      await m.getByRole('switch', { name: 'Notes on in the tenant' }).click()
      await m.waitForTimeout(700)
      const cf = m.getByRole('alertdialog').or(m.getByRole('dialog'))
      if (await H.vis(cf)) await cf.getByRole('button', { name: /Turn off|Confirm/ }).last().click()
      await m.waitForTimeout(1200)
      await q.reload()
      await q.waitForTimeout(4000)
      const off = await q.locator('body').innerText()
      c.ok(ok1, 'the link works before')
      c.ok(!/Budget 2027/.test(off), `the link stops working («${off.slice(0, 100).replace(/\s+/g, ' ')}»)`)
      await L.shot(q, 'P4-18-off')
      await m.getByRole('switch', { name: 'Notes on in the tenant' }).click()
      await m.waitForTimeout(1200)
      const nr = m.getByRole('switch', { name: 'Note review on in the tenant' })
      if ((await nr.count()) && (await nr.getAttribute('aria-checked')) !== 'true') await nr.click()
      await m.waitForTimeout(800)
      await q.reload()
      await q.waitForTimeout(4000)
      c.ok(/Budget 2027/.test(await q.locator('body').innerText()), 'on again, it works again')
      await L.shot(q, 'P4-18')
      await q.context().close()
      return c.result()
    },
  },
  {
    id: 'P4-19',
    async run() {
      return { status: 'NOT VERIFIABLE', note: 'none of the official plugins declares [[config]] and no own package was built for this walkthrough' }
    },
  },
  {
    id: 'P4-20',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await plugin(p, 'Note review')
      await p.getByRole('button', { name: 'More actions' }).click()
      await p.getByRole('menuitem', { name: /Uninstall/ }).click()
      await p.waitForTimeout(1200)
      const cf = p.getByRole('alertdialog').or(p.getByRole('dialog'))
      const ct = await cf.innerText().catch(() => '')
      c.ok(/item/i.test(ct) && /tenant/i.test(ct), `the confirmation says how many items and tenants («${ct.replace(/\s+/g, ' ').slice(0, 200)}»)`)
      await L.shot(p, 'P4-20-confirm')
      await cf.getByRole('button', { name: /Uninstall|Confirm/ }).last().click()
      await p.waitForTimeout(2500)
      await H.go(p, '#/admin/plugins')
      c.ok(!/Note review/.test(await H.text(p)), 'the extension disappears')
      const u = await L.as(ctx, 's.greco')
      const f = await H.openNote(u, 'Shopping list')
      c.ok(!(await H.vis(f.getByRole('group', { name: 'Note review' }))), 'Notes keeps working without the box')
      await L.shot(u, 'P4-20-notes')
      await H.go(p, '#/admin/plugins')
      await p.getByRole('radio', { name: /^Catalog/ }).click()
      await p.waitForTimeout(1000)
      const inst = p.getByRole('row', { name: /Note review/ }).getByRole('button', { name: /Install/ })
      c.ok(await H.vis(inst), 'Note review in the Catalog')
      if (await H.vis(inst)) {
        await inst.click()
        await p.waitForTimeout(800)
        const cf2 = p.getByRole('alertdialog').or(p.getByRole('dialog'))
        if (await H.vis(cf2)) await cf2.getByRole('button', { name: /Install|Confirm/ }).last().click()
        await p.waitForTimeout(3000)
      }
      await p.getByRole('radio', { name: /^Installed/ }).click()
      await p.waitForTimeout(800)
      c.ok(/Note review/.test(await H.text(p)), 'reinstalled from Catalog')
      await L.shot(p, 'P4-20')
      return c.result('done on the QA installation, installed from a registry (not development mode)')
    },
  },
  {
    id: 'P4-21',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.page(ctx.b, { colorScheme: 'dark' })
      await L.adminLogin(p)
      const out = []
      for (const h of ['#/admin/plugins', '#/admin/plugin/com.mosaikit.notes/tenants']) {
        await H.go(p, h)
        const v = await H.axe(p, ['color-contrast'])
        if (v.length) out.push(`${h}: ${v.join(', ')}`)
        await L.shot(p, 'P4-21' + h.replace(/[#/]+/g, '_'))
      }
      await p.context().close()
      const m = await L.page(ctx.b, { colorScheme: 'dark' })
      await L.login(m, 'Comune di Roma', 'e.ricci')
      await H.go(m, '#/t/comune-roma/plugins')
      const v = await H.axe(m, ['color-contrast'])
      if (v.length) out.push(`tenant plugins: ${v.join(', ')}`)
      await L.shot(m, 'P4-21_tenant')
      await m.context().close()
      c.ok(!out.length, `contrast: ${out.join(' ; ')}`)
      return c.result()
    },
  },
]

export default checks
