import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Frame, type Page } from '@playwright/test'
import { PASSWORD, adminLogin, login } from './support'

// The layout contract (docs/refactoring-ui.md, "Layout contract"): the UI rules that keep being found broken by hand,
// checked on EVERY route of the app (derived from the navigation itself, so new pages are covered at once) for the
// Administrator, a Tenant Manager and a User, and on the pages of every installed app (the iframes).
//
// One walk (the first test) measures every route at 1440x900, 1280x600 and 390x844 (light theme, and dark on a few);
// then one test per rule and family of routes judges the measures, so a failure names the rule, the route and the
// viewport. Rules and routes whose work is still in flight are listed in PENDING and run as `test.fixme`: delete the
// row when the work has merged. Contrast and ARIA stay with `accessible()` of the other specs (R-10: not repeated).

type Vp = 'desk' | 'short' | 'phone' | 'dark'
const VP: Record<Vp, { width: number; height: number }> = {
  desk: { width: 1440, height: 900 },
  short: { width: 1280, height: 600 },
  phone: { width: 390, height: 844 },
  dark: { width: 1440, height: 900 },
}

type Role = 'admin' | 'manager' | 'user'
const SLUG = 'lcw'
const TENANT = 'Layout Walk'

/** Rules by id. */
const RULES: Record<string, string> = {
  'R-1': 'headers and filter rows are fully visible, not overlapped, and pinned (they do not scroll with the content)',
  'R-2': 'no empty band between the top bar and the page header',
  'R-3': 'list pages: the page does not scroll, the list scrolls inside with a sticky header row and fills the height, more rows load on scroll',
  'R-4': 'a side navigation does not scroll with the page and scrolls by itself when it overflows',
  'R-5': 'the header shows the page and the open subsection (Page › Subsection)',
  'R-6': 'filter and primary action on the first header row, right-aligned, the filter just left of the button',
  'R-7': 'the headers of the apps use the same type and spacing as the headers of the host',
  'R-8': 'the scrollbar of the main sidebar is hidden unless hovered or focused',
  'R-9': 'no horizontal overflow on a phone',
  'R-11': 'every table: the header row is fixed, only the rows scroll with the scrollbar under the header row, a filter and sortable column titles are offered (or the table is on the exemption list with a reason), and more rows load progressively',
  'R-12': 'no row is painted over or above the header row of a table, wherever the list is scrolled',
}

/** Tables that are deliberately NOT drawn as a scrolling list (route pattern -> why): small matrices that are edited in place. */
const TABLE_EXEMPT: { route: RegExp; why: string }[] = [
  { route: /\/permissions|\/profiles/, why: 'permission matrix: a fixed set of rows with a checkbox per permission, edited in place' },
  { route: /\/system\/quotas/, why: 'the capacity of the platform: five fixed rows of inputs, edited in place' },
  { route: /\/account\/notifications|\/notifications\/settings/, why: 'notification matrix: a fixed set of kinds with two switches' },
]

/** Families of routes: the unit of a `test.fixme`. */
const FAMILIES = ['host-admin', 'host-manager', 'host-user', 'log', 'app-files', 'app-maps', 'app-static-site', 'app-contacts', 'app-tasks', 'app-notes'] as const
type Family = (typeof FAMILIES)[number]

/** Work in flight: rule + family -> what is pending. Delete the row (and the test runs for real) when it has merged; the `why` text starts with «work in flight: ». */
const PENDING: { rule: string; family: Family; why: string }[] = [
]

