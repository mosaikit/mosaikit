// Overview by role (docs/manual-tests.md, OVR-xx): the same page, a different content for the User, the Tenant Manager
// and the Administrator; light and dark.
import * as H from '../h.ts'
import * as L from '../lib.ts'

async function heroAndDark(p: any, c: ReturnType<typeof H.checker>, who: string, id: string) {
  c.ok(await H.vis(p.getByTestId('ov-hero')), `${who}: the hero strip`)
  await p.emulateMedia({ colorScheme: 'dark' })
  await p.waitForTimeout(600)
  c.ok(await p.evaluate(() => document.documentElement.classList.contains('dark')), `${who}: dark mode is on`)
  const v = await H.axe(p, ['color-contrast'])
  c.ok(v.length === 0, `${who}: dark mode reads (${v.join('; ').slice(0, 120)})`)
  await L.shot(p, `${id}-dark`)
  await p.emulateMedia({ colorScheme: 'light' })
  await p.waitForTimeout(600)
  await L.shot(p, `${id}-light`)
}

const checks: L.Check[] = [
  {
    id: 'OVR-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      await H.go(p, '#/t/comune-roma')
      await p.getByRole('heading', { name: 'My week' }).waitFor({ timeout: 20000 })
      c.ok(await H.vis(p.getByRole('heading', { name: 'Pick up where you left off' })), 'pick up')
      c.ok((await p.getByRole('heading', { name: 'Usage by app' }).count()) === 0, 'nothing of the tenant: no usage by app')
      c.ok((await p.getByRole('heading', { name: 'Active people' }).count()) === 0, 'nothing of the tenant: no active people')
      await heroAndDark(p, c, 'User', 'OVR-01')
      return c.result()
    },
  },
  {
    id: 'OVR-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma')
      await p.getByRole('heading', { name: 'Usage by app' }).waitFor({ timeout: 20000 })
      for (const h of ['Waiting for you', 'Active people', 'Recent activity', 'Your space']) c.ok(await H.vis(p.getByRole('heading', { name: h, exact: true })), h)
      c.ok(await H.vis(p.getByText('Members', { exact: true }).first()), 'members card')
      await heroAndDark(p, c, 'Tenant Manager', 'OVR-02')
      return c.result()
    },
  },
  {
    id: 'OVR-03',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      await H.go(p, '#/admin')
      await p.getByTestId('ov-hero').waitFor({ timeout: 20000 })
      c.ok(await H.vis(p.getByText('Active tenants', { exact: true })), 'active tenants card')
      c.ok((await p.getByRole('heading', { name: 'My week' }).count()) === 0, 'no personal week')
      await heroAndDark(p, c, 'Administrator', 'OVR-03')
      return c.result()
    },
  },
]

export default checks
