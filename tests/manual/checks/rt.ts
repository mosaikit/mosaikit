// Run tickets: a plugin called on behalf of a background run (docs/manual-tests.md, RT-xx). A plugin with
// `permissions.run_commands` is a test package with logic: RT-02 to RT-08 are covered by kernel and server tests.
import { request } from '@playwright/test'
import * as H from '../h.ts'
import * as L from '../lib.ts'

const KERNEL_TESTS = 'crates/kernel/tests/run_tickets.rs (PostgreSQL and SQLite), crates/db/tests/rls.rs and run_tickets_over_http in crates/server/tests/http.rs'

const needsPackage = (what: string) => ({
  async run() {
    return { status: 'NOT VERIFIABLE' as const, note: `needs a signed test package with logic and run commands (${what}); automated twin: ${KERNEL_TESTS}` }
  },
})

const checks: L.Check[] = [
  {
    id: 'RT-01',
    async run() {
      const c = H.checker()
      const u = await L.apiUser('comune-roma', 's.greco')
      const a = await L.apiAdmin()
      const list = (await a.call('GET', '/mosaikit/api/admin/plugins')) as any[]
      c.ok(list.every((p) => !p.permissions?.run_commands?.length), 'the official plugins declare no run commands')
      // a plugin that declares none cannot be the target of a ticket
      let refused = ''
      try {
        await u.call('POST', '/mosaikit/api/t/comune-roma/run-tickets', { plugin: 'com.mosaikit.notes', commands: ['x'], run_ref: 'RT-01' })
      } catch (e) {
        refused = String(e)
      }
      c.ok(refused.includes('400') && refused.includes('no_run_commands'), 'minting a ticket for a plugin without run commands is refused (400 no_run_commands)')
      // nobody without a session mints, and a made-up ticket opens nothing
      const anon = await request.newContext({ baseURL: L.ORIGIN })
      try {
        const m = await anon.post('/mosaikit/api/t/comune-roma/run-tickets', {
          headers: { 'content-type': 'application/json' },
          data: JSON.stringify({ plugin: 'com.mosaikit.notes', commands: ['x'], run_ref: 'RT-01' }),
        })
        c.ok(m.status() === 401, 'no session, no ticket (401)')
        const forged = 'ab'.repeat(24)
        const r = await anon.post(`/mosaikit/api/run/${forged}/call/com.mosaikit.notes/x`, { headers: { 'content-type': 'application/json' }, data: '{}' })
        c.ok(r.status() === 401 && (await r.json()).code === 'run_ticket_invalid', 'a made-up ticket is refused (401 run_ticket_invalid)')
        const form = await anon.post(`/mosaikit/api/run/${forged}/call/com.mosaikit.notes/x`, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, data: 'a=b' })
        c.ok(form.status() === 400, 'a form post is refused (JSON only)')
      } finally {
        await anon.dispose()
      }
      return c.result()
    },
  },
  {
    id: 'RT-02',
    ...needsPackage('mint, redeem, on_behalf in the context, audit'),
  },
  {
    id: 'RT-03',
    ...needsPackage('expired, spent, revoked and finished tickets'),
  },
  {
    id: 'RT-04',
    ...needsPackage('wrong plugin, undeclared command, command outside the minted subset, an update that drops the declaration'),
  },
  {
    id: 'RT-05',
    ...needsPackage('resource scope enforced by the database, other tenant'),
  },
  {
    id: 'RT-06',
    ...needsPackage('rights reduced, suspended or removed after minting'),
  },
  {
    id: 'RT-07',
    ...needsPackage('forged token, raw token not stored, size limits, rate limits'),
  },
  {
    id: 'RT-08',
    ...needsPackage('the Administrator review lists the commands at install'),
  },
]

export default checks
