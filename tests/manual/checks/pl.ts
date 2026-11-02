// Public link pages: settings and commands (docs/manual-tests.md, PL-xx). The plugin with public settings and
// commands is a test package with logic: PL-03 to PL-06 are covered by kernel and server tests.
import { request } from '@playwright/test'
import * as H from '../h.ts'
import * as L from '../lib.ts'

const KERNEL_TESTS = 'crates/kernel/tests/public_commands.rs and public_settings_and_commands_over_http in crates/server/tests/http.rs'

const checks: L.Check[] = [
  {
    id: 'PL-01',
    async run() {
      const c = H.checker()
      const m = await L.apiUser('comune-roma', 'e.ricci')
      const path = '/mosaikit/api/t/comune-roma/manage/settings'
      const s = await m.call('GET', path)
      c.ok(s.public_commands_enabled === false, 'public commands are off by default')
      await m.call('PUT', path, { ...s, public_commands_enabled: true })
      c.ok((await m.call('GET', path)).public_commands_enabled === true, 'the Tenant Manager can turn them on')
      await m.call('PUT', path, { ...s, public_commands_enabled: false })
      c.ok((await m.call('GET', path)).public_commands_enabled === false, 'and off again')
      const a = await L.apiAdmin()
      const list = (await a.call('GET', '/mosaikit/api/admin/plugins')) as any[]
      c.ok(list.every((p) => Array.isArray(p.public_commands)), 'every plugin tells the Administrator which public commands it declares')
      c.ok(list.every((p) => p.public_commands.length === 0), 'the official plugins declare none')
      return c.result()
    },
  },
  {
    id: 'PL-02',
    async run() {
      const c = H.checker()
      const u = await L.apiUser('comune-roma', 's.greco')
      const note = await u.call('POST', '/mosaikit/api/t/comune-roma/p/com.mosaikit.notes/r/notes', { values: { title: 'PL note', body: 'x' } })
      const link = await u.call('POST', `/mosaikit/api/t/comune-roma/resources/${note.id}/links`, {})
      const base = link.url as string
      const anon = await request.newContext()
      try {
        const cfg = await anon.get(`${base}config`)
        c.ok(cfg.status() === 200 && JSON.stringify(await cfg.json()) === '{}', 'a plugin with no public setting gives the page an empty object')
        const call = await anon.post(`${base}call/anything`, { headers: { 'content-type': 'application/json' }, data: '{}' })
        c.ok(call.status() === 403 && (await call.json()).code === 'command_not_public', 'a command the plugin does not declare is refused (403 command_not_public)')
        const form = await anon.post(`${base}call/anything`, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, data: 'a=b' })
        c.ok(form.status() === 400, 'a form post is refused (JSON only)')
        const links = (await u.call('GET', `/mosaikit/api/t/comune-roma/resources/${note.id}/links`)) as any[]
        for (const l of links) await u.call('DELETE', `/mosaikit/api/t/comune-roma/links/${l.id}`)
        c.ok((await anon.get(`${base}config`)).status() === 404, 'a revoked link gives nothing (404)')
        c.ok((await anon.post(`${base}call/anything`, { headers: { 'content-type': 'application/json' }, data: '{}' })).status() === 404, 'nor does it run a command')
      } finally {
        await anon.dispose()
      }
      return c.result()
    },
  },
  {
    id: 'PL-03',
    async run() {
      return { status: 'NOT VERIFIABLE', note: `needs a signed test package with logic and public commands; automated twin: ${KERNEL_TESTS}` }
    },
  },
  {
    id: 'PL-04',
    async run() {
      return { status: 'NOT VERIFIABLE', note: `needs a signed test package with logic and public commands; automated twin: ${KERNEL_TESTS}` }
    },
  },
  {
    id: 'PL-05',
    async run() {
      return { status: 'NOT VERIFIABLE', note: `needs a signed test package with logic and public commands; automated twin: ${KERNEL_TESTS}` }
    },
  },
  {
    id: 'PL-06',
    async run() {
      return { status: 'NOT VERIFIABLE', note: `needs a signed test package with logic and public commands; automated twin: ${KERNEL_TESTS}` }
    },
  },
]

export default checks
