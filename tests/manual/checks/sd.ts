// Schedules: the worker that runs the jobs (docs/manual-tests.md, SD-xx). A plugin with `[[schedules]]` and a
// service to push to are a test package with logic and a fake service: SD-02 to SD-07 are covered by the kernel
// and server tests, SD-01 is run here against the seeded instance.
import { request } from '@playwright/test'
import * as H from '../h.ts'
import * as L from '../lib.ts'

const KERNEL_TESTS = 'crates/kernel/tests/schedule_worker.rs (PostgreSQL and SQLite), crates/kernel/src/cron.rs and schedule_runs_over_http in crates/server/tests/http.rs'

const needsPackage = (what: string) => ({
  async run() {
    return { status: 'NOT VERIFIABLE' as const, note: `needs a signed test package with logic, schedules and a fake service (${what}); automated twin: ${KERNEL_TESTS}` }
  },
})

const checks: L.Check[] = [
  {
    id: 'SD-01',
    async run() {
      const c = H.checker()
      const u = await L.apiUser('comune-roma', 's.greco')
      const a = await L.apiAdmin()
      const list = (await a.call('GET', '/mosaikit/api/admin/plugins')) as any[]
      c.ok(list.every((p) => !p.manifest?.schedules?.length), 'the official plugins declare no schedules')
      let refused = ''
      try {
        await u.call('POST', '/mosaikit/api/t/comune-roma/schedules', { plugin: 'com.mosaikit.notes', name: 'x', cron: '0 3 * * *' })
      } catch (e) {
        refused = String(e)
      }
      c.ok(refused.includes('400') && refused.includes('schedule_not_declared'), 'registering a schedule of Notes is refused (400 schedule_not_declared)')
      // a made-up id does not exist: run, take-over and runs answer 404
      const id = '00000000-0000-4000-8000-000000000000'
      for (const [method, tail] of [['POST', 'run'], ['POST', 'take-over'], ['GET', 'runs']] as const) {
        let out = ''
        try {
          await u.call(method, `/mosaikit/api/t/comune-roma/schedules/${id}/${tail}`)
        } catch (e) {
          out = String(e)
        }
        c.ok(out.includes('404'), `${tail} of an id that does not exist answers 404`)
      }
      // nobody without a session
      const anon = await request.newContext({ baseURL: L.ORIGIN })
      try {
        for (const [method, p] of [['POST', 'run'], ['POST', 'take-over'], ['GET', 'runs']] as const) {
          const r = await anon.fetch(`/mosaikit/api/t/comune-roma/schedules/${id}/${p}`, { method, headers: { 'content-type': 'application/json' } })
          c.ok(r.status() === 401, `no session, no ${p} (401)`)
        }
      } finally {
        await anon.dispose()
      }
      return c.result()
    },
  },
  {
    id: 'SD-02',
    ...needsPackage('push with the shared key, run id stored, result read, ticket ended'),
  },
  {
    id: 'SD-03',
    ...needsPackage('the gate on the rights of the author'),
  },
  {
    id: 'SD-04',
    ...needsPackage('five failures pause the schedule, a run past its limit times out'),
  },
  {
    id: 'SD-05',
    ...needsPackage('time zone, daylight saving time, missed runs and the catch-up flag'),
  },
  {
    id: 'SD-06',
    ...needsPackage('takeover by a Tenant Manager and run-now'),
  },
  {
    id: 'SD-07',
    ...needsPackage('two workers claim a schedule once'),
  },
]

export default checks