interface Rect {
  x: number
  y: number
  r: number
  b: number
  w: number
  h: number
}
interface Probe {
  vw: number
  vh: number
  docH: number
  docClient: number
  hscroll: number
  band: Rect | null
  header: Rect | null
  headerText: string
  h1: (Rect & { fs: string; fw: string; ff: string }) | null
  headerBorder: string
  overlapped: boolean
  clipped: boolean
  pills: Rect | null
  ctrls: { tag: string; type: string; text: string; primary: boolean; r: Rect }[]
  sections: { r: Rect; selected: string; overflowY: string; scrollH: number; clientH: number } | null
  tabs: boolean
  table: { rows: number; scroller: Rect | null; stickyHead: boolean; docScroll: boolean; grid: boolean; headB: number | null; bodyT: number | null; sortable: number; search: boolean; overlap: string[]; footInside: boolean } | null
  // after scrolling every scrollable element of the page to its end
  scrolled: { header: number | null; pills: number | null; sections: number | null; thead: number | null; pillsAfter: number | null; theadAfter: number | null } | null
  more: { present: boolean; loaded: boolean } | null
  filterUi: boolean
  sidebarScroll: { overflows: boolean; idle: string; w: number } | null
  iframe: Rect | null
}
interface Rec {
  role: Role
  route: string
  family: Family
  vp: Vp
  host: Probe
  frame: Probe | null
  /** the sub-page of an app is expected to show «App › Subsection» */
  expectSection: string | null
}
const recs: Rec[] = []
const sidebar: { role: string; family: Family; route: string; idle: any; hover: any }[] = []
// the measures live on disk: a failed rule test restarts the worker, and the next rules must still find them
const FILE = path.join(import.meta.dirname, '..', 'test-results', 'layout-contract.json')
let loaded: { recs: Rec[]; sidebar: typeof sidebar } | null = null
const load = () => (loaded ??= fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { recs: [], sidebar: [] })

