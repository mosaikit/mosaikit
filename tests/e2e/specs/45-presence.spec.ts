import { expect, test } from '@playwright/test'
import { BASE, PASSWORD, login, logout, nav } from './support'

// Platform-wide presence (docs/manual-tests.md, PRS-01 and PRS-02): a member who has the shell open is online for the others
// although they never opened Chat, and is offline as soon as they sign out. The manager listens to the presence stream the
// way a plugin page does through the host (one more tab of the same person).

test.describe.serial('Platform presence', () => {
  test('a person on the Notes page is online for the others; signing out makes them offline', async ({ browser }) => {
    const mctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const manager = await mctx.newPage()
    await login(manager, 'City of Alfa', 'manager', PASSWORD)
    // the manager's own shell is already a tab of the manager: this probe is a second one that records what arrives
    await manager.evaluate(
      ([base]) => {
        const w = window as unknown as { __presence: { type: string; data: any }[] }
        w.__presence = []
        const es = new EventSource(`${base}/api/t/alfa/presence/stream?tab=probe-e2e`)
        for (const type of ['presence', 'join', 'state', 'leave']) {
          es.addEventListener(type, (e) => w.__presence.push({ type, data: JSON.parse((e as MessageEvent).data) }))
        }
      },
      [BASE] as const,
    )
    await expect.poll(() => manager.evaluate(() => (window as any).__presence.length)).toBeGreaterThan(0)

    const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const anna = await actx.newPage()
    await login(anna, 'City of Alfa', 'anna', PASSWORD)
    await nav(anna, 'Notes').click()
    // anna never opened Chat: the manager still sees her join, available
    await expect
      .poll(() =>
        manager.evaluate(() =>
          (window as any).__presence.some(
            (e: any) =>
              (e.type === 'join' || e.type === 'presence') &&
              [e.data.from, ...(e.data.people ?? [])].some((p: any) => p?.name?.toLowerCase().includes('anna') && p.state?.status === 'available'),
          ),
        ),
      )
      .toBe(true)
    await logout(anna)
    await expect
      .poll(() => manager.evaluate(() => (window as any).__presence.some((e: any) => e.type === 'leave' && e.data.from?.name?.toLowerCase().includes('anna'))))
      .toBe(true)
    await actx.close()
    await mctx.close()
  })
})
