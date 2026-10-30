// Deployer allow-list for http.fetch and seeding of settings and platform keys (docs/manual-tests.md, SEED-xx).
// The checks that need a server started with the fixture tests/fixtures/seed-check.toml are skipped (NOT VERIFIABLE)
// unless the run says so with SEED_FIXTURE=1.
import * as H from '../h.ts'
import * as L from '../lib.ts'

const WHOLE = 'seed-check-1234'
const fixture = () => process.env.SEED_FIXTURE === '1'

const checks: L.Check[] = [
  {
    id: 'SEED-01',
    async run() {
      return { status: 'NOT VERIFIABLE', note: 'the harness server runs with allow_private_fetch; covered by deployer_allow_list_of_private_destinations (kernel test)' }
    },
  },
  {
    id: 'SEED-02',
    async run() {
      if (!fixture()) return { status: 'NOT VERIFIABLE', note: 'needs the server started with tests/fixtures/seed-check.toml (SEED_FIXTURE=1)' }
      const c = H.checker()
      const a = await L.apiAdmin()
      const keys = await a.call('GET', '/mosaikit/api/admin/keys')
      const k = (keys as any[]).find((x) => x.service === 'translate')
      c.ok(!!k && k.set === true, 'the seeded key of translate is set')
      c.ok(!!k && k.shared === true, 'it is shared, as the seed file says')
      c.ok(!!k && k.hint === WHOLE.slice(-4), 'only the last four characters are shown')
      c.ok(!JSON.stringify(keys).includes(WHOLE), 'the whole value is not in the answer')
      return c.result()
    },
  },
  {
    id: 'SEED-03',
    async run() {
      if (!fixture()) return { status: 'NOT VERIFIABLE', note: 'needs the server started with tests/fixtures/seed-check.toml (SEED_FIXTURE=1)' }
      const c = H.checker()
      const a = await L.apiAdmin()
      try {
        await a.call('PUT', '/mosaikit/api/admin/keys/translate', { value: 'admin-chosen-9999' })
        let k = ((await a.call('GET', '/mosaikit/api/admin/keys')) as any[]).find((x) => x.service === 'translate')
        c.ok(k?.hint === '9999', 'the Administrator replaces the seeded key')
        await a.call('DELETE', '/mosaikit/api/admin/keys/translate')
        k = ((await a.call('GET', '/mosaikit/api/admin/keys')) as any[]).find((x) => x.service === 'translate')
        c.ok(k?.set === false, 'and removes it: it does not come back while the server runs')
        c.note('the restart that proves the seed is not applied again is the kernel test a_deployment_seeds_settings_and_keys_without_overwriting_the_administrator')
      } finally {
        await a.call('DELETE', '/mosaikit/api/admin/keys/translate').catch(() => {})
      }
      return c.result()
    },
  },
  {
    id: 'SEED-04',
    async run() {
      return { status: 'NOT VERIFIABLE', note: 'needs a restart with a changed seed file; covered by a_seed_never_overwrites_a_value_set_before_it (kernel test)' }
    },
  },
  {
    id: 'SEED-05',
    async run() {
      return { status: 'NOT VERIFIABLE', note: 'an xtask check; covered by dist::tests' }
    },
  },
]

export default checks
