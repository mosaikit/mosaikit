// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: A
// e2e-installs: activities, estimates, notes, hello
import { expect, test } from '@playwright/test';
import { MARIO } from '../support/env.js';
import { apps, openApp, extensions, restart, signIn } from '../support/shell.js';

const FIXTURES = ['activities', 'estimates', 'notes', 'hello'];
/** Frontends without a backend or a schema: active as soon as they are installed (ADR-0031). */
const FRONTEND_ONLY = new Set(['hello']);

test.describe('MK-022 Minimal marketplace with signed catalogs', () => {
  test('22.1–22.2 an administrator installs extensions from a signed catalog without touching files', async ({
    page,
  }) => {
    await signIn(page);
    await openApp(page, 'Extensions');
    await expect(page.getByText(/verified, key/)).toBeVisible();
    const rows = page.locator('tbody tr');
    // The packages of the fixture extensions (tests/fixtures/extensions).
    await expect(rows).toHaveCount(7);

    for (const name of FIXTURES) {
      const id = `dev.mosaikit.fixture.${name}`;
      const row = rows.filter({ hasText: id });
      await row.getByRole('button', { name: 'Install' }).click();
      const status = page.locator('mk-admin-extensions').getByRole('status');
      if (FRONTEND_ONLY.has(name)) {
        await expect(status).toContainText(`${id} 0.1.0 is installed and active`);
      } else {
        await expect(status).toContainText(`${id} 0.1.0 is installed: restart Mosaikit`);
        // Until the restart the package waits, and cannot be installed twice.
        await expect(row).toContainText('installed, restart Mosaikit to use it');
      }
      await expect(row.getByRole('button', { name: /^(Install|Update)$/ })).toHaveCount(0);
    }

    const log = await restart();
    expect(log).toMatch(/kernel rebuilt in [\d.]+ s/);
    const statuses = await extensions();
    for (const name of FIXTURES) {
      expect(statuses.find((p) => p.id === `dev.mosaikit.fixture.${name}`)?.status).toBe('ACTIVE');
    }
  });

  test('22.2 the installed apps are in the launcher of the people of the organization', async ({
    page,
  }) => {
    await signIn(page, MARIO);
    for (const app of ['Activities', 'Notes', 'Hello']) {
      await expect(apps(page).getByRole('link', { name: app, exact: true })).toBeVisible();
    }
  });
});
