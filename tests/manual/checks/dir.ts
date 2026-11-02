// Directory search for plugins (docs/manual-tests.md, DIR-xx). A plugin with `permissions.directory` is a test package
// with logic: DIR-02 to DIR-07 are covered by kernel tests (PostgreSQL and SQLite) and the host tests.
import { request } from '@playwright/test'
import * as H from '../h.ts'
import * as L from '../lib.ts'

const KERNEL_TESTS = 'crates/kernel/tests/directory.rs (PostgreSQL and SQLite) and ui/host/src/bridge.test.ts'

const needsPackage = (what: string) => ({
  async run() {
    return { status: 'NOT VERIFIABLE' as const, note: `needs a signed test package with logic and the directory permission (${what}); automated twin: ${KERNEL_TESTS}` }
  },
})

const checks: L.Check[] = [
  {
    id: 'DIR-01',
    async run() {
      const c = H.checker()
      const u = await L.apiUser('comune-roma', 's.greco')
      const a = await L.apiAdmin()
      const list = (await a.call('GET', '/mosaikit/api/admin/plugins')) as any[]
      c.ok(list.every((p) => !p.permissions?.directory), 'the official plugins do not search the directory')
      // a plugin that does not declare the permission gets nothing, for any person
      let refused = ''
      try {
        await u.call('POST', '/mosaikit/api/t/comune-roma/p/com.mosaikit.notes/directory/search', { kind: 'user', q: 'a' })
      } catch (e) {
        refused = String(e)
      }
      c.ok(refused.includes('403') && refused.includes('permission_denied'), 'a plugin without the permission is refused (403 permission_denied)')
      const anon = await request.newContext({ baseURL: L.ORIGIN })
      try {
        const r = await anon.post('/mosaikit/api/t/comune-roma/p/com.mosaikit.notes/directory/search', {
          headers: { 'content-type': 'application/json' },
          data: JSON.stringify({ kind: 'user', q: 'a' }),
        })
        c.ok(r.status() === 401, 'no session, no search (401)')
      } finally {
        await anon.dispose()
      }
      return c.result()
    },
  },
  {
    id: 'DIR-02',
    ...needsPackage('a caller without the share right, the Tenant Manager, a plugin without the permission'),
  },
  {
    id: 'DIR-03',
    ...needsPackage('other tenant, disabled and suspended people, no email in the answer'),
  },
  {
    id: 'DIR-04',
    ...needsPackage('kind, q and limit checks, order, cap'),
  },
  {
    id: 'DIR-05',
    ...needsPackage('public link and run ticket refusals'),
  },
  {
    id: 'DIR-06',
    ...needsPackage('rate limit and audit event without the query'),
  },
  {
    id: 'DIR-07',
    ...needsPackage('the Administrator review lists the permission at install'),
  },
]

export default checks
