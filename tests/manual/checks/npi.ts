// Notes as post-its: colour, quick menu, resize, tags, list view, dark mode
import * as H from '../h.ts'
import * as L from '../lib.ts'

async function open(p: any) {
  await L.ensureOn('com.mosaikit.notes')
  await H.go(p, '#/t/comune-roma')
  await p.reload()
  await p.waitForTimeout(1500)
  await H.nav(p, 'Notes')
  return L.pluginFrame(p, 'notes')
}

const postit = (f: any, title: string) => f.locator('.msk-item.pi').filter({ hasText: title })
const size = (f: any, title: string) => postit(f, title).evaluate((e: HTMLElement) => ({ w: e.offsetWidth, h: e.offsetHeight }))

const checks: L.Check[] = [
  {
    id: 'NPI-01',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      const f = await open(p)
      await f.getByRole('button', { name: /^＋ New/ }).first().click()
      await f.locator('[data-key="title"]').fill('NPI note')
      await f.locator('[data-key="body"]').fill('First line\nSecond line')
      await f.getByRole('radio', { name: 'green' }).click()
      await f.getByRole('textbox', { name: 'New tag' }).fill('npi')
      await f.getByRole('button', { name: 'Add', exact: true }).click()
      await f.getByRole('button', { name: 'Save' }).click()
      await p.waitForTimeout(1200)
      c.ok(/pc-green/.test((await postit(f, 'NPI note').getAttribute('class')) ?? ''), 'the post-it has the colour chosen in the editor')
      c.ok(await H.vis(postit(f, 'NPI note').locator('.pi-tag', { hasText: 'npi' })), 'the tag chip is on the post-it')
      await f.locator('.msk-detail').press('Escape')
      await postit(f, 'NPI note').locator('.pi-pal').click()
      await postit(f, 'NPI note').getByRole('button', { name: 'violet' }).click()
      await p.waitForTimeout(1200)
      await p.reload()
      const g = await L.pluginFrame(p, 'notes')
      await p.waitForTimeout(1500)
      c.ok(/pc-violet/.test((await postit(g, 'NPI note').getAttribute('class')) ?? ''), 'the colour of the quick menu is kept after a reload')
      await L.shot(p, 'NPI-01')
      return c.result()
    },
  },
  {
    id: 'NPI-02',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      const f = await open(p)
      await postit(f, 'NPI note').focus()
      for (let i = 0; i < 3; i++) await p.keyboard.press('Alt+ArrowRight')
      await p.waitForTimeout(1200)
      const keyed = await size(f, 'NPI note')
      c.ok(keyed.w === 300, `Alt+arrows widen the post-it (${keyed.w})`)
      const grip = (await postit(f, 'NPI note').locator('.pi-grip').boundingBox())!
      await p.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
      await p.mouse.down()
      await p.mouse.move(grip.x + 2000, grip.y + 2000, { steps: 4 })
      await p.mouse.up()
      await p.waitForTimeout(1200)
      const big = await size(f, 'NPI note')
      c.ok(big.w === 480 && big.h === 480, `dragging far stops at the limit (${big.w} x ${big.h})`)
      await p.reload()
      const g = await L.pluginFrame(p, 'notes')
      await p.waitForTimeout(1500)
      const kept = await size(g, 'NPI note')
      c.ok(kept.w === 480 && kept.h === 480, 'the size is kept after a reload')
      c.ok(await g.locator('html').evaluate((h: HTMLElement) => h.scrollWidth <= h.clientWidth), 'nothing scrolls sideways')
      await L.shot(p, 'NPI-02')
      return c.result()
    },
  },
  {
    id: 'NPI-03',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      const f = await open(p)
      await f.getByRole('button', { name: 'Tags', exact: true }).click()
      const d = f.getByRole('dialog', { name: 'Tags' })
      await d.getByRole('textbox', { name: 'Name of the tag' }).fill('npi-two')
      await d.getByLabel('Colour', { exact: true }).selectOption('teal')
      await d.getByRole('button', { name: 'Add', exact: true }).click()
      await p.waitForTimeout(800)
      await d.getByLabel('Colour of the tag npi-two').selectOption('pink')
      await p.waitForTimeout(800)
      await d.getByRole('textbox', { name: 'Name of the tag npi-two' }).fill('npi-2')
      await d.getByRole('textbox', { name: 'Name of the tag npi-2' }).press('Enter')
      await p.waitForTimeout(800)
      c.ok((await d.getByRole('textbox', { name: 'Name of the tag npi-2' }).count()) === 1, 'the tag was renamed')
      await d.getByRole('button', { name: 'Delete the tag npi', exact: true }).click()
      await p.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click()
      await p.waitForTimeout(1000)
      c.ok((await d.getByRole('textbox', { name: 'Name of the tag npi', exact: true }).count()) === 0, 'the tag was deleted')
      await d.getByRole('button', { name: 'Close' }).click()
      await p.waitForTimeout(1200)
      c.ok((await postit(f, 'NPI note').locator('.pi-tag', { hasText: /^npi$/ }).count()) === 0, 'the tag left the notes')
      await L.shot(p, 'NPI-03')
      return c.result()
    },
  },
  {
    id: 'NPI-04',
    async run(ctx: any) {
      const c = H.checker()
      const p = await L.as(ctx, 's.greco')
      await p.setViewportSize({ width: 390, height: 800 })
      for (const mode of ['light', 'dark']) {
        await p.evaluate((m: string) => localStorage.setItem('msk_mode', m), mode)
        const f = await open(p)
        c.ok(await f.locator('html').evaluate((h: HTMLElement) => h.scrollWidth <= h.clientWidth), `${mode}: nothing scrolls sideways at 390 px`)
        await f.getByRole('button', { name: 'List' }).click()
        c.ok((await f.locator('.msk-item').count()) > 0, `${mode}: the list view shows the notes`)
        await f.getByRole('button', { name: 'Post-its' }).click()
        await L.shot(p, `NPI-04-${mode}`)
      }
      await p.evaluate(() => localStorage.removeItem('msk_mode'))
      return c.result('the contrast of every colour in both modes is also a unit test (palette.test.ts)')
    },
  },
]

export default checks
