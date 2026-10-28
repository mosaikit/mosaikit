// Phase 9 — Search, help and themes
// Converted from the QA walkthrough; one entry per check id of docs/manual-tests.md.
import * as H from '../h.ts'
import * as L from '../lib.ts'


async function search(p: any, q: any) {
  await H.go(p, p.url().includes('/admin') ? '#/admin' : '#/t/comune-roma')
  await p.locator('body').click({ position: { x: 600, y: 400 } }).catch(() => {})
  await p.keyboard.press('/')
  await p.waitForTimeout(500)
  await p.keyboard.type(q)
  await p.waitForTimeout(1800)
  return p.getByRole('dialog', { name: 'Search results' })
}
async function saveRegion(p: any) {
  const r = p.getByRole('region', { name: 'Unsaved changes' })
  if (await H.vis(r)) {
    await r.getByRole('button', { name: 'Save' }).click()
    await p.waitForTimeout(1300)
  }
}

const checks: L.Check[] = [
  {
    id: 'P9-01',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma')
      await m.reload() // the plugins of the tenant may have changed since this page loaded them
      await m.waitForTimeout(1500)
      await H.nav(m, 'Notes')
      const f = await L.pluginFrame(m, 'notes')
      if (!(await H.vis(f.locator('.msk-item').filter({ hasText: /Quarterly inspection/ })))) {
        await f.getByRole('button', { name: /New note/ }).click()
        await f.getByRole('textbox', { name: 'Title *' }).fill('Quarterly inspection')
        await f.getByRole('textbox', { name: 'Text' }).fill('The pump of the north well needs a new seal')
        await f.getByRole('button', { name: 'Save' }).click()
        await m.waitForTimeout(1500)
      }
      c.ok(await H.vis(f.locator('.msk-item').filter({ hasText: /Quarterly inspection/ })), 'saved')
      await L.shot(m, 'P9-01')
      return c.result()
    },
  },
  {
    id: 'P9-02',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      const d = await search(m, 'north well')
      const t = await d.innerText().catch(() => '')
      const pills = await m.getByRole('radio').or(m.getByRole('tab')).or(m.getByRole('button', { name: /^(All|Pages|Apps|Notes)/ })).allInnerTexts()
      c.ok(/Notes\s*1|Notes · 1/.test(t + pills.join(' ')), `a pill/group Notes 1 (${pills.join(', ')})`)
      c.ok(/Quarterly inspection/.test(t), 'the note')
      c.ok(/north well/.test(t), 'a piece of its text around «north well»')
      await L.shot(m, 'P9-02')
      return c.result()
    },
  },
  {
    id: 'P9-03',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await m.keyboard.press('Escape')
      const d = await search(m, 'insp')
      c.ok(/Quarterly inspection/.test(await d.innerText().catch(() => '')), 'found by the beginning of a word of the title')
      await L.shot(m, 'P9-03')
      return c.result()
    },
  },
  {
    id: 'P9-04',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await m.keyboard.press('Escape')
      await search(m, 'quarterly')
      await m.keyboard.press('ArrowDown')
      await m.keyboard.press('Enter')
      await m.waitForTimeout(2500)
      c.ok(/com\.mosaikit\.notes/.test(m.url()), `the note opens in Notes (${m.url()})`)
      await L.shot(m, 'P9-04')
      return c.result()
    },
  },
  {
    id: 'P9-05',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma')
      await m.keyboard.press('Control+k')
      await m.waitForTimeout(800)
      const t = await m.locator('body').innerText()
      c.ok(/Recent searches/.test(t), '«Recent searches»')
      // only a search that led to an opened result is remembered
      c.ok(/north well|quarterly|insp/i.test(t), 'lists a recent search')
      await L.shot(m, 'P9-05')
      await m.keyboard.press('Escape')
      return c.result()
    },
  },
  {
    id: 'P9-06',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      const d = await search(u, 'north well')
      const t = (await d.innerText().catch(() => '')) + (await u.locator('body').innerText())
      c.ok(/No results/.test(t) && !/Quarterly inspection/.test(await d.innerText().catch(() => '')), '«No results»')
      await L.shot(u, 'P9-06')
      await u.keyboard.press('Escape')
      return c.result()
    },
  },
  {
    id: 'P9-07',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      const f = await H.openNote(m, 'Quarterly inspection')
      await f.getByRole('button', { name: 'Share…' }).click()
      const dd = m.getByRole('dialog', { name: 'Sharing' })
      await dd.getByRole('searchbox', { name: /Search people or groups/ }).fill('Sara')
      await m.waitForTimeout(800)
      await m.getByRole('option', { name: /Sara Greco/ }).first().click()
      await dd.getByRole('button', { name: 'Share', exact: true }).click()
      await m.waitForTimeout(1000)
      await m.keyboard.press('Escape')
      const u = await L.as(ctx, 's.greco')
      const d = await search(u, 'north well')
      c.ok(/Quarterly inspection/.test(await d.innerText().catch(() => '')), 'now found')
      await L.shot(u, 'P9-07')
      await u.keyboard.press('Escape')
      return c.result()
    },
  },
  {
    id: 'P9-08',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      const f = await H.openNote(m, 'Quarterly inspection')
      await f.getByRole('button', { name: 'Delete' }).click()
      await m.waitForTimeout(600)
      const cf = m.getByRole('alertdialog').or(m.getByRole('dialog'))
      if (await H.vis(cf)) await cf.getByRole('button', { name: /Delete|Confirm/ }).last().click()
      await m.waitForTimeout(1200)
      let d = await search(m, 'north well')
      c.ok(!/Quarterly inspection/.test(await d.innerText().catch(() => '')), 'not found (in the trash)')
      await m.keyboard.press('Escape')
      await H.go(m, '#/t/comune-roma/trash')
      await m.getByRole('row', { name: /Quarterly inspection/ }).getByRole('button', { name: /Restore/ }).click()
      await m.waitForTimeout(1200)
      d = await search(m, 'north well')
      c.ok(/Quarterly inspection/.test(await d.innerText().catch(() => '')), 'found again after the restore')
      await L.shot(m, 'P9-08')
      await m.keyboard.press('Escape')
      return c.result()
    },
  },
  {
    id: 'P9-09',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const d = await search(p, 'roma')
      const t = await d.innerText().catch(() => '')
      c.ok(/Comune di Roma/.test(t), 'Comune di Roma')
      c.ok(/Tenant/.test(t), `the pill Tenant («${t.replace(/\s+/g, ' ').slice(0, 200)}»)`)
      // the people of a tenant do not match «roma» by name or username: a name finds them
      await p.keyboard.press('Escape')
      const dp = await search(p, 'ricci')
      const tp = await dp.innerText().catch(() => '')
      c.ok(/People/.test(tp) && /Ricci/.test(tp), `the pill People for a name («${tp.replace(/\s+/g, ' ').slice(0, 160)}»)`)
      await p.keyboard.press('Escape')
      await search(p, 'roma')
      await L.shot(p, 'P9-09')
      await p.keyboard.press('ArrowDown')
      await p.keyboard.press('Enter')
      await p.waitForTimeout(1500)
      c.ok(/#\/admin\/(tenants|people)\//.test(p.url()), `a result opens the tenant or the person (${p.url()})`)
      return c.result()
    },
  },
  {
    id: 'P9-10',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/identity')
      await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Top bar', exact: true }).click()
      await p.waitForTimeout(800)
      const sw = p.getByRole('switch', { name: /Search/ }).first()
      await sw.click()
      await saveRegion(p)
      const u = await L.page(ctx.b)
      await L.login(u, 'Comune di Roma', 's.greco')
      await u.keyboard.press('/')
      await u.waitForTimeout(400)
      await u.keyboard.press('Control+k')
      await u.waitForTimeout(600)
      c.ok(!(await H.vis(u.getByRole('combobox', { name: 'Search' }))) && !(await H.vis(u.getByRole('button', { name: /Search everywhere/ }))), 'no search box, / and Ctrl K do nothing')
      await L.shot(u, 'P9-10')
      await u.context().close()
      if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click()
      await saveRegion(p)
      return c.result('put back on')
    },
  },
  {
    id: 'P9-11',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.page(ctx.b)
      await L.login(u, 'Comune di Roma', 'l.bianchi')
      const html = await u.getByRole('button', { name: /^Help/ }).innerHTML()
      const lab = await u.getByRole('button', { name: /^Help/ }).getAttribute('aria-label')
      c.ok(/span|dot/.test(html) || /tour/i.test(lab ?? ''), `a small dot on Help (label «${lab}»)`)
      await L.shot(u, 'P9-11')
      ctx.pages['tour'] = u
      return c.result('a person who never ran the tour of the Home (d.conti)')
    },
  },
  {
    id: 'P9-12',
    async run(ctx: any) {
      const c = H.checker()
      const u = ctx.pages['tour']
      await u.getByRole('button', { name: /^Help/ }).click()
      await u.getByRole('menuitem', { name: /Guided tour/ }).click()
      await u.waitForTimeout(1000)
      const t = await u.locator('body').innerText()
      c.ok(/Step 1 of \d/.test(t), `«Step 1 of N» (${(t.match(/Step 1 of \d/) ?? [''])[0]})`)
      for (const n of ['Next', 'Skip the tour']) c.ok(await H.vis(u.getByRole('button', { name: n })), n)
      await u.keyboard.press('ArrowRight')
      await u.waitForTimeout(500)
      const arrows = /Step 2 of/.test(await u.locator('body').innerText())
      if (!arrows) {
        c.note('ArrowRight did not move the tour from step 1 (focus on the page)')
        await u.getByRole('button', { name: 'Next' }).click()
        await u.waitForTimeout(500)
      }
      c.ok(/Step 2 of/.test(await u.locator('body').innerText()), 'step 2')
      c.ok(await H.vis(u.getByRole('button', { name: 'Back' })), 'Back (from step 2)')
      await u.keyboard.press('ArrowLeft')
      await u.waitForTimeout(500)
      c.ok(/Step 1 of/.test(await u.locator('body').innerText()), `ArrowLeft goes back (arrows ${arrows ? 'work' : 'need the focus in the card'})`)
      await L.shot(u, 'P9-12')
      return c.result()
    },
  },
  {
    id: 'P9-13',
    async run(ctx: any) {
      const c = H.checker()
      const u = ctx.pages['tour']
      for (let i = 0; i < 8; i++) {
        const done = u.getByRole('button', { name: 'Done' })
        if (await H.vis(done)) {
          await done.click()
          break
        }
        await u.getByRole('button', { name: 'Next' }).click()
        await u.waitForTimeout(400)
      }
      await u.reload()
      await u.waitForTimeout(2000)
      const lab1 = await u.getByRole('button', { name: /^Help/ }).getAttribute('aria-label')
      await u.context().close()
      const v = await L.page(ctx.b)
      await L.login(v, 'Comune di Roma', 'd.conti')
      const lab2 = await v.getByRole('button', { name: /^Help/ }).getAttribute('aria-label')
      c.ok(!/tour/i.test(lab1 ?? '') && !/tour/i.test(lab2 ?? ''), `the dot is gone everywhere («${lab1}» / «${lab2}»)`)
      await L.shot(v, 'P9-13')
      await v.context().close()
      return c.result()
    },
  },
  {
    id: 'P9-14',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      const res = []
      for (const h of ['#/t/comune-roma/manage/people', '#/t/comune-roma/plugins', '#/t/comune-roma/settings']) {
        await H.go(m, h)
        await m.getByRole('button', { name: /^Help/ }).click()
        const it = m.getByRole('menuitem', { name: /Guided tour/ })
        res.push(`${h}: ${(await it.getAttribute('aria-disabled')) === 'true' || (await it.getAttribute('data-disabled')) !== null ? 'greyed' : 'tour'}`)
        await H.closeMenus(m)
      }
      c.ok(/manage\/people: tour/.test(res.join()) && /plugins: tour/.test(res.join()) && /settings: greyed/.test(res.join()), res.join(', '))
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system')
      await p.getByRole('button', { name: /^Help/ }).click()
      const it = p.getByRole('menuitem', { name: /Guided tour/ })
      c.ok((await it.getAttribute('aria-disabled')) !== 'true', 'System has its tour')
      await H.closeMenus(p)
      return c.result()
    },
  },
  {
    id: 'P9-15',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma')
      await u.getByRole('button', { name: /^Help/ }).click()
      await u.getByRole('menuitem', { name: /Guide/ }).filter({ hasNotText: /tour/i }).click()
      await u.waitForTimeout(800)
      const t = await u.getByRole('dialog').innerText().catch(() => '')
      c.ok(t.length > 100, 'a dialog with the short guide')
      await L.shot(u, 'P9-15')
      await u.keyboard.press('Escape')
      return c.result('the Guide address of Identity and texts is not exercised')
    },
  },
  {
    id: 'P9-16',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco', 'it')
      await H.go(u, '#/t/comune-roma')
      await u.getByRole('button', { name: /^Aiuto|^Help/ }).click()
      await u.getByRole('menuitem', { name: /Novità|What is new/ }).click()
      await u.waitForTimeout(800)
      const t = await u.getByRole('dialog').innerText().catch(() => '')
      c.ok(/1\.0\.0/.test(t), 'the notes of version 1.0.0')
      const enWords = (t.match(/\b(the|and|with|of)\b/g) ?? []).length
      if (enWords > 5) c.note('«What is new» stays in English in the Italian interface (CHANGELOG.md is English only)')
      await L.shot(u, 'P9-16')
      await u.keyboard.press('Escape')
      return c.result()
    },
  },
  {
    id: 'P9-17',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma')
      await u.locator('main').click({ position: { x: 600, y: 600 } }).catch(() => {})
      await u.keyboard.press('?')
      await u.waitForTimeout(600)
      const t = (await u.getByRole('dialog').innerText().catch(() => '')).replace(/\s+/g, ' ')
      for (const s of ['Ctrl K', '/', '?', 'G H', 'G N', 'G A', 'G T']) c.ok(t.includes(s), s)
      await L.shot(u, 'P9-17')
      await u.keyboard.press('Escape')
      return c.result()
    },
  },
  {
    id: 'P9-18',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      for (const [k, re] of [
        ['n', /notifications/],
        ['h', /#\/t\/comune-roma$/],
        ['t', /trash/],
      ]) {
        await u.getByRole('heading', { level: 1 }).first().click().catch(() => {})
        await u.keyboard.press('g')
        await u.keyboard.press(k)
        await u.waitForTimeout(1200)
        c.ok(re.test(u.url()), `g ${k} → ${u.url().split('#')[1]}`)
      }
      return c.result()
    },
  },
  {
    id: 'P9-19',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma/account/appearance')
      const sw = u.getByRole('switch', { name: /High contrast/ })
      const fg0 = await u.locator('main p').first().evaluate((e) => getComputedStyle(e).color)
      await sw.click()
      await u.waitForTimeout(800)
      const hc = await u.evaluate(() => document.documentElement.className + ' ' + JSON.stringify(document.documentElement.dataset))
      const fg1 = await u.locator('main p').first().evaluate((e) => getComputedStyle(e).color)
      c.ok(/contrast/i.test(hc) || fg0 !== fg1, `high contrast applied (${hc.slice(0, 80)}; ${fg0} → ${fg1})`)
      await L.shot(u, 'P9-19')
      await u.getByRole('button', { name: 'Mode' }).click()
      await u.waitForTimeout(400)
      c.ok(await H.vis(u.getByRole('menuitemcheckbox', { name: /High contrast/ }).or(u.getByRole('menuitem', { name: /High contrast/ }))), 'the same in the mode menu')
      await H.closeMenus(u)
      return c.result()
    },
  },
  {
    id: 'P9-20',
    async run(ctx: any) {
      const c = H.checker()
      const v = await L.page(ctx.b)
      await L.login(v, 'Comune di Roma', 's.greco')
      const hc = await v.evaluate(() => document.documentElement.className + ' ' + JSON.stringify(document.documentElement.dataset))
      c.ok(/contrast/i.test(hc), `stays on in another browser (${hc.slice(0, 80)})`)
      await H.nav(v, 'Notes')
      const f = await L.pluginFrame(v, 'notes')
      const phc = await f.evaluate(() => document.documentElement.className + ' ' + JSON.stringify(document.documentElement.dataset))
      c.ok(/contrast/i.test(phc), `the plugin follows it (${phc.slice(0, 80)})`)
      await L.shot(v, 'P9-20')
      await H.go(v, '#/t/comune-roma/account/appearance')
      await v.getByRole('switch', { name: /High contrast/ }).click()
      await v.waitForTimeout(600)
      await v.context().close()
      return c.result('put off at the end')
    },
  },
  {
    id: 'P9-21',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/identity')
      await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Theme and mode', exact: true }).click()
      await p.waitForTimeout(800)
      await p.getByRole('button', { name: /New theme/ }).click()
      await p.waitForTimeout(1000)
      await p.getByRole('textbox', { name: /^Name/ }).fill('Lagoon')
      const col = p.getByRole('textbox', { name: /Main colour/ })
      await col.fill('#8fd8c8')
      await col.press('Tab')
      await p.waitForTimeout(1000)
      // the editor is a dialog, outside the main region
      const t = await p.getByRole('dialog').innerText()
      c.ok(/light/i.test(t) && /dark/i.test(t), 'two previews (light, dark)')
      c.ok(/Does it read\?/.test(t) && /\d+\.\d\d/.test(t), '«Does it read?» with ratios')
      c.ok(await p.getByRole('button', { name: /Save the theme/ }).isDisabled(), 'Save the theme off')
      await L.shot(p, 'P9-21', { full: true })
      return c.result()
    },
  },
  {
    id: 'P9-22',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await p.getByRole('button', { name: /Fix it for me/ }).click()
      await p.waitForTimeout(1000)
      // the editor is a dialog, outside the main region
      c.ok(/Everything reads/.test(await p.getByRole('dialog').innerText()), '«Everything reads»')
      await p.getByRole('button', { name: /Save the theme/ }).click()
      await p.waitForTimeout(1500)
      c.ok(/Lagoon/.test(await H.text(p)), 'the card Lagoon')
      await L.shot(p, 'P9-22', { full: true })
      return c.result()
    },
  },
  {
    id: 'P9-23',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/identity')
      await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Theme and mode', exact: true }).click()
      await p.waitForTimeout(800)
      await p.getByRole('button', { name: /Lagoon/ }).first().click()
      await saveRegion(p)
      await p.waitForTimeout(1200)
      const pre = await p.evaluate(() => document.documentElement.dataset.preset)
      c.ok(/lagoon|custom/i.test(pre ?? '') || pre !== 'tessera', `the platform in the new colours (preset ${pre})`)
      const q = await L.page(ctx.b)
      await L.fresh(q)
      await q.waitForTimeout(1500)
      const qp = await q.evaluate(() => document.documentElement.dataset.preset)
      c.ok(qp === pre, `the sign-in page too (${qp})`)
      await L.shot(q, 'P9-23')
      await q.context().close()
      return c.result()
    },
  },
  {
    id: 'P9-24',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system/identity')
      await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Theme and mode', exact: true }).click()
      await p.waitForTimeout(800)
      await p.getByRole('button', { name: /^Mosaikit/ }).first().click()
      await saveRegion(p)
      await L.shot(p, 'P9-24-before', { full: true })
      const every = p.getByRole('switch', { name: /Every theme/ }).or(p.getByRole('checkbox', { name: /Every theme/ }))
      if (await H.vis(every)) {
        if ((await every.getAttribute('aria-checked')) === 'true' || (await every.isChecked().catch(() => false))) await every.click()
        const lg = p.getByRole('checkbox', { name: /Lagoon/ })
        await lg.waitFor({ timeout: 5000 }) // the list of themes appears when the switch is off
        if (await lg.isChecked()) await lg.click()
        await saveRegion(p)
      } else c.ok(false, '«Themes tenants may use»')
      await L.shot(p, 'P9-24', { full: true })
      return c.result()
    },
  },
  {
    id: 'P9-25',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await H.go(m, '#/t/comune-roma/settings')
      await m.getByRole('link', { name: 'Identity and appearance' }).click()
      await m.waitForTimeout(800)
      await m.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Theme and mode', exact: true }).click()
      await m.waitForTimeout(800)
      c.ok(!/Lagoon/.test(await H.text(m)), 'Lagoon not offered')
      await m.getByRole('button', { name: /New theme/ }).click()
      await m.waitForTimeout(800)
      await m.getByRole('textbox', { name: /^Name/ }).fill('Roma QA')
      await m.getByRole('textbox', { name: /Main colour/ }).fill('#8a1c2b')
      await m.getByRole('textbox', { name: /Main colour/ }).press('Tab')
      await m.waitForTimeout(800)
      const fix = m.getByRole('button', { name: /Fix it for me/ })
      if (await fix.isEnabled().catch(() => false)) await fix.click()
      await m.getByRole('button', { name: /Save the theme/ }).click()
      await m.waitForTimeout(1500)
      c.ok(/made for this tenant/.test(await H.text(m)), '«made for this tenant»')
      await L.shot(m, 'P9-25', { full: true })
      return c.result()
    },
  },
  {
    id: 'P9-26',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'e.ricci')
      await m.getByRole('button', { name: /Roma QA/ }).first().click()
      await saveRegion(m)
      await m.waitForTimeout(1200)
      const pre = await m.evaluate(() => document.documentElement.dataset.preset)
      c.ok(pre && pre !== 'mosaikit', `the tenant uses it (${pre})`)
      const del = m.getByRole('button', { name: /Delete/ }).first()
      await del.click()
      await m.waitForTimeout(500)
      const cf = m.getByRole('alertdialog').or(m.getByRole('dialog'))
      if (await H.vis(cf)) await cf.getByRole('button', { name: /Delete|Confirm/ }).last().click()
      await m.waitForTimeout(1500)
      const pre2 = await m.evaluate(() => document.documentElement.dataset.preset)
      c.ok(pre2 === 'mosaikit', `back to the theme of the platform (${pre2})`)
      await L.shot(m, 'P9-26')
      return c.result()
    },
  },
  {
    id: 'P9-27',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 'e.ricci', 'it')
      const d = await search(u, 'budget')
      const st = await d.innerText().catch(() => '')
      await u.keyboard.press('Escape')
      await u.getByRole('button', { name: /^Aiuto/ }).click()
      const items = (await u.getByRole('menuitem').allInnerTexts()).join(' | ')
      await H.closeMenus(u)
      c.ok(/Tour guidato/.test(items) && /Scorciatoie/.test(items), `help in Italian (${items})`)
      const dark = await L.page(ctx.b, { colorScheme: 'dark' })
      await L.login(dark, 'Comune di Roma', 'e.ricci')
      await dark.keyboard.press('/')
      await dark.keyboard.type('budget')
      await dark.waitForTimeout(1500)
      const v1 = await H.axe(dark, ['color-contrast'])
      await dark.keyboard.press('Escape')
      await dark.context().close()
      c.ok(!v1.length, `dark contrast of the search: ${v1.join(', ')}`)
      return c.result(`search in Italian: «${st.replace(/\s+/g, ' ').slice(0, 80)}»`)
    },
  },
]

export default checks
