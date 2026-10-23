import { defineConfig } from '@playwright/test'

// The server is started by `cargo xtask e2e` (new database and data at every run).
// Browser: the installed Edge (E2E_CHANNEL=msedge, default on Windows) or the Chromium of
// Playwright (`npx playwright install chromium`, E2E_CHANNEL=chromium) in CI.
const channel = process.env.E2E_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium')

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // `cargo xtask e2e` also asks for the JSON results, for tests/results/test-results.md
  reporter: process.env.E2E_JSON ? [['list'], ['json', { outputFile: process.env.E2E_JSON }]] : [['list']],
  use: {
    // with the base path and the trailing `/`: page.goto('./') opens the app
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:18080/mosaikit/',
    channel: channel === 'chromium' ? undefined : channel,
    headless: process.env.E2E_HEADED ? false : true,
    // the browser of the tests speaks English (the default language of the app)
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
