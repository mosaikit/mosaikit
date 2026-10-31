// The checks of docs/manual-tests.md, run automatically: one Playwright test per id, in the order of the
// document, titled with the id and the text of the check. A check returns PASS, FAIL (with what is
// missing or wrong) or NOT VERIFIABLE (the test is skipped with the reason). Known defects are marked
// as expected failures with their finding in docs/reports/qa-walkthrough.md: when a fix lands the test
// passes, Playwright reports "expected to fail" and the mark has to go.
//
// Run: cargo xtask manual-tests            (all)
//      cargo xtask manual-tests -- --grep P3-12

import { expect, test } from '@playwright/test'
import { automatedIds, consistency, documentChecks } from './catalog.mjs'
import * as L from './lib.ts'
import p0 from './checks/p0.ts'
import p0b from './checks/p0b.ts'
import p1 from './checks/p1.ts'
import p2 from './checks/p2.ts'
import p3 from './checks/p3.ts'
import p4 from './checks/p4.ts'
import p5 from './checks/p5.ts'
import p6 from './checks/p6.ts'
import p7 from './checks/p7.ts'
import p8 from './checks/p8.ts'
import p9 from './checks/p9.ts'
import fu from './checks/fu.ts'
import fub from './checks/fub.ts'
import fc from './checks/fc.ts'
import p10 from './checks/p10.ts'
import sec from './checks/sec.ts'
import ux from './checks/ux.ts'
import r2 from './checks/r2.ts'
import pui from './checks/pui.ts'
import npi from './checks/npi.ts'
import tbl from './checks/tbl.ts'
import seed from './checks/seed.ts'
import pending from './checks/pending.ts'
import sc from './checks/sc.ts'
import api from './checks/api.ts'

const ALL = new Map<string, L.Check>([...p0, ...p0b, ...p1, ...p2, ...p3, ...p4, ...p5, ...p6, ...p7, ...p8, ...p9, ...fu, ...fub, ...fc, ...p10, ...sec, ...ux, ...r2, ...pui, ...npi, ...tbl, ...sc, ...seed, ...pending, ...api].map((c) => [c.id, c]))

/** Defects already reported (docs/reports/qa-walkthrough.md) and owned by a piece of work: expected to fail. */
const KNOWN: Record<string, string> = {
  'P3-12': 'F1: a person suspended in the home tenant still signs in (owner: QA follow-ups)',
  'P0-19': 'F2: contrast of the selected section in dark mode (owner: QA follow-ups)',
  'P3-28': 'F2: contrast of the selected section in dark mode (owner: QA follow-ups)',
  'P6-18': 'F2: contrast of the selected section in dark mode (owner: QA follow-ups)',
  'P7-27': 'F2: contrast of the selected section in dark mode (owner: QA follow-ups)',
  'P9-07': 'F3: stale search results in a session (owner: QA follow-ups)',
  'P9-08': 'F3: stale search results in a session (owner: QA follow-ups)',
  'P2-10': 'F4: the test email fails silently (owner: QA follow-ups)',
  'P4-20': 'F5: uninstall and reinstall of an extension (owner: QA follow-ups)',
  'P7-20': 'F6: Monitoring › Status (owner: QA follow-ups)',
  'P7-14': 'F7: maintenance notice lost for open sessions (owner: QA follow-ups)',
  'P10-24': 'F2: contrast of the selected section in dark mode (owner: QA follow-ups)',
}

let ctx: L.Ctx | null = null
async function context(): Promise<L.Ctx> {
  if (!ctx) ctx = { b: await L.browser(), pages: {}, data: L.state().data ?? {} }
  return ctx
}

test.describe.configure({ mode: 'default' })

test.afterEach(async () => {
  // what a check leaves for a later one survives a restart of the worker (after a failure)
  if (ctx) L.save({ data: ctx.data })
})

test.afterAll(async () => {
  if (ctx) await ctx.b.close()
  ctx = null
})

test('every manual check has its automated test', () => {
  const r = consistency()
  expect(r.missing, 'ids of docs/manual-tests.md without a check in tests/manual/checks').toEqual([])
  expect(r.extra, 'checks without an id in docs/manual-tests.md').toEqual([])
  expect(r.duplicates, 'ids used twice in docs/manual-tests.md').toEqual([])
})

const files = automatedIds()
for (const section of documentChecks()) {
  test.describe(section.title, () => {
    for (const { id, text } of section.checks) {
      const title = `${id} ${text.length > 90 ? text.slice(0, 87) + '…' : text}`
      test(title, async () => {
        test.setTimeout(300_000)
        const check = ALL.get(id)
        test.skip(!check, `no automated check for ${id} (${files.get(id) ?? 'add it to tests/manual/checks'})`)
        const r = (await check!.run(await context())) ?? { status: 'PASS' }
        if (r.note) test.info().annotations.push({ type: 'note', description: r.note })
        test.info().annotations.push({ type: 'screenshot', description: `${L.SHOTS}/${id}.png` })
        if (r.status === 'NOT VERIFIABLE') test.skip(true, `not verifiable: ${r.note ?? ''}`)
        // a known defect: expected to fail until its fix lands (then this mark goes)
        if (KNOWN[id]) test.fail(true, KNOWN[id])
        expect(r.status, r.note).toBe('PASS')
      })
    }
  })
}
