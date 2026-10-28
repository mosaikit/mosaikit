// Feedback C — emails of the accounts, brochure of the plugins, mail server page, translation of a note.
// One entry per check id of docs/manual-tests.md.
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as H from '../h.ts'
import * as L from '../lib.ts'

const PLUGINS = ['notes', 'tasks', 'maps', 'static-site', 'files', 'contacts', 'note-review', 'layout-project', 'layout-suite', 'layout-tabs', 'layout-workspace', 'lang-es']

const checks: L.Check[] = [
  {
    id: 'FC-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/account')
      await p.waitForTimeout(1000)
      const mine = (await p.locator('#me-email').textContent().catch(() => '')) ?? ''
      c.ok(/@example\.test$/.test(mine.trim()), `the email of the Administrator shows (${mine.trim() || 'none'})`)
      await p.getByRole('button', { name: /Change email|Add the email/ }).click()
      const d = p.getByRole('dialog', { name: 'Your email address' })
      await d.getByLabel('Email').fill('root@example.test')
      await d.getByLabel('Current password').fill('wrong-password-1')
      const code = d.getByLabel('Code of the authenticator app')
      if (await H.vis(code)) await code.fill(await L.freshCode())
      await d.getByRole('button', { name: 'Save' }).click()
      const bad = await H.toast(p)
      c.ok(/current password is not correct/.test(bad), `a wrong password is refused with a message («${bad.slice(0, 80)}»)`)
      await d.getByLabel('Current password').fill(L.ADMIN_PASSWORD)
      if (await H.vis(code)) await code.fill(await L.freshCode())
      await d.getByRole('button', { name: 'Save' }).click()
      await p.waitForTimeout(1500)
      const now = ((await p.locator('#me-email').textContent().catch(() => '')) ?? '').trim()
      c.ok(now === 'root@example.test', `the new address shows (${now})`)
      await L.shot(p, 'FC-01')
      // put it back
      await p.getByRole('button', { name: 'Change email' }).click()
      await d.getByLabel('Email').fill('admin@example.test')
      await d.getByLabel('Current password').fill(L.ADMIN_PASSWORD)
      if (await H.vis(code)) await code.fill(await L.freshCode())
      await d.getByRole('button', { name: 'Save' }).click()
      await p.waitForTimeout(1500)
      return c.result()
    },
  },
  {
    id: 'FC-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const a = await L.apiAdmin()
      const have = (await a.call('GET', '/mosaikit/api/admin/administrators')) as { username: string }[]
      if (!have.some((x) => x.username === 'fc-second')) {
        await a.call('POST', '/mosaikit/api/admin/administrators', { username: 'fc-second', display_name: 'Second Admin', email: 'fc-second@example.test', password: 'password-prova-1' })
      }
      await H.go(p, '#/admin/system/admins')
      await p.getByRole('button', { name: 'New Administrator' }).click()
      const n = p.getByRole('dialog', { name: 'New Administrator' })
      c.ok(await H.vis(n.getByLabel('Email')), 'the new Administrator form asks for the email')
      await p.keyboard.press('Escape')
      const row = p.getByRole('row', { name: /fc-second/ })
      await row.getByRole('button', { name: /Actions for/ }).click()
      await p.getByRole('menuitem', { name: 'Edit name and email' }).click()
      const d = p.getByRole('dialog', { name: /Data of/ })
      await d.getByLabel('Email').fill('admin@example.test')
      await d.getByRole('button', { name: 'Save' }).click()
      const dup = await H.toast(p)
      c.ok(/already used by another account/.test(dup), `an address in use is refused («${dup.slice(0, 80)}»)`)
      await d.getByLabel('Name').fill('Second Admin Edited')
      await d.getByLabel('Email').fill('fc-second2@example.test')
      await d.getByRole('button', { name: 'Save' }).click()
      await p.waitForTimeout(1500)
      c.ok(/fc-second2@example\.test/.test(await p.getByRole('row', { name: /fc-second/ }).innerText()), 'the new name and email show in the list')
      await row.getByRole('button', { name: /Actions for/ }).click()
      await p.getByRole('menuitem', { name: 'Edit name and email' }).click()
      await d.getByLabel('Email').fill('')
      await d.getByRole('button', { name: 'Save' }).click()
      c.ok((await H.vis(d)) && (await d.getByLabel('Email').evaluate((e: HTMLInputElement) => e.validity.valueMissing)), 'the form does not send an empty email')
      await p.keyboard.press('Escape')
      // own row: the name only
      await p.getByRole('row', { name: /admin/ }).first().getByRole('button', { name: /Actions for/ }).click()
      await p.getByRole('menuitem', { name: 'Edit name and email' }).click()
      c.ok(!(await H.vis(d.getByLabel('Email'))) && /Account/.test(await d.innerText()), 'on the own row only the name, and a sentence sends to Account')
      await L.shot(p, 'FC-02')
      await p.keyboard.press('Escape')
      return c.result()
    },
  },
  {
    id: 'FC-03',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma/account')
      await p.waitForTimeout(800)
      const t = await H.text(p)
      c.ok(/email is changed by the Tenant Manager/.test(t), 'the Details text says who changes the email')
      c.ok(!(await H.vis(p.getByRole('button', { name: /Change email|Add the email/ }))), 'no Change email button')
      await L.shot(p, 'FC-03')
      return c.result()
    },
  },
  {
    id: 'FC-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const bad: string[] = []
      for (const [mode, width] of [['light', 1280], ['light', 390], ['dark', 1280], ['dark', 390]] as const) {
        await p.setViewportSize({ width, height: width < 600 ? 844 : 800 })
        await H.setMode(p, mode)
        for (const id of PLUGINS) {
          await H.go(p, `#/admin/plugin/com.mosaikit.${id}`)
          const pic = p.getByTestId('plugin-gallery').locator('img').first()
          if (!(await H.vis(pic))) {
            bad.push(`${id}: no picture`)
            continue
          }
          if (!(await pic.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0))) bad.push(`${id}: the picture does not load`)
          if (!(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))) bad.push(`${id}: scrolls sideways at ${width}`)
          const t = await p.getByTestId('plugin-brochure').innerText()
          for (const w of ['About', 'Permissions and requirements', 'Publisher', 'Author', 'Licence']) if (!t.includes(w)) bad.push(`${id}: no «${w}»`)
        }
        await H.go(p, '#/admin/plugin/com.mosaikit.notes')
        await L.shot(p, `FC-04-${mode}-${width}`, { full: true })
        if (width === 1280 && mode === 'light') {
          await p.getByRole('button', { name: 'Enlarge the picture' }).click()
          const box = p.getByTestId('plugin-lightbox')
          c.ok(await H.vis(box.locator('img')), 'the picture opens large')
          await p.keyboard.press('ArrowRight')
          c.ok(/Picture 2 of/.test(await box.innerText()), 'the arrow key shows the next picture')
          await p.keyboard.press('Escape')
          c.ok(!(await H.vis(box)), 'Esc closes it')
        }
        const ax = await H.axe(p, ['color-contrast'])
        if (ax.length) bad.push(`contrast in ${mode} ${width}: ${ax.join('; ').slice(0, 160)}`)
      }
      await p.setViewportSize({ width: 1280, height: 800 })
      await H.setMode(p, 'light')
      for (const b of bad) c.ok(false, b)
      return c.result()
    },
  },
  {
    id: 'FC-05',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      const a = await L.apiAdmin()
      const saved = await a.call('GET', '/mosaikit/api/admin/email')
      await a.call('PUT', '/mosaikit/api/admin/email', { host: '', port: 587, security: 'starttls', username: '', sender: '', footer: '' })
      await H.go(p, '#/admin/system/email')
      await p.reload()
      await p.waitForTimeout(1500)
      const setup = p.getByTestId('mail-setup')
      c.ok(/Missing: the SMTP server, the sender/.test(await setup.innerText().catch(() => '')), 'the card says what is missing')
      c.ok(await p.getByRole('button', { name: 'Send a test' }).isDisabled(), 'Send a test is off')
      await setup.getByRole('button', { name: 'Set up' }).click()
      c.ok(await p.getByLabel('SMTP server').evaluate((e) => e === document.activeElement), 'Set up puts the cursor in SMTP server')
      await setup.getByRole('button', { name: 'Fill in for a local test server' }).click()
      c.ok((await p.getByLabel('SMTP server').inputValue()) === 'localhost' && (await p.getByLabel('Port', { exact: true }).inputValue()) === '1025', 'the preset fills localhost:1025')
      c.ok(/--profile mail/.test(await setup.innerText()), 'the Mailpit line is there')
      await L.shot(p, 'FC-05', { full: true })
      // put the server back as it was
      await a.call('PUT', '/mosaikit/api/admin/email', { host: saved.host, port: saved.port, security: saved.security, username: saved.username, sender: saved.sender, footer: saved.footer })
      return c.result()
    },
  },
  {
    id: 'FC-06',
    async run(ctx: any) {
      const c = H.checker()
      const seen: { auth: string | undefined; body: string }[] = []
      const server = http.createServer((req, res) => {
        let body = ''
        req.on('data', (x) => (body += x))
        req.on('end', () => {
          seen.push({ auth: req.headers.authorization, body })
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ translatedText: (JSON.parse(body).q as string[]).map((x) => `[it] ${x}`) }))
        })
      })
      await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
      const port = (server.address() as AddressInfo).port
      const a = await L.apiAdmin()
      try {
        await a.call('DELETE', '/mosaikit/api/admin/keys/translate').catch(() => {})
        await a.call('DELETE', '/mosaikit/api/admin/keys/translate-endpoint').catch(() => {})
        const p = await L.as(ctx, 'e.ricci')
        const f = await H.openNote(p, 'Budget 2027')
        await f.getByRole('button', { name: 'Translate note' }).click()
        await p.waitForTimeout(1500)
        c.ok(/No translation key is set/.test(await f.locator('body').innerText()), 'without a key a clear message')
        c.ok(seen.length === 0, 'nothing was sent')
        await a.call('PUT', '/mosaikit/api/admin/keys/translate', { value: 'sk-manual-translate', shared: true })
        await a.call('PUT', '/mosaikit/api/admin/keys/translate-endpoint', { value: `http://127.0.0.1:${port}`, shared: true })
        await f.getByRole('button', { name: 'Translate note' }).click()
        await p.waitForTimeout(2500)
        c.ok(/\[it\] Budget 2027/.test(await f.locator('body').innerText()), 'the translated title shows')
        c.ok(seen.length === 1 && seen[0].auth === 'Bearer sk-manual-translate', 'the service got the key as a bearer token')
        c.ok(!(await p.content()).includes('sk-manual-translate'), 'the key is not in the page')
        await L.shot(p, 'FC-06')
      } finally {
        await a.call('DELETE', '/mosaikit/api/admin/keys/translate').catch(() => {})
        await a.call('DELETE', '/mosaikit/api/admin/keys/translate-endpoint').catch(() => {})
        await new Promise((ok) => server.close(ok))
      }
      return c.result()
    },
  },
  {
    id: 'FC-07',
    async run() {
      const c = H.checker()
      const m = await L.apiUser('comune-roma', 'e.ricci')
      const list = (await m.call('GET', '/mosaikit/api/t/comune-roma/manage/members')) as { username: string; email: string | null }[]
      for (const u of ['e.ricci', 'm.esposito', 's.greco', 'l.bianchi', 'd.conti']) {
        const x = list.find((y) => y.username === u)
        c.ok(x?.email === `${u}@example.test`, `${u} has ${u}@example.test (${x?.email ?? 'missing'})`)
      }
      const v = await L.apiUser('regione-lazio', 'l.verdi')
      const lz = (await v.call('GET', '/mosaikit/api/t/regione-lazio/manage/members')) as { username: string; email: string | null }[]
      c.ok(lz.find((y) => y.username === 'l.verdi')?.email === 'l.verdi@example.test', 'l.verdi has l.verdi@example.test')
      const a = await L.apiAdmin()
      const adm = (await a.call('GET', '/mosaikit/api/admin/administrators')) as { username: string; email: string | null }[]
      c.ok(!!adm.find((y) => y.username === 'admin')?.email, 'the Administrator has an email')
      return c.result()
    },
  },
]

export default checks
