// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { MARIO, WORK } from '../support/env.js';
import { openApp, plugins, restart, signIn, unique } from '../support/shell.js';
import { createPlugin, maven, sign, zip } from '../support/tools.js';

const TRAFFIC = join(WORK, 'traffic');
const SIGNAGE = join(WORK, 'signage');

test.describe('MK-023 Devkit for third-party plugin developers', () => {
  test('23.1–23.3 generated plugins build, are refused unsigned, and install signed', async ({
    page,
  }) => {
    createPlugin('dev.acme.traffic', '--name', 'Traffic', '--backend', '--directory', TRAFFIC);
    createPlugin('dev.acme.signage', '--name', 'Signage', '--directory', SIGNAGE);
    // The Java plugin builds with Maven against the plugin API of this repository.
    maven(join(TRAFFIC, 'pom.xml'), 'package', '-DskipTests');
    const built = readdirSync(join(TRAFFIC, 'target')).find((f) => f.endsWith('.zip'));
    expect(built).toBe('traffic-0.1.0.zip');
    const traffic = join(TRAFFIC, 'target', built ?? '');
    const signage = join(WORK, 'signage-0.1.0.zip');
    zip(SIGNAGE, signage);

    await signIn(page);
    await openApp(page, 'Plugins');
    const status = page.locator('mk-admin-plugins').getByRole('status');
    const upload = page.getByLabel('Plugin package');
    await upload.setInputFiles(traffic);
    await expect(status).toContainText('Only packages signed by a trusted publisher');

    sign(traffic, signage);
    await upload.setInputFiles(traffic);
    await expect(status).toContainText('dev.acme.traffic 0.1.0 is installed');
    await upload.setInputFiles(signage);
    await expect(status).toContainText('dev.acme.signage 0.1.0 is installed');

    const log = await restart();
    // Only the Java plugin needs a rebuild of the kernel.
    expect(log).toMatch(/added dev\.acme\.traffic/);
    expect(log).not.toMatch(/added dev\.acme\.signage/);
    const statuses = await plugins();
    expect(statuses.find((p) => p.id === 'dev.acme.traffic')?.status).toBe('ACTIVE');
    expect(statuses.find((p) => p.id === 'dev.acme.signage')?.status).toBe('ACTIVE');
  });

  test('23.3–23.4 the generated apps work for the people of the organization', async ({ page }) => {
    await signIn(page, MARIO);
    await openApp(page, 'Traffic');
    const item = unique('Semaforo via Roma');
    await page.locator('mk-shell #app-host input').first().fill(item);
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText(item)).toBeVisible();

    await openApp(page, 'Signage');
    await expect(page.getByRole('heading', { name: 'Signage' })).toBeVisible();
    // Without a backend the items are documents that the kernel keeps (ADR-0031).
    const sign = unique('Cartello piazza Duomo');
    await page.locator('mk-shell #app-host input').first().fill(sign);
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText(sign)).toBeVisible();
    await page.reload();
    await expect(page.getByText(sign)).toBeVisible();
  });
});