/** Runs in a document (the page or the iframe of an app): everything the rules need to judge it. */
async function probe(doc: Page | Frame, o: { scroll: boolean; more: boolean }): Promise<Probe> {
  return doc.evaluate(async (o) => {
    const q = (s: string, r: any = document) => r.querySelector(s)
    const R = (e: any) => {
      if (!e) return null
      const b = e.getBoundingClientRect()
      return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }
    }
    const vis = (e: any) => {
      const b = e.getBoundingClientRect()
      const s = getComputedStyle(e)
      return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    }
    const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
    const header: any = q('#main [data-tour="page-header"]') ?? q('.msk-headwrap')
    const h1: any = header && q('h1', header)
    const doc: any = document.scrollingElement
    const sections: any = q('nav[aria-label="Sections"]')
    const pills: any = q('.msk-pills')
    const tableEl: any = [...document.querySelectorAll('table')].find((e: any) => vis(e) && !e.closest('details'))
    const bodyEl: any = tableEl && q('tbody', tableEl)
    // the pattern of the tables: the rows (tbody) scroll by themselves under a fixed header row
    const gridScroll = !!bodyEl && /(auto|scroll)/.test(getComputedStyle(bodyEl).overflowY) && getComputedStyle(bodyEl).display === 'grid'
    const scroller: any = gridScroll ? bodyEl : tableEl && tableEl.closest('[data-listscroll], .msk-body')
    const thead: any = tableEl && q('thead', tableEl)
    const th: any = thead && q('th', thead)
    const rows = tableEl ? [...tableEl.querySelectorAll('tbody tr')].filter((r: any) => !r.querySelector('td.empty')).length : 0
    const hb = header ? header.getBoundingClientRect() : null
    let overlapped = false
    let clipped = false
    if (header && hb && hb.width > 0) {
      for (const [x, y] of [[hb.left + 12, hb.top + hb.height / 2], [hb.right - 12, hb.top + hb.height / 2]]) {
        const el = document.elementFromPoint(Math.min(Math.max(x, 0), innerWidth - 1), Math.min(Math.max(y, 0), innerHeight - 1))
        if (!el || !header.contains(el)) overlapped = true
      }
      for (let p = header.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p)
        if (s.overflowY !== 'visible' && s.overflowY !== 'clip') {
          const pb = p.getBoundingClientRect()
          if (hb.top < pb.top - 1 || hb.bottom > pb.bottom + 1) clipped = true
        }
      }
      if (hb.top < -1 || hb.bottom > innerHeight + 1 || hb.height <= 0) clipped = true
    }
    const ctrls = header
      ? ([...header.querySelectorAll('button, input, select, [role="combobox"]')] as any[]).filter(vis).map((e) => ({
          tag: e.tagName.toLowerCase(),
          type: e.type ?? '',
          text: (e.innerText || e.getAttribute('aria-label') || e.placeholder || '').trim(),
          primary: e.matches('[data-variant="default"]'),
          r: R(e),
        }))
      : []
    const out: any = {
      vw: innerWidth,
      vh: innerHeight,
      docH: doc.scrollHeight,
      docClient: doc.clientHeight,
      hscroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      band: R(q('header.msk-band')),
      header: R(header),
      headerText: header ? (header.innerText as string).replace(/\s+/g, ' ').trim() : '',
      h1: h1 ? { ...R(h1), fs: getComputedStyle(h1).fontSize, fw: getComputedStyle(h1).fontWeight, ff: getComputedStyle(h1).fontFamily } : null,
      headerBorder: header ? getComputedStyle(q('.msk-pagehead', header) ?? header).borderBottomWidth : '',
      overlapped,
      clipped,
      pills: R(pills),
      ctrls,
      sections: sections
        ? {
            r: R(sections),
            selected: ((q('a[aria-current="page"] span.truncate', sections) ?? q('a[aria-current="page"]', sections))?.textContent ?? '').trim(),
            overflowY: getComputedStyle(sections).overflowY,
            scrollH: sections.scrollHeight,
            clientH: sections.clientHeight,
          }
        : null,
      tabs: !!q('nav[aria-label="Tabs"]'),
      table: tableEl
        ? {
            rows,
            scroller: R(scroller),
            stickyHead: !!th && (getComputedStyle(th).position === 'sticky' || getComputedStyle(thead).position === 'sticky'),
            docScroll: doc.scrollHeight > doc.clientHeight + 1,
            grid: gridScroll,
            headB: thead ? thead.getBoundingClientRect().bottom : null,
            bodyT: bodyEl ? bodyEl.getBoundingClientRect().top : null,
            sortable: tableEl.querySelectorAll('thead th[aria-sort]').length,
            search: !!q('#main input[type="search"], .msk-headwrap input[type="search"], .msk-filter'),
            overlap: [] as string[],
            footInside: !bodyEl || !q('[data-foot], .msk-morebar', tableEl) || !!bodyEl.querySelector('[data-foot], .msk-morebar'),
          }
        : null,
      scrolled: null,
      more: null,
      filterUi: !!q('[aria-label="Show or hide the filters"]') || !!q('#main input[type="search"], #main [role="searchbox"]'),
      sidebarScroll: null,
      iframe: R(q('iframe.plugin-frame')),
    }
    if (o.more && scroller) {
      const btn: any = [...scroller.querySelectorAll('button')].find((b: any) => /^(Load more|Carica altri)/.test(b.textContent.trim()) && vis(b) && !b.disabled && !b.hidden)
      if (btn) {
        const n0 = scroller.querySelectorAll('tbody tr').length
        scroller.scrollTop = scroller.scrollHeight
        let loaded = false
        for (let i = 0; i < 60 && !loaded; i++) {
          await new Promise((r) => setTimeout(r, 100))
          loaded = scroller.querySelectorAll('tbody tr').length > n0
        }
        scroller.scrollTop = 0
        out.more = { present: true, loaded }
      }
    }
    // R-12: scrolled to the middle and to the end, what is painted just above the header row, on it and just under it
    if (o.scroll && tableEl && thead && bodyEl && scroller) {
      const bad: string[] = []
      const inBody = (e: any) => !!e && !!e.closest && !!e.closest('tbody')
      const sc: any = scroller
      for (const f of [0.5, 1]) {
        sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * f
        await frame()
        const hb = thead.getBoundingClientRect()
        const x = hb.left + Math.min(24, hb.width / 2)
        const above = document.elementFromPoint(x, Math.max(0, hb.top - 2))
        const on = document.elementFromPoint(x, hb.top + hb.height / 2)
        const under = hb.bottom + 1 < innerHeight ? document.elementFromPoint(x, hb.bottom + 1) : null
        if (inBody(above)) bad.push(`a row is painted above the header row (scrolled to ${f * 100}%)`)
        if (inBody(on)) bad.push(`a row is painted over the header row (scrolled to ${f * 100}%)`)
        if (under && sc.scrollHeight > sc.clientHeight + 1 && !inBody(under) && !under.closest('thead')) bad.push(`nothing of the rows is painted just under the header row (scrolled to ${f * 100}%)`)
      }
      sc.scrollTop = 0
      await frame()
      out.table!.overlap = bad
    }
    const scrollables = () => [doc, ...([...document.querySelectorAll('*')] as any[]).filter((e) => e !== doc && e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))]
    if (o.scroll) {
      const sy = (e: any) => (e ? e.getBoundingClientRect().top : null)
      // the list may be drawn again while more rows load: look the header row up each time
      const theadY = () => {
        const th: any = scroller && q('thead', scroller)
        return th ? th.getBoundingClientRect().top - scroller.getBoundingClientRect().top : null
      }
      const before = { header: sy(header), pills: sy(pills), sections: sy(sections), thead: theadY() }
      const els = scrollables()
      for (const e of els) e.scrollTop = e.scrollHeight
      await frame()
      const after = { header: sy(header), pills: sy(pills), sections: sy(sections), thead: theadY() }
      for (const e of els) e.scrollTop = 0
      await frame()
      const d = (a: number | null, b: number | null) => (a === null || b === null ? null : b - a)
      out.scrolled = { header: d(before.header, after.header), pills: d(before.pills, after.pills), sections: d(before.sections, after.sections), thead: d(before.thead, after.thead), pillsAfter: after.pills === null || !header ? null : after.pills - header.getBoundingClientRect().bottom, theadAfter: after.thead }
    }
    return out
  }, o)
}

