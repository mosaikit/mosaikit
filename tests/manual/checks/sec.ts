// Security follow-ups
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import * as H from '../h.ts'
import * as L from '../lib.ts'

const SVG_HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 32">'
/** An SVG file of the run folder. */
function svg(name: string, body: string): string {
  const f = L.out(name)
  fs.writeFileSync(f, `${SVG_HEAD}${body}</svg>`)
  return f
}

const checks: L.Check[] = [
  {
    id: 'SEC-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin/system')
      await p.getByRole('link', { name: 'Identity and appearance' }).click()
      await p.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Identity and texts', exact: true }).click()
      await p.waitForTimeout(800)
      const evil: [string, string][] = [
        ['script', '<script>alert(1)</script><rect width="120" height="32"/>'],
        ['onload', '<rect width="120" height="32" onload="alert(1)"/>'],
        ['image', '<image href="https://example.org/x.png" width="10" height="10"/>'],
        ['style', '<style>rect{fill:red}</style><rect width="120" height="32"/>'],
      ]
      for (const [n, body] of evil) {
        await p.getByLabel('Upload: Logo for light backgrounds').setInputFiles(svg(`evil-${n}.svg`, body))
        const t = await H.toast(p)
        c.ok(/SVG .*not (allowed|accepted)/i.test(t), `${n}: refused («${t.slice(0, 120)}»)`)
        await p.waitForTimeout(3500)
      }
      await p.getByLabel('Upload: Logo for light backgrounds').setInputFiles(
        svg('plain.svg', '<defs><linearGradient id="g"><stop offset="0" stop-color="#0b6e4f"/><stop offset="1" stop-color="#084"/></linearGradient></defs><rect width="120" height="32" rx="6" fill="url(#g)"/><path d="M5 5h20v20z" fill="#fff"/><text x="30" y="22" fill="#fff">Plain</text>'),
      )
      const ok = await H.toast(p)
      c.ok(!/not allowed|refused/i.test(ok), `a plain drawing is accepted («${ok.slice(0, 120)}»)`)
      await L.shot(p, 'SEC-01')
      return c.result()
    },
  },
  {
    id: 'SEC-02',
    async run() {
      const c = H.checker()
      const sg = await L.apiUser('comune-roma', 's.greco')
      const note = await sg.call('POST', '/mosaikit/api/t/comune-roma/p/com.mosaikit.notes/r/notes', { values: { title: 'SEC-02 public', body: 'Visible text', tag: 'work' } })
      const id = note.id ?? note.resource_id ?? note.item?.id
      const link = await sg.call('POST', `/mosaikit/api/t/comune-roma/resources/${id}/links`, {})
      const url: string = link.url ?? link.link?.url
      c.ok(!!url, `a public link (${JSON.stringify(link).slice(0, 100)})`)
      const r = await fetch(url.replace(/\/$/, '') + '/api')
      const body = await r.text()
      c.ok(r.ok, `the public API answers (${r.status})`)
      let fields: string[] = []
      try {
        const j = JSON.parse(body)
        fields = Object.keys(j.values ?? j.record ?? j.item ?? j)
      } catch {
        /* not JSON */
      }
      c.ok(!fields.some((f) => /hidden|password|secret/i.test(f)), `only the fields the plugin shows (${fields.join(', ')})`)
      return c.result('fields a plugin declares hidden never appear: no official plugin has one on its own resources, covered by the automated test of the kernel')
    },
  },
  {
    id: 'SEC-03',
    async run() {
      return { status: 'NOT VERIFIABLE', note: 'needs `[archives] max_entries = 5` in the configuration of the installation and a restart; covered by the automated tests of the kernel (lifecycle_ops)' }
    },
  },
  {
    id: 'SEC-04',
    async run(ctx: any) {
      const c = H.checker()
      const u = await L.as(ctx, 's.greco')
      await H.go(u, '#/t/comune-roma')
      await H.nav(u, 'Static sites')
      const f = await L.pluginFrame(u, 'static-site')
      // a zip with unsafe paths, written by hand (stored entries): con.txt, nul, a. and "name "
      const zip = L.out('unsafe-sites.zip')
      fs.writeFileSync(zip, storedZip({ 'index.html': '<h1>x</h1>', 'con.txt': 'x', nul: 'x', 'a.': 'x', 'name ': 'x' }))
      await f.getByRole('button', { name: /New site/ }).first().click()
      await u.waitForTimeout(800)
      const d = f.getByRole('dialog').first()
      const name = d.getByRole('textbox').first()
      if (await name.count()) await name.fill('Unsafe')
      await f.locator('input[type=file]').first().setInputFiles(zip)
      const go = d.getByRole('button', { name: /Create|Upload|Publish|Save/ }).last()
      if (await go.count()) await go.click()
      await u.waitForTimeout(3000)
      const t = (await f.locator('body').innerText()) + ' ' + (await H.toast(u))
      c.ok(/unsafe|not allowed|refused|invalid/i.test(t), `refused: unsafe path («${t.replace(/\s+/g, ' ').slice(0, 160)}»)`)
      await L.shot(u, 'SEC-04')
      return c.result()
    },
  },
  {
    id: 'SEC-05',
    async run() {
      const c = H.checker()
      const m = await L.apiUser('comune-roma', 'e.ricci')
      const id = L.state().ids['s.greco']
      const r = await m.call('POST', `/mosaikit/api/t/comune-roma/manage/members/${id}/reset-link`, {}).catch((e: Error) => ({ err: e.message }))
      const url: string = r.url ?? r.link ?? ''
      c.ok(!!url, `a password link (${JSON.stringify(r).slice(0, 120)})`)
      if (url) {
        const token = url.split('/reset/')[1] ?? url.split('/').pop()
        const body = { token, password: 'password-prova-sec5' }
        const both = await Promise.all([1, 2].map(() => fetch(L.ORIGIN + '/mosaikit/api/auth/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })))
        const ok = both.filter((x) => x.ok).length
        c.ok(ok === 1, `one request sets the password, the other is refused (${both.map((x) => x.status).join(', ')})`)
        // the password of Sara goes back to the one of the document
        if (ok === 1) {
          const m2 = await L.apiUser('comune-roma', 'e.ricci')
          const r2 = await m2.call('POST', `/mosaikit/api/t/comune-roma/manage/members/${id}/password`, { password: L.PASSWORD }).catch(() => null)
          c.note(r2 ? 'the password of Sara is back to the one of the document' : 'the password of Sara could not be restored through the API')
        }
      }
      return c.result()
    },
  },
  {
    id: 'SEC-06',
    async run() {
      const c = H.checker()
      const f = path.join(L.ROOT, '.dev', 'manual', 'data', 'secret.key')
      c.ok(fs.existsSync(f), `secret.key exists (${f})`)
      if (fs.existsSync(f)) {
        if (process.platform === 'win32') {
          const out = execFileSync('icacls', [f], { encoding: 'utf8' })
          c.ok(!/Everyone|BUILTIN\\Users|Authenticated Users/i.test(out), `no entry for Everyone, Users or Authenticated Users («${out.replace(/\s+/g, ' ').slice(f.length, f.length + 200)}»)`)
          c.ok(!/\(I\)/.test(out), 'no inherited entries')
        } else {
          const mode = fs.statSync(f).mode & 0o777
          c.ok(mode === 0o600, `mode -rw------- (${mode.toString(8)})`)
        }
      }
      return c.result()
    },
  },
  {
    id: 'SEC-07',
    async run(ctx: any) {
      const c = H.checker()
      const q = await L.page(ctx.b)
      const urls: string[] = []
      q.on('request', (r: any) => r.url().startsWith(L.IDP) && urls.push(r.url()))
      await L.fresh(q, '#/login/prova-oidc')
      const btn = q.getByRole('link', { name: /Sign in with/ }).or(q.getByRole('button', { name: /Sign in with/ }))
      await btn.waitFor({ timeout: 20000 })
      await btn.click()
      await q.waitForTimeout(2000)
      await q.getByRole('button', { name: 'Sign in as Anna Rossi' }).click()
      await q.waitForTimeout(3500)
      await q.getByRole('button', { name: /person menu/ }).click()
      await q.getByRole('menuitem', { name: 'Sign out' }).click()
      await q.waitForTimeout(4000)
      c.ok(urls.some((u) => /id_token_hint=/.test(u)), `the logout page of the provider receives id_token_hint (${urls.filter((u) => /logout/.test(u)).map((u) => u.slice(0, 90)).join(' | ')})`)
      await L.shot(q, 'SEC-07')
      await q.context().close()
      return c.result()
    },
  },
  {
    id: 'SEC-08',
    async run() {
      return { status: 'NOT VERIFIABLE', note: 'needs a second server with a wildcard plugin_url; run by `MOSAIKIT_E2E_WILDCARD=1 cargo xtask e2e` (tests/wildcard.spec.ts)' }
    },
  },
  {
    id: 'SEC-09',
    async run() {
      return { status: 'NOT VERIFIABLE', note: 'needs the wildcard installation: run by `MOSAIKIT_E2E_WILDCARD=1 cargo xtask e2e` (tests/wildcard.spec.ts)' }
    },
  },
  {
    id: 'SEC-10',
    async run() {
      return { status: 'NOT VERIFIABLE', note: 'needs the wildcard installation: run by `MOSAIKIT_E2E_WILDCARD=1 cargo xtask e2e` (tests/wildcard.spec.ts)' }
    },
  },
]

/** A zip of stored (not compressed) entries. */
function storedZip(files: Record<string, string>): Buffer {
  const crc = (b: Buffer) => {
    let c = ~0
    for (const x of b) {
      c ^= x
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    return ~c >>> 0
  }
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name)
    const d = Buffer.from(data)
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0)
    h.writeUInt16LE(20, 4)
    h.writeUInt32LE(crc(d), 14)
    h.writeUInt32LE(d.length, 18)
    h.writeUInt32LE(d.length, 22)
    h.writeUInt16LE(n.length, 26)
    parts.push(h, n, d)
    const e = Buffer.alloc(46)
    e.writeUInt32LE(0x02014b50, 0)
    e.writeUInt16LE(20, 4)
    e.writeUInt16LE(20, 6)
    e.writeUInt32LE(crc(d), 16)
    e.writeUInt32LE(d.length, 20)
    e.writeUInt32LE(d.length, 24)
    e.writeUInt16LE(n.length, 28)
    e.writeUInt32LE(offset, 42)
    central.push(e, n)
    offset += 30 + n.length + d.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

export default checks
