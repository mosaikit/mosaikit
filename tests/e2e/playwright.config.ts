// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './support/env.js';

/**
 * End-to-end tests on a real installation built by `./mvnw install` (target/dist): launcher,
 * kernel, shell and plugins, in a browser. Only the language model is a fake. The files run in
 * order, in one worker: later files use the plugins that earlier ones installed.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '*.e2e.ts',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'report' }], ['github']]
    : [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  outputDir: './.work/results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
});