/** The main sidebar (host document only): does it overflow, and is its scrollbar transparent when idle. */
async function sidebarProbe(page: Page) {
  return page.evaluate(() => {
    // the thumb is drawn with the webkit parts (scrollbar-color would switch them off)
    const c: any = document.querySelector('[data-sidebar="content"]')
    return c ? { overflows: c.scrollHeight > c.clientHeight + 1, idle: getComputedStyle(c, '::-webkit-scrollbar-thumb').backgroundColor, w: c.getBoundingClientRect().width } : null
  })
}

const familyOf = (route: string): Family | null => {
  if (/\/log$/.test(route)) return 'log'
  const app = route.match(/\/p\/com\.mosaikit\.([a-z-]+)/)
  if (app) return `app-${app[1]}` as Family
  return null
}

/** Waits until the page of the route is drawn (header shown, no spinner), in the host and, for an app, in its iframe. */
async function settled(page: Page, expectSection: string | null, first: boolean): Promise<Frame | null> {
  await page.locator('#main h1, #main iframe.plugin-frame').first().waitFor()
  const handle = await page.locator('#main iframe.plugin-frame').elementHandle({ timeout: 500 }).catch(() => null)
  let frame: Frame | null = null
  if (handle) {
    frame = await handle.contentFrame()
    if (frame) {
      // an app without the shared header is a finding of R-1/R-7, not a reason to stall
      await frame.locator('h1, .msk-headwrap').first().waitFor({ timeout: first ? 5000 : 500 }).catch(() => {})
      if (expectSection) await frame.locator('.msk-psection, .msk-pline').first().waitFor().catch(() => {})
      // rows arrived (or "no item")
      await frame.waitForFunction(() => !document.querySelector('table') || document.querySelectorAll('tbody tr').length > 0, undefined, { timeout: 3000 }).catch(() => {})
    }
  } else {
    await page.waitForFunction(() => !document.querySelector('#main .animate-spin') && !!document.querySelector('#main h1'), undefined, { timeout: 3000 }).catch(() => {})
    await page.waitForFunction(() => !document.querySelector('#main table') || document.querySelectorAll('#main tbody tr').length > 0, undefined, { timeout: 2000 }).catch(() => {})
  }
  return frame
}

