// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test } from '@playwright/test';
import { MARIO } from '../support/env.js';
import { apps, openApp, plugins, restart, signIn } from '../support/shell.js';

const SAMPLES = ['activities', 'estimates', 'notes', 'react', 'vue'];
/** Frontends without a backend or a schema: active as soon as they are installed (ADR-0031). */
const FRONTEND_ONLY = new Set(['react', 'vue']);

test.describe('MK-022 Minimal marketplace with signed catalogs', () => {
  test('22.1–22.2 an administrator installs plugins from a signed catalog without touching files', async ({
    page,
  }) => {
    await signIn(page);
    await openApp(page, 'Plugins');
    await expect(page.getByText(/verified, key/)).toBeVisible();
    const rows = page.locator('tbody tr');
    // The packages of plugins/: the samples, the theme and the apps Teams and Chat.
    await expect(rows).toHaveCount(10);

    for (const name of SAMPLES) {
      const id = `dev.mosaikit.sample.${name}`;
      const row = rows.filter({ hasText: id });
      await row.getByRole('button', { name: 'Install' }).click();
      const status = page.locator('mk-admin-plugins').getByRole('status');
      if (FRONTEND_ONLY.has(name)) {
        await expect(status).toContainText(`${id} 0.1.0 is installed and active`);
      } else {
        await expect(status).toContainText(`${id} 0.1.0 is installed: restart Mosaikit`);
        // Until the restart the package waits, and cannot be installed twice.
        await expect(row).toContainText('installed, restart Mosaikit to use it');
      }
      await expect(row.getByRole('button')).toHaveCount(0);
    }

    const log = await restart();
    expect(log).toMatch(/kernel rebuilt in [\d.]+ s/);
    const statuses = await plugins();
    for (const name of SAMPLES) {
      expect(statuses.find((p) => p.id === `dev.mosaikit.sample.${name}`)?.status).toBe('ACTIVE');
    }
  });

  test('22.2 the installed apps are in the launcher of the people of the organization', async ({
    page,
  }) => {
    await signIn(page, MARIO);
    for (const app of ['Activities', 'Notes', 'Palette']) {
      await expect(apps(page).getByRole('link', { name: app, exact: true })).toBeVisible();
    }
  });
});
