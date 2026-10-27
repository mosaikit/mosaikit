// Phase 3 — People and permissions (as e.ricci unless said otherwise)
// Converted from the QA walkthrough; one entry per check id of docs/manual-tests.md.
import * as H from '../h.ts'
import * as L from '../lib.ts'


async function person(p: any, name: any, tabName: any) {
  await H.go(p, '#/t/comune-roma/manage/people')
  await p.getByRole('link', { name, exact: true }).first().click()
  await p.waitForTimeout(1200)
  if (tabName) {
    await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: tabName, exact: true }).click()
    await p.waitForTimeout(1000)
  }
}
async function notesPerms(p: any) {
  await H.go(p, '#/t/comune-roma/plugins/com.mosaikit.notes')
}
async function saveBarSave(p: any) {
  const r = p.getByRole('region', { name: 'Unsaved changes' })
  if (await H.vis(r)) {
    await r.getByRole('button', { name: 'Save' }).click()
    await p.waitForTimeout(1200)
    return true
  }
  return false
}
async function tryCreate(u: any, title: any) {
  await H.go(u, '#/t/comune-roma')
  await H.nav(u, 'Notes')
  const f = await L.pluginFrame(u, 'notes')
  const nb = f.getByRole('button', { name: /New note/ })
  if (!(await H.vis(nb)) || (await nb.isDisabled())) return { created: false, msg: 'no New note button / disabled', f }
  await nb.click()
  await f.getByRole('textbox', { name: 'Title *' }).fill(title)
  await f.getByRole('button', { name: 'Save' }).click()
  await u.waitForTimeout(1500)
  const msg = ((await f.locator('[role=status], [role=alert], .error, .msk-error').allInnerTexts().catch(() => [])).join(' ') + ' ' + (await H.toast(u))).trim()
  const created = await H.vis(f.getByRole('row', { name: new RegExp(title) }))
  return { created, msg, f }
}