async function measure(page: Page, role: Role, route: string, family: Family, vps: Vp[], expectSection: string | null, more: boolean) {
  for (const vp of vps) {
    await page.setViewportSize(VP[vp])
    await page.emulateMedia({ colorScheme: vp === 'dark' ? 'dark' : 'light' })
    const frame = await settled(page, expectSection, vp === vps[0])
    if (process.env.LC_LOG) console.log('  ', route, vp, 'settled', !!frame)
    const doMore = more && vp === 'desk'
    const host = await probe(page, { scroll: !frame, more: doMore && !frame })
    host.sidebarScroll = null
    const fp = frame ? await probe(frame, { scroll: true, more: doMore }) : null
    if (process.env.LC_LOG) console.log('  ', route, vp, 'probed')
    recs.push({ role, route, family, vp, host, frame: fp, expectSection })
  }
}

const API = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([method, path, body]) => {
      const s = await (await fetch('api/session')).json()
      const r = await fetch(path as string, { method: method as string, headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrf }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: r.status, json: await r.json().catch(() => null) }
    },
    [method, path, body] as const,
  )

/** Visits every route reachable from the navigation (sidebar and section lists) of the person that is signed in. */
async function walk(page: Page, role: Role, home: string, account: string, dark: number) {
  const seen = new Set<string>()
  const queue: string[] = []
  const nav = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-sidebar="sidebar"] a[href^="#/"], #main nav a[href^="#/"]')]
        .map((a) => a.getAttribute('href') as string)
        .filter((h) => !/[0-9a-f]{8}-[0-9a-f]{4}|\/person\//.test(h)),
    )
  const push = (hs: string[]) => {
    for (const h of hs) if (!seen.has(h) && !queue.includes(h)) queue.push(h)
  }
  await page.setViewportSize(VP.desk)
  await page.goto('./' + home)
  await page.locator('#main h1, #main iframe.plugin-frame').first().waitFor()
  push(await nav())
  push([account])
  // the sub-pages of the apps come from the manifests (the sidebar shows them only in some layouts)
  const slug = home.match(/#\/t\/([^/]+)/)?.[1]
  if (slug) {
    const ctx = (await API(page, 'GET', `api/t/${slug}/context`)).json
    for (const p of ctx?.plugins ?? []) for (const n of p.nav ?? []) if (!(n.parent == null && (p.nav ?? []).some((c: any) => c.parent === n.id)) || n.place) push([`#/t/${slug}/p/${p.id}/${n.place ?? n.id}`])
  }
  let n = 0
  while (queue.length) {
    const href = queue.shift()!
    const t0 = Date.now()
    seen.add(href)
    await page.evaluate((h) => (location.hash = h), href)
    await page.waitForFunction((h) => location.hash === h, href)
    const family: Family = familyOf(href) ?? (`host-${role}` as Family)
    const sub = href.match(/\/p\/[^/]+\/([^/]+)/)?.[1]
    const expectSection = family.startsWith('app-') && sub ? sub : null
    const vps: Vp[] = ['desk', 'short', 'phone']
    if (n % dark === 0 || /\/p\/[^/]+$/.test(href)) vps.push('dark')
    await measure(page, role, href, family, vps, expectSection, true)
    push(await nav())
    n++
    if (process.env.LC_LOG) console.log(role, href, Math.round((Date.now() - t0) / 1000) + 's')
  }
  expect(n, `routes found for ${role}`).toBeGreaterThan(5)
  // R-8: the main sidebar on a page of each family, at a height that makes it overflow, idle then hovered
  // (a family already measured for another role is not measured again)
  const routes = new Map<Family, string>()
  for (const r of recs) if (r.role === role && !routes.has(r.family)) routes.set(r.family, r.route)
  for (const [family, route] of routes) {
    if (sidebar.some((x) => x.family === family)) continue
    await page.setViewportSize({ width: 1280, height: 300 })
    // a new load: the sidebar opens as at the start of a session (a phone before left it closed)
    await page.goto('./' + route)
    await page.locator('[data-sidebar="content"]').waitFor()
    // the pointer of the previous measure may still rest on the sidebar
    await page.mouse.move(900, 150)
    await page.waitForTimeout(300)
    const idle = await sidebarProbe(page)
    await page.locator('[data-sidebar="content"]').hover()
    const hover = await sidebarProbe(page)
    sidebar.push({ role, family, route, idle, hover })
  }
}

