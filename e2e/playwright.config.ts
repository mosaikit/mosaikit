import { defineConfig } from '@playwright/test'

// Il server viene avviato da `cargo xtask e2e` (database e dati nuovi a ogni esecuzione).
// Browser: Edge installato (E2E_CHANNEL=msedge, default su Windows) oppure il Chromium
// di Playwright (`npx playwright install chromium`, E2E_CHANNEL=chromium) in CI.
const channel = process.env.E2E_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium')

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    // con il percorso base e la `/` finale: page.goto('./') apre l'app
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:18080/mosaikit/',
    channel: channel === 'chromium' ? undefined : channel,
    headless: process.env.E2E_HEADED ? false : true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
