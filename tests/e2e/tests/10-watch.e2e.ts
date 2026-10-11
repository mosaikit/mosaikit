// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { INSTALLATION, MARIO } from '../support/env.js';
import { defaultSettings } from '../support/installation.js';
import { apps, openApp, restart, signIn } from '../support/shell.js';

const PLUGIN = join(INSTALLATION, 'plugins', 'kiosk');

/** A frontend-only plugin as a directory, as in development: no package, no signature. */
function write(greeting: string): void {
  mkdirSync(join(PLUGIN, 'web'), { recursive: true });
  writeFileSync(
    join(PLUGIN, 'manifest.yaml'),
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
    join(PLUGIN, 'web', 'index.js'),
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

test.describe('Development mode: changed plugins show at once', () => {
  test.afterAll(async () => {
    rmSync(PLUGIN, { recursive: true, force: true });
    await restart(defaultSettings());
  });

  test('a new plugin and a changed frontend show without a restart or a manual reload', async ({
    page,
  }) => {
    await restart({
      ...defaultSettings(),
      'mosaikit.plugins.watch': 'true',
      'mosaikit.plugins.unverified-frontends': 'module',
    });
    await signIn(page, MARIO);

    write('Benvenuti');
    await expect(apps(page).getByRole('link', { name: 'Kiosk', exact: true })).toBeVisible();
    await openApp(page, 'Kiosk');
    await expect(page.getByRole('heading', { name: 'Benvenuti' })).toBeVisible();

    // The page reloads by itself and keeps the session.
    write('Welcome');
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/kiosk$/);
  });
});