test.describe('15-layout-contract', () => {
  test('walk: every route of the Administrator, a Tenant Manager and a User, at three sizes', async ({ page }) => {
    test.setTimeout(600_000)
    if (process.env.LC_REPLAY) return
    // data: enough organizations and people for a list to scroll and load more, a tenant of its own
    await adminLogin(page)
    const tenant = (n: number) => {
      const slug = n === 0 ? SLUG : `lcy-${String(n).padStart(2, '0')}`
      return API(page, 'POST', 'api/admin/tenants', { slug, name: n === 0 ? TENANT : `Lcy ${String(n).padStart(2, '0')}`, manager_username: 'mgr', manager_email: `mgr@${slug}.example.org`, manager_password: PASSWORD })
    }
    await tenant(0)
    await page.context().clearCookies()
    await login(page, TENANT, 'mgr', PASSWORD)
    expect((await API(page, 'POST', `api/t/${SLUG}/manage/members`, { username: 'lcu', display_name: 'Lc User', email: 'lcu@lc.example.org', password: PASSWORD, role: 'user' })).status).toBeLessThan(410)
    await walk(page, 'manager', `#/t/${SLUG}`, `#/t/${SLUG}/account`, 6)

    await page.context().clearCookies()
    await login(page, TENANT, 'lcu', PASSWORD)
    await walk(page, 'user', `#/t/${SLUG}`, `#/t/${SLUG}/account`, 6)

    // the Administrator last: 59 more organizations (and as many people), so that the lists scroll and load more
    await page.context().clearCookies()
    await adminLogin(page)
    for (let i = 0; i < 6; i++) await Promise.all(Array.from({ length: 10 }, (_, k) => i * 10 + k + 1).filter((n) => n < 60).map(tenant))
    await walk(page, 'admin', '#/admin', '#/admin/account', 5)

    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify({ recs, sidebar }))
    expect(recs.length).toBeGreaterThan(60)
  })

  for (const rule of Object.keys(RULES)) {
    for (const family of FAMILIES) {
      test(`${rule} ${RULES[rule]} [${family}]`, () => {
        const pending = PENDING.find((p) => p.rule === rule && p.family === family)
        test.fixme(!!pending, pending?.why ?? '')
        const { recs: all, sidebar } = load()
        const mine = all.filter((r) => r.family === family)
        if (rule === 'R-8') {
          const s = sidebar.find((x) => x.family === family)!
          expect(s, `no route of the family ${family} measured`).toBeTruthy()
          const bad: string[] = []
          if (!s.idle?.overflows) bad.push('the sidebar does not overflow at 1280x300: cannot judge')
          else {
            const clear = (c: string) => /^(transparent|rgba\(0, 0, 0, 0\))/.test(c)
            if (!clear(s.idle.idle)) bad.push(`scrollbar visible when idle (${s.idle.idle})`)
            if (clear(s.hover.idle)) bad.push(`scrollbar still hidden when hovered (${s.hover.idle})`)
          }
          expect(bad, `${rule} sidebar of the ${s.role} on ${s.route}`).toEqual([])
          return
        }
        test.skip(mine.length === 0, 'no route in this family for this run')
        const bad: string[] = []
        for (const r of mine) {
          for (const msg of judge(rule, r, all)) bad.push(`${r.role} ${r.route} @${r.vp}: ${msg}`)
        }
        expect(bad, `${rule}: ${RULES[rule]}`).toEqual([])
      })
    }
  }
})

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol

