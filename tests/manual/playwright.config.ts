import { defineConfig } from '@playwright/test'

// The automated twins of docs/manual-tests.md (tests/manual), started by `cargo xtask manual-tests` on a
// new instance seeded like the development environment. The checks open their own browser (Edge on
// Windows, Chromium elsewhere: E2E_CHANNEL) and run one after the other, in the order of the document.
const runDir = process.env.MANUAL_RUN_DIR ?? '../results/raw/manual'

export default defineConfig({
  testDir: '.',
  testMatch: 'manual.spec.ts',
  globalSetup: './seed.ts',
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: process.env.MANUAL_JSON ?? `${runDir}/results.json` }]],
  outputDir: `${runDir}/test-output`,
})
