// The contextual top band for a resource on the full page (docs/manual-tests.md, BAND-xx). No official plugin calls
// `msk.band.set` yet, so there is no page to drive in the browser: the state, the checks of what the page sends and the
// controls are covered by vitest (ui/host/src/app/contextband.test.ts, ContextBand.test.tsx, ui/plugin-api/src/band.test.ts).
// A test page of a plugin and a Playwright spec can be added when a plugin uses the band (the comments panel, Part B).
import * as L from '../lib.ts'

const covered = (what: string, tests: string) => ({
  async run() {
    return { status: 'NOT VERIFIABLE' as const, note: `needs a test page of a plugin that calls msk.band.set (${what}); automated twin: ${tests}` }
  },
})

const checks: L.Check[] = [
  {
    id: 'BAND-01',
    ...covered('the state of the band and its controls', 'ui/host/src/app/contextband.test.ts and ContextBand.test.tsx'),
  },
  {
    id: 'BAND-02',
    ...covered('the View | Edit switch and the read only label', 'ui/host/src/app/ContextBand.test.tsx, contextband.test.ts and ui/plugin-api/src/band.test.ts'),
  },
  {
    id: 'BAND-03',
    ...covered('the avatars, the +N and the plain text of the names', 'ui/host/src/app/contextband.test.ts and ContextBand.test.tsx'),
  },
  {
    id: 'BAND-04',
    ...covered('the comments button, its badge and aria attributes', 'ui/host/src/app/ContextBand.test.tsx and contextband.test.ts'),
  },
  {
    id: 'BAND-05',
    ...covered('the owner and the reset rules', 'ui/host/src/app/contextband.test.ts'),
  },
  {
    id: 'BAND-06',
    ...covered('the checks on what the page sends', 'ui/host/src/app/contextband.test.ts'),
  },
  {
    id: 'BAND-07',
    ...covered('contrast (computed for every band colour), keyboard and screen reader', 'ui/host/src/app/contextband.test.ts (contrast) and ContextBand.test.tsx'),
  },
  {
    id: 'BAND-08',
    ...covered('the Italian and Spanish texts', 'ui/host/src/app/langpack.test.ts'),
  },
]

export default checks