/** The judgement of a rule on a measured route: the list of violations. */
function judge(rule: string, r: Rec, all: Rec[]): string[] {
  const out: string[] = []
  const app = r.frame
  const doc = r.host
  const inner = app ?? doc
  // the header as seen from the top of the window (an app draws its header in its iframe)
  const head = inner.header && (app && doc.iframe ? { ...inner.header, y: doc.iframe.y + inner.header.y, b: doc.iframe.y + inner.header.b } : inner.header)
  const bandB = doc.band?.b ?? 50
  const desk = r.vp === 'desk' || r.vp === 'dark'
  switch (rule) {
    case 'R-1': {
      if (!inner.header || !head) out.push('no page header')
      else {
        if (inner.clipped) out.push('header clipped')
        if (inner.overlapped) out.push('header overlapped by another element')
        const s = inner.scrolled
        if (s?.header != null && Math.abs(s.header) > 1) out.push(`header moved ${s.header}px when the content scrolled (not pinned)`)
        // a row that was lower on the page (a navigation above it) is pinned when it ends right under the header
        if (s?.pills != null && Math.abs(s.pills) > 1 && !(s.pillsAfter != null && s.pillsAfter >= -1 && s.pillsAfter <= 30)) out.push(`filter row moved ${s.pills}px when the content scrolled (not pinned)`)
      }
      break
    }
    case 'R-2': {
      if (head && (head.y - bandB > 6 || head.y - bandB < -1)) out.push(`header starts ${Math.round(head.y - bandB)}px under the top bar (empty band)`)
      break
    }
    case 'R-3': {
      if (r.vp === 'phone' || r.vp === 'dark') break
      const t = inner.table
      const listFirst = t && !doc.tabs && !inner.sections && (app || t.rows > 0 || true)
      if (!listFirst) break
      if (doc.docH > doc.docClient + 1) out.push(`the page scrolls as a whole (${doc.docH} > ${doc.docClient})`)
      if (app && inner.docH > inner.docClient + 1) out.push(`the document of the app scrolls as a whole (${inner.docH} > ${inner.docClient})`)
      if (!t!.scroller) out.push('the list is not inside its own scroller (data-listscroll / .msk-body)')
      else {
        if (inner.vh - (app && doc.iframe ? 0 : 0) - t!.scroller.b > 28) out.push(`the list does not fill the height (ends ${Math.round(inner.vh - t!.scroller.b)}px above the bottom)`)
        if (!t!.stickyHead && !t!.grid) out.push('the header row of the table is not sticky')
        else if (t!.rows > 0 && inner.scrolled?.thead != null && Math.abs(inner.scrolled.thead) > 2 && !(inner.scrolled.theadAfter != null && inner.scrolled.theadAfter >= -1 && inner.scrolled.theadAfter <= 100)) out.push(`the header row moved ${inner.scrolled.thead}px when the list scrolled`)
      }
      const more = app ? r.frame!.more : doc.more
      if (more?.present && !more.loaded) out.push('scrolled to the end, more rows did not load')
      break
    }
    case 'R-4': {
      if (r.vp !== 'short' || !inner.sections) break
      const s = inner.sections
      if (inner.scrolled?.sections != null && Math.abs(inner.scrolled.sections) > 1) out.push(`the side navigation moved ${inner.scrolled.sections}px with the page`)
      if (s.r.b > inner.vh + 1) out.push(`the side navigation runs off the window (${Math.round(s.r.b)} > ${inner.vh})`)
      if (s.scrollH > s.clientH + 1 && !/(auto|scroll)/.test(s.overflowY)) out.push('the side navigation overflows and does not scroll by itself')
      break
    }
    case 'R-5': {
      if (!desk) break
      const sel = inner.sections?.selected ?? (r.expectSection ? r.expectSection : '')
      if (!inner.sections && !r.expectSection) break
      if (!inner.headerText.includes('›')) out.push(`header «${inner.headerText.slice(0, 60)}» has no «Page › Subsection»`)
      else if (inner.sections && sel && !inner.headerText.includes(sel)) out.push(`header «${inner.headerText.slice(0, 60)}» does not show the open section «${sel}»`)
      break
    }
    case 'R-6': {
      if (!desk || !inner.header) break
      const filter = inner.ctrls.find((c) => c.tag === 'input' && !['checkbox', 'radio', 'file'].includes(c.type))
      const primary = [...inner.ctrls].reverse().find((c) => c.primary || /^[＋+]|^(New|Add|Create|Invite|Upload)\b/i.test(c.text))
      if (!primary || !inner.h1 || !(filter || inner.filterUi)) break
      if (!filter) {
        out.push('the filter is not in the header row, next to the primary action')
        break
      }
      const row = inner.h1.y + inner.h1.h / 2
      const mid = (c: { r: Rect }) => c.r.y + c.r.h / 2
      if (!near(mid(filter), row, 22) || !near(mid(primary), row, 22)) out.push('filter and primary action are not on the first row of the header (the title row)')
      const last = [...inner.ctrls].sort((a, b) => b.r.r - a.r.r)[0]
      if (last.r.r < inner.header.r - 48) out.push(`the actions are not right-aligned (end ${Math.round(inner.header.r - last.r.r)}px from the right edge)`)
      if (filter.r.r > primary.r.x + 1) out.push('the filter is not left of the primary action')
      else if (inner.ctrls.some((c) => c !== filter && c !== primary && c.r.x >= filter.r.r - 1 && c.r.r <= primary.r.x + 1)) out.push('something sits between the filter and the primary action')
      else if (primary.r.x - filter.r.r > 24) out.push(`the filter is ${Math.round(primary.r.x - filter.r.r)}px from the primary action (must be adjacent)`)
      break
    }
    case 'R-7': {
      if (!app || r.vp !== 'desk') break
      if (!app.h1 || !app.header) {
        out.push('the app page does not use the shared page header (pageHead)')
        break
      }
      const ref = all.find((x) => x.role === 'admin' && x.route === '#/admin' && x.vp === 'desk')?.host
      if (!ref?.h1 || !ref.header) break
      if (app.h1.fs !== ref.h1.fs) out.push(`title size ${app.h1.fs} vs ${ref.h1.fs} of the host`)
      // with a subsection the title is the parent page: medium weight, as in the host (kit.tsx)
      const fw = app.headerText.includes('›') ? '500' : ref.h1.fw
      if (app.h1.fw !== fw) out.push(`title weight ${app.h1.fw} vs ${fw} of the host`)
      if (!near(app.header.h, ref.header.h, 8)) out.push(`header height ${Math.round(app.header.h)} vs ${Math.round(ref.header.h)} of the host`)
      const left = app.h1.x - app.header.x
      const refLeft = ref.h1.x - ref.header.x
      if (!near(left, refLeft, 3)) out.push(`title indent ${Math.round(left)} vs ${Math.round(refLeft)} of the host`)
      if (app.headerBorder !== ref.headerBorder) out.push(`header border ${app.headerBorder} vs ${ref.headerBorder} of the host`)
      break
    }
    case 'R-11': {
      if (r.vp !== 'desk') break
      const t = inner.table
      if (!t) break
      const ex = TABLE_EXEMPT.find((e) => e.route.test(r.route))
      if (ex) break
      if (!t.grid) out.push('the rows do not scroll by themselves under a fixed header row (not the grid table pattern)')
      else {
        if (t.headB != null && t.bodyT != null && t.bodyT < t.headB - 1) out.push(`the scrollbar of the rows starts above the end of the header row (${Math.round(t.bodyT)} < ${Math.round(t.headB)})`)
        if (!t.footInside) out.push('the foot of the list is outside the rows that scroll (it would always be in view and load everything at once)')
      }
      if (!t.search && !inner.filterUi) out.push('no filter box')
      if (t.sortable === 0) out.push('the column titles do not sort (no aria-sort)')
      const more = app ? r.frame!.more : doc.more
      if (more?.present && !more.loaded) out.push('scrolled to the end, more rows did not load')
      break
    }
    case 'R-12': {
      if (r.vp === 'phone') break
      const t = inner.table
      if (t?.overlap?.length) out.push(...t.overlap)
      break
    }
    case 'R-9': {
      if (r.vp !== 'phone') break
      if (doc.hscroll > 1) out.push(`the page is ${doc.hscroll}px wider than the window`)
      if (app && app.hscroll > 1) out.push(`the app is ${app.hscroll}px wider than its window`)
      break
    }
  }
  return out
}
