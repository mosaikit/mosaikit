// Plugin API 1: compatibility range, version handshake and error codes (docs/manual-tests.md, API-xx).
import type { Frame } from '@playwright/test'
import * as H from '../h.ts'
import * as L from '../lib.ts'

/** Sends one bridge request from the page of a plugin UI, as its `Bridge` does, and returns the reply. */
async function ask(f: Frame, op: string, args?: unknown): Promise<any> {
  return f.evaluate(
    ([op, args]) =>
      new Promise((resolve) => {
        const host = new URLSearchParams(location.search).get('host') ?? ''
        const id = `api-check-${Math.random()}`
        const on = (ev: MessageEvent) => {
          if (ev.data?.id !== id) return
          removeEventListener('message', on)
          resolve(ev.data)
        }
        addEventListener('message', on)
        parent.postMessage({ msk: 1, id, op, args }, host)
      }),
    [op, args] as [string, unknown],
  )
}

const checks: L.Check[] = [
  {
    id: 'API-01',
    async run() {
      const c = H.checker()
      const a = await L.apiAdmin()
      const list = (await a.call('GET', '/mosaikit/api/admin/plugins')) as any[]
      c.ok(list.length > 0, 'there are installed plugins')
      c.ok(list.every((p) => p.api === 1), 'every plugin was built for plugin API 1')
      c.ok(list.every((p) => typeof p.requires_mosaikit === 'string' && p.requires_mosaikit !== ''), 'every plugin tells the range of Mosaikit it accepts (* when it does not say)')
      c.ok(list.every((p) => p.min_kernel === undefined), 'the old min_kernel is no longer in the answer')
      return c.result()
    },
  },
  {
    id: 'API-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 'admin')
      // a catalog whose latest version of Notes asks for a Mosaikit we are not
      await p.route('**/api/admin/catalog', (r) =>
        r.fulfill({
          json: [
            {
              id: 'com.mosaikit.notes', // not a check id
              name: 'Notes',
              description: 'Personal and shared notes',
              icon: 'notebook-pen',
              latest: '99.0.0',
              installed: '0.1.0',
              update_available: true,
              incompatible: { reason: 'mosaikit', wanted: '>=99, <100', have: '1.0.0' },
              kind: 'app',
              notes: [],
            },
          ],
        }),
      )
      await H.go(p, '#/admin/plugins')
      await p.getByRole('tab', { name: /^Updates/ }).click()
      await p.waitForTimeout(1000)
      const reason = p.getByTestId('plugin-incompatible').first()
      c.ok(await H.vis(reason), 'the reason is shown beside the version that cannot be installed')
      const text = (await reason.innerText().catch(() => '')) || ''
      c.ok(text.includes('>=99, <100') && text.includes('1.0.0'), `the reason names the range and the version of Mosaikit (${text})`)
      c.ok(await p.getByRole('button', { name: /Update to 99\.0\.0/ }).first().isDisabled().catch(() => false), 'the update button is off')
      await L.shot(p, 'API-02')
      await p.unroute('**/api/admin/catalog')
      return c.result()
    },
  },
  {
    id: 'API-03',
    async run(ctx: any) {
      const c = H.checker()
      await L.ensureOn('com.mosaikit.contacts')
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma/p/com.mosaikit.contacts')
      const f = await L.pluginFrame(p, 'contacts')
      const ok = await ask(f, 'hello', { api: 1 })
      c.ok(ok.ok?.api === 1, 'the host answers hello with the API it speaks (1)')
      const old = await ask(f, 'hello')
      c.ok(old.ok?.api === 1, 'a plugin that announces nothing (before the handshake) is served')
      const newer = await ask(f, 'hello', { api: 99 })
      c.ok(newer.err !== undefined && newer.code === 'incompatible_api', 'a plugin built for API 99 is refused with the code incompatible_api')
      c.ok((await p.locator('[data-sonner-toast]').allInnerTexts()).join(' ').includes('plugin API'), 'the person is told to update Mosaikit')
      await L.shot(p, 'API-03')
      return c.result()
    },
  },
  {
    id: 'API-04',
    async run(ctx: any) {
      const c = H.checker()
      await L.ensureOn('com.mosaikit.contacts')
      const p = await L.as(ctx, 'e.ricci')
      await H.go(p, '#/t/comune-roma/p/com.mosaikit.contacts')
      const f = await L.pluginFrame(p, 'contacts')
      const bad = await ask(f, 'crud.create', { resource: 'contacts', values: { name: 'Luigi', email: 'not-valid' } })
      c.ok(bad.err !== undefined, 'a contact with an invalid email is refused')
      c.ok(bad.code === 'email_invalid', `the code the logic chose reaches the plugin (${bad.code})`)
      c.ok(String(bad.message ?? '').includes('invalid email'), 'the message of the logic stays')
      // an error of the platform keeps its own code
      const gone = await ask(f, 'crud.get', { resource: 'contacts', id: '00000000-0000-4000-8000-000000000000' })
      c.ok(gone.err !== undefined && gone.code === 'not_found', `a missing item keeps the code of the platform (${gone.code})`)
      return c.result()
    },
  },
  {
    id: 'API-05',
    async run() {
      return {
        status: 'NOT VERIFIABLE',
        note: 'needs signed packages outside the range and a plugin folder in development; covered by range_and_api_of_the_plugin_are_checked (kernel test) and the manifest tests of mosaikit-mskp',
      }
    },
  },
]

export default checks
