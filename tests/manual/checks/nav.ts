// Grouped sidebar navigation (docs/manual-tests.md, NAV-xx). The groups come from the distribution; the checks that need
// them run only with the server started on tests/fixtures/nav-groups-check.toml and NAV_FIXTURE=1.
import * as H from '../h.ts'
import * as L from '../lib.ts'

const fixture = () => process.env.NAV_FIXTURE === '1'
const brand = async () => (await fetch(new URL('api/brand', L.BASE))).json() as Promise<{ nav_groups?: any[] }>

const checks: L.Check[] = [
  {
    id: 'NAV-01',
    async run() {
      if (!fixture()) return { status: 'NOT VERIFIABLE', note: 'needs the server started with tests/fixtures/nav-groups-check.toml (NAV_FIXTURE=1); the open sidebar is driven by specs/19-nav-groups.spec.ts' }
      const c = H.checker()
      const g = (await brand()).nav_groups ?? []
      c.ok(g.map((x) => x.id).join() === 'work,data', 'both groups are sent, in order')
      c.ok(g[0]?.i18n?.it?.label === 'Lavoro', 'the Italian label is sent')
      c.ok(!g[1]?.plugins.includes('com.mosaikit.notes'), 'a plugin listed in two groups stays in the first')
      return c.result()
    },
  },
  {
    id: 'NAV-02',
    async run() {
      return { status: 'NOT VERIFIABLE', note: 'the closed rail menu (click and hover), the keyboard and the focus return are driven by specs/19-nav-groups.spec.ts (Playwright e2e)' }
    },
  },
  {
    id: 'NAV-03',
    async run() {
      return { status: 'NOT VERIFIABLE', note: 'needs a restart with a faulty file; covered by navgroups::tests (kernel), dist::tests (xtask) and navgroups.test.ts (host)' }
    },
  },
  {
    id: 'NAV-04',
    async run() {
      if (fixture()) return { status: 'NOT VERIFIABLE', note: 'a plain run (without the fixture) is needed to check that nothing is grouped' }
      const c = H.checker()
      c.ok(((await brand()).nav_groups ?? []).length === 0, 'without nav_groups the brand carries none: the sidebar stays flat')
      return c.result()
    },
  },
  {
    id: 'NAV-05',
    async run() {
      return { status: 'NOT VERIFIABLE', note: 'visual (no separators or lines, soft active state, indentation, icons in the menus); driven by specs/19-nav-groups.spec.ts (Playwright e2e)' }
    },
  },
  {
    id: 'NAV-06',
    async run() {
      return { status: 'NOT VERIFIABLE', note: 'visual (footer entries at the bottom of the closed bar, names under the icons switched off); driven by specs/19-nav-groups.spec.ts (Playwright e2e)' }
    },
  },
]

export default checks
