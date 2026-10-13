// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: B
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { INSTALLATION, MARIO } from '../support/env.js';
import { defaultSettings } from '../support/installation.js';
import { apps, openApp, restart, signIn } from '../support/shell.js';

const EXTENSION = join(INSTALLATION, 'extensions', 'kiosk');

/** A frontend-only extension as a directory, as in development: no package, no signature. */
function write(greeting: string): void {
  mkdirSync(join(EXTENSION, 'web'), { recursive: true });
  writeFileSync(
    join(EXTENSION, 'manifest.yaml'),
    [
      'id: dev.acme.kiosk',
      'version: 0.1.0',
      'name: Kiosk',
      'kind: [app]',
      "platform: '>=0.1 <1'",
      'frontend:',
      '  entry: web/index.js',
      'contributes:',
      '  rail.app:',
      '    - { id: kiosk, title: Kiosk, route: /app/kiosk, element: acme-kiosk }',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(EXTENSION, 'web', 'index.js'),
    `export default {
  activate() {
    customElements.define('acme-kiosk', class extends HTMLElement {
      connectedCallback() { this.innerHTML = '<h1>${greeting}</h1>'; }
    });
  },
};
`,
  );
}

test.describe('Development mode: changed extensions show at once', () => {
  test.afterAll(async () => {
    rmSync(EXTENSION, { recursive: true, force: true });
    await restart(defaultSettings());
  });

  test('a new extension and a changed frontend show without a restart or a manual reload', async ({
    page,
  }) => {
    await restart({
      ...defaultSettings(),
      'mosaikit.extensions.watch': 'true',
      'mosaikit.extensions.unverified-frontends': 'module',
    });
    await signIn(page, MARIO);

    // The watcher and the live channel of the shell, with other installations running beside this
    // one (tests/e2e/run.ts), may take longer than the default 15 s.
    const watched = { timeout: 30_000 };
    write('Benvenuti');
    await expect(apps(page).getByRole('link', { name: 'Kiosk', exact: true })).toBeVisible(watched);
    await openApp(page, 'Kiosk');
    await expect(page.getByRole('heading', { name: 'Benvenuti' })).toBeVisible();

    // The page reloads by itself and keeps the session.
    write('Welcome');
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible(watched);
    await expect(page).toHaveURL(/\/app\/kiosk$/);
  });
});