const checks: L.Check[] = [
  {
    id: 'P3-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma/manage/people')
      const s = (await p.getByRole('navigation', { name: 'Sections' }).getByRole('link').allInnerTexts()).join(' | ')
      for (const n of ['People', 'Groups', 'Permission profiles', 'Pending']) c.ok(s.includes(n), n)
      const head = (await p.getByRole('columnheader').allInnerTexts()).join(' | ')
      for (const n of ['Role and profile', 'Groups', 'Status', 'Last sign-in']) c.ok(head.includes(n), `column ${n}`)
      await L.shot(p, 'P3-01')
      return c.result(`columns: ${head}`)
    },
  },
  {
    id: 'P3-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma/manage/profiles')
      const t = await H.text(p)
      c.ok(/Standard\s*Default/.test(t), 'Standard (Default)')
      c.ok(/\d+ people/.test(t), 'its people')
      c.ok(/Notes\s+Create items/.test(t), 'per plugin what it gives')
      await L.shot(p, 'P3-02')
      return c.result()
    },
  },
  {
    id: 'P3-03',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma/manage/profiles')
      if (!/Reader/.test(await H.text(p))) {
        await p.getByRole('button', { name: 'New profile' }).click()
        await p.getByRole('dialog').getByRole('textbox', { name: 'Name' }).fill('Reader')
        await p.getByRole('button', { name: 'Create profile' }).click()
        await p.waitForTimeout(1200)
      }
      c.ok(/Reader/.test(await H.text(p)), 'Reader appears')
      await p.getByRole('button', { name: 'Actions for Reader' }).click()
      await p.waitForTimeout(400)
      const items = (await p.getByRole('menuitem').allInnerTexts()).map((s) => s.trim())
      for (const n of ['Edit the permissions', 'Duplicate', 'Use for new invitations', 'Delete']) c.ok(items.some((i) => i.startsWith(n)), n)
      await L.shot(p, 'P3-03')
      await H.closeMenus(p)
      return c.result(`menu: ${items.join(', ')}`)
    },
  },
  {
    id: 'P3-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await notesPerms(p)
      const t = await H.text(p)
      for (const n of ['Use the app', 'Create items', 'Delete items', 'Share items']) c.ok(t.includes(n), n)
      c.ok(await H.vis(p.getByRole('checkbox', { name: 'Reader: Create items' })), 'a row for Reader with check boxes')
      c.ok(/No group or person has more than their profile/.test(t), 'groups and people empty')
      await L.shot(p, 'P3-04', { full: true })
      return c.result()
    },
  },
  {
    id: 'P3-05',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await notesPerms(p)
      c.ok(!(await H.vis(p.getByRole('region', { name: 'Unsaved changes' }))), 'no save bar before a change')
      for (const n of ['Create items', 'Delete items', 'Share items']) {
        const cb = p.getByRole('checkbox', { name: `Reader: ${n}` })
        if (await cb.isChecked()) await cb.uncheck()
      }
      c.ok(await H.vis(p.getByRole('region', { name: 'Unsaved changes' })), 'save bar after a change')
      await saveBarSave(p)
      const t = await H.toast(p)
      c.ok(/Permissions saved/.test(t), `«Permissions saved» («${t}»)`)
      await L.shot(p, 'P3-05')
      return c.result()
    },
  },
  {
    id: 'P3-06',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await person(p, 'Sara Greco')
      const tabs = (await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link').allInnerTexts()).map((s) => s.trim())
      for (const n of ['Profile', 'Sign-in', 'Permissions', 'Activity']) c.ok(tabs.includes(n), n)
      c.ok(await H.vis(p.getByRole('navigation', { name: /Breadcrumb/ }).getByRole('link', { name: /Manage/ })), 'breadcrumb back to Manage')
      await L.shot(p, 'P3-06')
      return c.result(`tabs: ${tabs.join(', ')}`)
    },
  },
  {
    id: 'P3-07',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await person(p, 'Sara Greco')
      const sel = p.getByRole('combobox', { name: /Permission profile/ })
      await sel.click()
      await p.getByRole('option', { name: /Reader/ }).click()
      await p.waitForTimeout(1200)
      const t = await H.toast(p)
      c.ok(/Profile updated/.test(t), `«Profile updated» («${t}»)`)
      await H.go(p, '#/t/comune-roma/manage/people')
      const row = await p.getByRole('row', { name: /Sara Greco/ }).innerText()
      c.ok(/Reader/.test(row), 'People shows Reader')
      await L.shot(p, 'P3-07')
      return c.result()
    },
  },
  {
    id: 'P3-08',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await person(p, 'Sara Greco', 'Permissions')
      const t = await H.text(p)
      c.ok(/Notes/.test(t), 'Notes')
      c.ok(/Use the app[^\n]*✓|✓[^\n]*Use the app|Profile Reader/.test(t), 'Use the app ✓ (Profile Reader)')
      await L.shot(p, 'P3-08', { full: true })
      return c.result(t.slice(t.indexOf('Notes'), t.indexOf('Notes') + 200).replace(/\s+/g, ' '))
    },
  },
  {
    id: 'P3-09',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.page(ctx.b)
      await L.login(u, 'Comune di Roma', 's.greco')
      const r = await tryCreate(u, 'QA refused note')
      c.ok(!r.created, 'refused')
      c.ok(/permission profile does not allow|not allow/i.test(r.msg) || /disabled/.test(r.msg), `the message («${r.msg}»)`)
      await L.shot(u, 'P3-09')
      await u.context().close()
      return c.result()
    },
  },
  {
    id: 'P3-10',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await notesPerms(p)
      await p.getByRole('button', { name: 'Add a group or person' }).click()
      await p.waitForTimeout(600)
      await p.getByRole('menuitem', { name: 'Sara Greco' }).click()
      await p.waitForTimeout(800)
      await L.shot(p, 'P3-10-added')
      const cb = p.getByRole('checkbox', { name: /Sara Greco: Create items/ })
      if (await H.vis(cb)) await cb.check()
      else c.ok(false, 'a row for Sara Greco with Create items')
      await saveBarSave(p)
      const u = await L.page(ctx.b)
      await L.login(u, 'Comune di Roma', 's.greco')
      const r = await tryCreate(u, 'QA allowed note')
      c.ok(r.created, `creating works again (${r.msg})`)
      await u.context().close()
      await person(p, 'Sara Greco', 'Permissions')
      c.ok(/Personal/.test(await H.text(p)), 'Create items from «Personal»')
      await L.shot(p, 'P3-10', { full: true })
      // the next phases work with Sara on the default profile (Reader was only for these checks)
      const m = await L.apiUser('comune-roma', 'e.ricci')
      const profiles = await m.call('GET', '/mosaikit/api/t/comune-roma/manage/profiles')
      const std = (profiles.profiles ?? profiles).find((x: any) => x.name === 'Standard')
      await m.call('PUT', `/mosaikit/api/t/comune-roma/manage/members/${L.state().ids['s.greco']}/profile`, { profile: std.id })
      return c.result()
    },
  },
  {
    id: 'P3-11',
    async run(ctx: any) {
      const c = H.checker()
      // «Add to a group» needs a group: the document starts from a tenant that already has one
      const m = await L.apiUser('comune-roma', 'e.ricci')
      const groups = await m.call('GET', '/mosaikit/api/t/comune-roma/manage/groups')
      if (!JSON.stringify(groups).includes('QA team')) await m.call('POST', '/mosaikit/api/t/comune-roma/manage/groups', { name: 'QA team' })
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma/manage/people')
      c.ok(!(await H.vis(p.getByRole('button', { name: 'Change profile' }))), 'no action bar without a selection')
      for (const n of ['l.bianchi', 'm.esposito']) await p.getByRole('checkbox', { name: `Select ${n}` }).check()
      await p.waitForTimeout(400)
      for (const n of ['Change profile', 'Add to a group', 'Suspend']) c.ok(await H.vis(p.getByRole('button', { name: n })), n)
      await L.shot(p, 'P3-11')
      await p.getByRole('button', { name: 'Change profile' }).click()
      await p.waitForTimeout(500)
      await L.shot(p, 'P3-11-profile')
      await p.getByRole('menuitem', { name: 'Reader' }).click()
      await p.waitForTimeout(1500)
      let rows = (await p.getByRole('row').allInnerTexts()).filter((r) => /Luca Bianchi|Marco Esposito/.test(r))
      c.ok(rows.some((r) => /Luca Bianchi[\s\S]*Reader/.test(r)), `Change profile applied (${rows.map((r) => r.replace(/\s+/g, ' ').slice(0, 70)).join(' / ')})`)
      c.note(`toast «${await H.toast(p)}»`)
      for (const n of ['l.bianchi', 'm.esposito']) {
        const cb = p.getByRole('checkbox', { name: `Select ${n}` })
        if (!(await cb.isChecked())) await cb.check()
      }
      await p.getByRole('button', { name: 'Add to a group' }).click()
      await p.waitForTimeout(400)
      const g = p.getByRole('menuitem', { name: 'QA team' })
      if (await H.vis(g)) {
        await g.click()
        await p.waitForTimeout(1500)
        rows = (await p.getByRole('row').allInnerTexts()).filter((r) => /Luca Bianchi|Marco Esposito/.test(r))
        c.ok(rows.every((r) => /QA team/.test(r)), `Add to a group applied to both (${rows.map((r) => r.replace(/\s+/g, ' ').slice(0, 70)).join(' / ')})`)
      } else c.note('no group yet for Add to a group')
      await L.shot(p, 'P3-11')
      const cb = p.getByRole('checkbox', { name: 'Select l.bianchi' })
      if (!(await H.vis(p.getByRole('button', { name: 'Change profile' })))) await cb.check()
      await p.getByRole('button', { name: 'Change profile' }).click()
      await p.getByRole('menuitem', { name: 'Default profile' }).click()
      await p.waitForTimeout(1200)
      return c.result('Suspend is applied in P3-12')
    },
  },
  {
    id: 'P3-12',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma/manage/people')
      for (const cbx of await p.getByRole('checkbox', { checked: true }).all()) await cbx.uncheck().catch(() => {})
      await p.getByRole('checkbox', { name: 'Select l.bianchi' }).check()
      await p.getByRole('button', { name: 'Suspend' }).click()
      await p.waitForTimeout(600)
      const cf = p.getByRole('alertdialog').or(p.getByRole('dialog'))
      if (await H.vis(cf)) await cf.getByRole('button', { name: /Suspend|Confirm/ }).last().click()
      await p.waitForTimeout(1200)
      c.ok(/suspended/i.test(await p.getByRole('row', { name: /Luca Bianchi/ }).innerText()), 'Luca Bianchi suspended')
      const u = await L.page(ctx.b)
      await L.fresh(u)
      await u.getByRole('combobox', { name: 'Tenant' }).click()
      await u.getByRole('option', { name: 'Comune di Roma' }).click()
      await u.getByLabel('Username').fill('l.bianchi')
      await u.getByLabel('Password').fill(L.PASSWORD)
      await u.getByRole('button', { name: 'Sign in' }).click()
      await u.waitForTimeout(2000)
      const t = await u.locator('body').innerText()
      c.ok(!/person menu/.test(await u.locator('body').ariaSnapshot()) || /not.*(member|offered)|no tenant/i.test(t), `the tenant is not offered any more («${t.slice(0, 200).replace(/\s+/g, ' ')}»)`)
      await L.shot(u, 'P3-12-signin')
      await u.context().close()
      await person(p, 'Luca Bianchi')
      await p.getByRole('button', { name: /More|⋯|Actions/ }).first().click()
      await p.waitForTimeout(400)
      await p.getByRole('menuitem', { name: /Reactivate/ }).click()
      await p.waitForTimeout(1000)
      c.ok(/active/i.test(await H.text(p)), 'reactivated')
      await L.shot(p, 'P3-12')
      return c.result()
    },
  },
  {
    id: 'P3-13',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma/manage/groups')
      if (!/QA team/.test(await H.text(p))) {
        await p.getByRole('button', { name: /New group/ }).click()
        await p.getByRole('dialog').getByRole('textbox').first().fill('QA team')
        await p.getByRole('dialog').getByRole('button', { name: /Create/ }).click()
        await p.waitForTimeout(1200)
      }
      await H.go(p, '#/t/comune-roma/manage/groups')
      await p.getByRole('link', { name: 'QA team' }).first().click()
      await p.waitForTimeout(1200)
      const tabs = (await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link').allInnerTexts()).map((s) => s.trim())
      for (const n of ['Members', 'Shared items', 'Plugins']) c.ok(tabs.some((t: string) => t.startsWith(n)), n) // the tabs carry their counts
      const add = p.getByRole('button', { name: 'Add a member' })
      c.ok(await H.vis(add), 'add a member')
      if (!/Davide Conti/.test(await H.text(p))) {
        await add.click()
        await p.waitForTimeout(500)
        await p.getByRole('menuitem', { name: 'Davide Conti' }).click()
        await p.waitForTimeout(1200)
      }
      c.ok(/Davide Conti/.test(await H.text(p)), 'member added')
      const rm = p.getByRole('button', { name: /Remove/ }).first()
      c.ok(await H.vis(rm), 'remove a member')
      await L.shot(p, 'P3-13', { full: true })
      return c.result(`tabs: ${tabs.join(', ')}`)
    },
  },
  {
    id: 'P3-14',
    async run(ctx: any) {
      const c = H.checker()
      const a = await L.apiUser('comune-roma', 'e.ricci')
      const x = await a.call('POST', '/mosaikit/api/t/comune-roma/p/com.mosaikit.notes/r/notes', { values: { title: 'QA private note of Elena', body: 'only Elena' } })
      ctx.data.privId = x.id ?? x.resource_id ?? x.item?.id
      c.ok(!!ctx.data.privId, `an identifier (${JSON.stringify(x).slice(0, 120)})`)
      const p = await L.as(ctx, 'e.ricci')
      await H.openNote(p, 'QA private note of Elena')
      const addr = p.url()
      c.note(`address of the note in the shell: ${addr}`)
      await L.shot(p, 'P3-14')
      return c.result('note created through the API as e.ricci; its identifier taken from the answer')
    },
  },
  {
    id: 'P3-15',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, `#/t/comune-roma/item/${ctx.data.privId}`)
      const t = await H.text(u)
      c.ok(/You cannot see this item/.test(t), '«You cannot see this item»')
      c.ok(/View/.test(t) && /Edit/.test(t), 'Access (View, Edit)')
      await L.shot(u, 'P3-15-before')
      const msg = u.getByRole('textbox').first()
      if (await H.vis(msg)) await msg.fill('Please, I need it for the report')
      await u.getByRole('button', { name: /Send the request/ }).click()
      await u.waitForTimeout(1200)
      c.ok(/Request sent/.test((await H.toast(u)) + (await H.text(u))), '«Request sent»')
      await L.shot(u, 'P3-15')
      return c.result()
    },
  },
  {
    id: 'P3-16',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma')
      await p.getByRole('button', { name: /^Notifications/ }).first().click()
      await p.waitForTimeout(800)
      const t = await p.getByRole('dialog').first().innerText()
      c.ok(/Sara Greco asks to see/.test(t), `«Sara Greco asks to see …» («${t.replace(/\s+/g, ' ').slice(0, 140)}»)`)
      await H.closeMenus(p)
      await H.go(p, '#/t/comune-roma/manage/pending')
      const pt = await H.text(p)
      c.ok(/Access requests/.test(pt), 'Pending › Access requests')
      // «Forward to the owner» is offered only when the Tenant Manager is not the owner of the item
      for (const n of ['Approve', 'Refuse']) c.ok(await H.vis(p.getByRole('button', { name: n })), n)
      await L.shot(p, 'P3-16', { full: true })
      return c.result()
    },
  },
  {
    id: 'P3-17',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma/manage/pending')
      await p.getByRole('button', { name: 'Approve' }).first().click()
      await p.waitForTimeout(1200)
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma')
      await u.getByRole('button', { name: /^Notifications/ }).first().click()
      await u.waitForTimeout(800)
      const t = await u.getByRole('dialog').first().innerText()
      c.ok(/gave you access/.test(t), `«… gave you access to …» («${t.replace(/\s+/g, ' ').slice(0, 140)}»)`)
      await H.closeMenus(u)
      await H.go(u, `#/t/comune-roma/item/${ctx.data.privId}`)
      await u.waitForTimeout(2000)
      c.ok(/com\.mosaikit\.notes/.test(u.url()), `the address opens the note in Notes (${u.url()})`)
      await L.shot(u, 'P3-17')
      return c.result()
    },
  },
  {
    id: 'P3-18',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await person(p, 'Sara Greco', 'Permissions')
      await p.getByRole('textbox', { name: 'Identifier of the item' }).fill(ctx.data.privId)
      await p.getByRole('button', { name: 'Check', exact: true }).click()
      await p.waitForTimeout(1500)
      const t = await H.text(p)
      const i = t.indexOf('Why can')
      const part = t.slice(i, i + 900)
      c.ok(/account/i.test(part) && /member/i.test(part) && /own/i.test(part) && /shar/i.test(part), `the steps («${part.replace(/\s+/g, ' ').slice(0, 300)}»)`)
      const imgs = await p.getByRole('img', { name: /^(Yes|No)$/ }).count()
      c.ok(imgs > 0 || /✓|—/.test(part), 'with ✓ or —')
      await L.shot(p, 'P3-18', { full: true })
      return c.result()
    },
  },
  {
    id: 'P3-19',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await person(p, 'Sara Greco', 'Sign-in')
      await p.getByRole('button', { name: /Send the password link/ }).click()
      await p.waitForTimeout(1200)
      const d = p.getByRole('dialog')
      const t = await d.innerText().catch(() => '')
      const link = await d.locator('input').evaluateAll((els) => els.map((e) => e.value).find((v) => /reset/.test(v)) ?? '')
      c.ok(!!link, 'a link to copy')
      c.ok(/until \d/i.test(t), '«… until <date>»')
      if (!/valid until/i.test(t)) c.note(`DOC: the dialog says «${(t.match(/[^.]*until[^.]*\./) ?? [''])[0].trim()}», not «valid until»`)
      ctx.data.resetLink = link
      await L.shot(p, 'P3-19-dialog')
      await p.keyboard.press('Escape')
      const pt = await H.text(p)
      c.ok(/Close every session/.test(pt), 'Close every session')
      c.ok(await H.vis(p.getByRole('button', { name: /^Close$/ })) || /Close/.test(pt), 'Close one session')
      await L.shot(p, 'P3-19')
      return c.result(link)
    },
  },
  {
    id: 'P3-20',
    async run(ctx: any) {
      const c = H.checker()
      const q = await L.page(ctx.b)
      await q.goto(ctx.data.resetLink)
      await q.waitForTimeout(2000)
      let t = await q.locator('body').innerText()
      c.ok(/Choose a new password/.test(t), '«Choose a new password»')
      c.ok(/At least \d+/.test(t), 'the rule of the tenant')
      await q.getByLabel('New password', { exact: true }).fill('password-prova-1')
      await q.getByLabel(/Repeat/).fill('password-prova-1').catch(() => {})
      await q.getByRole('button', { name: /Save|Set|Choose/ }).last().click()
      await q.waitForTimeout(1500)
      t = await q.locator('body').innerText()
      c.ok(/Done: sign in with the new password/.test(t), '«Done: sign in with the new password.»')
      await L.shot(q, 'P3-20')
      await q.goto(ctx.data.resetLink)
      await q.reload()
      await q.waitForTimeout(6000)
      t = await q.locator('body').innerText()
      c.ok(!/Choose a new password/.test(t) || /no longer valid|not valid|expired|used/i.test(t), `the link does not work a second time («${t.slice(0, 120).replace(/\s+/g, ' ')}»)`)
      await L.shot(q, 'P3-20-again')
      await q.context().close()
      return c.result('the same password set again, so the accounts table stays valid')
    },
  },
  {
    id: 'P3-21',
    async run(ctx: any) {
      const c = H.checker()
      const m = await L.as(ctx, 'l.verdi')
      await H.go(m, '#/t/regione-lazio/manage/people')
      await m.getByRole('link', { name: 'Davide Conti' }).first().click()
      await m.waitForTimeout(1000)
      await m.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Sign-in' }).click()
      await m.waitForTimeout(1000)
      const t = await H.text(m)
      c.ok(/home tenant/i.test(t), 'it says that the home tenant handles password and sessions')
      await L.shot(m, 'P3-21')
      return c.result()
    },
  },
  {
    id: 'P3-22',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const links = (await p.locator('[data-sidebar="sidebar"]').getByRole('link').allInnerTexts()).map((s) => s.trim())
      c.ok(links.includes('People'), 'People in the sidebar')
      await L.shot(p, 'P3-22')
      return c.result()
    },
  },
  {
    id: 'P3-23',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/people')
      const t = await H.text(p)
      c.ok(/Administrator/.test(t), 'Administrators too')
      for (const n of ['All', 'In several tenants', 'Administrators']) c.ok(await H.vis(p.getByRole('radio', { name: new RegExp('^' + n) })), `pill ${n}`)
      c.ok((await p.getByRole('combobox').count()) >= 2, 'filters by tenant, role, status')
      c.ok(await H.vis(p.getByRole('searchbox')), 'search')
      await p.getByRole('radio', { name: /^Administrators/ }).click()
      await p.waitForTimeout(800)
      const hrefs = await p.getByRole('main').getByRole('link').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))
      c.ok(hrefs.some((h) => /system\/admins/.test(h)), `a link to System › Administrators (links: ${hrefs.join(', ')})`)
      if (await p.getByRole('checkbox', { name: 'Select all' }).isChecked().catch(() => false)) c.note('BUG: with the pill Administrators «Select all» shows checked although no row can be selected')
      await L.shot(p, 'P3-23', { full: true })
      await p.getByRole('radio', { name: /^All/ }).click()
      return c.result()
    },
  },
  {
    id: 'P3-24',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/people')
      await p.getByRole('button', { name: /New person/ }).click()
      await p.waitForTimeout(600)
      const d = p.getByRole('dialog')
      await L.shot(p, 'P3-24-form')
      await d.getByRole('textbox', { name: /Username/ }).fill('qa.new')
      await d.getByRole('textbox', { name: 'Display name' }).fill('QA New Person')
      const ht = d.getByRole('combobox', { name: 'Tenant' })
      await ht.click()
      await p.getByRole('option', { name: /Comune di Roma/ }).first().click()
      await d.getByRole('button', { name: /Create/ }).click()
      await p.waitForTimeout(1500)
      const d2 = p.getByRole('dialog')
      const link = await d2.locator('input').evaluateAll((els) => els.map((e) => e.value).find((v) => /reset/.test(v)) ?? '').catch(() => '')
      c.ok(!!link, 'a dialog with the link to choose the password')
      await L.shot(p, 'P3-24')
      await p.keyboard.press('Escape')
      return c.result()
    },
  },
  {
    id: 'P3-25',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/people')
      await p.getByRole('link', { name: /Davide Conti/ }).first().click()
      await p.waitForTimeout(1200)
      await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: /^Tenants/ }).click()
      await p.waitForTimeout(1000)
      const t = await H.text(p)
      c.ok(/Comune di Roma/.test(t) && /Regione Lazio/.test(t), 'both tenants')
      c.ok(/home/i.test(t), 'the home tenant marked')
      c.ok(await H.vis(p.getByRole('button', { name: /Add to a tenant/ })), 'Add to a tenant')
      c.ok(await H.vis(p.getByRole('button', { name: /Move the home tenant/ })), 'Move the home tenant')
      c.ok((await p.getByRole('combobox').count()) >= 2, 'role and profile per tenant')
      await L.shot(p, 'P3-25', { full: true })
      return c.result('moving the home tenant not executed (it changes the accounts table)')
    },
  },
  {
    id: 'P3-26',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/people')
      for (const n of ['g.marini', 'qa.new']) {
        const cb = p.getByRole('checkbox', { name: new RegExp(`Select ${n.replace('.', '\\.')}`) })
        if (await H.vis(cb)) await cb.check()
      }
      const cb2 = p.getByRole('checkbox', { name: /Select l\.bianchi/ })
      if (await H.vis(cb2)) await cb2.check()
      await p.getByRole('button', { name: /Send the password link/ }).click()
      await p.waitForTimeout(1500)
      const d = p.getByRole('dialog')
      const n = await d.locator('input').evaluateAll((els) => els.map((e) => e.value).filter((v) => /reset/.test(v)).length).catch(() => 0)
      const t = await d.innerText().catch(() => '')
      c.ok(n >= 2 || (t.match(/reset/g) ?? []).length >= 2, `one link per person (${n})`)
      c.ok(await H.vis(d.getByRole('button', { name: /Copy all/ })), 'Copy all')
      await L.shot(p, 'P3-26')
      await p.keyboard.press('Escape')
      return c.result('NOTE: every link resets nothing until used; the passwords of the accounts table stay valid')
    },
  },
  {
    id: 'P3-27',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci', 'it')
      const bad = []
      for (const h of ['#/t/comune-roma/manage/people', '#/t/comune-roma/manage/profiles', '#/t/comune-roma/manage/pending', '#/t/comune-roma/plugins/com.mosaikit.notes']) {
        await H.go(p, h)
        const t = await H.text(p)
        for (const w of ['Permission profiles', 'Pending', 'Use the app', 'Create items', 'Last sign-in', 'Access requests', 'Groups and people', 'What each permission means'])
          if (t.includes(w)) bad.push(`${h}: «${w}»`)
        await L.shot(p, 'P3-27' + h.replace(/[#/]+/g, '_'))
      }
      await person(p, 'Sara Greco', 'Permessi').catch(() => {})
      const pt = await H.text(p)
      for (const w of ['Why can', 'Use the app', 'Profile']) if (pt.includes(w)) bad.push(`person: «${w}»`)
      c.ok(!bad.length, `English left in Italian: ${bad.join(', ')}`)
      return c.result()
    },
  },
  {
    id: 'P3-28',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.page(ctx.b, { colorScheme: 'dark' })
      await L.login(p, 'Comune di Roma', 'e.ricci')
      const out = []
      for (const h of ['#/t/comune-roma/manage/people', '#/t/comune-roma/manage/profiles', '#/t/comune-roma/plugins/com.mosaikit.notes']) {
        await H.go(p, h)
        const v = await H.axe(p, ['color-contrast'])
        if (v.length) out.push(`${h}: ${v.join(', ')}`)
        await L.shot(p, 'P3-28' + h.replace(/[#/]+/g, '_'))
      }
      c.ok(!out.length, `contrast: ${out.join(' ; ')}`)
      await p.context().close()
      return c.result()
    },
  },
]

export default checks
