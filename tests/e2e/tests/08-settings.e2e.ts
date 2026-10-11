// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ADMIN, DATABASE, INSTALLATION, MARIO } from '../support/env.js';
import { defaultSettings } from '../support/installation.js';
import { api, openApp, restart, signIn } from '../support/shell.js';

/** Every file under a directory. */
function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test.describe('MK-011 Settings of the installation and rebuilds of the kernel', () => {
  test('the rebuilt kernel holds none of the settings of the installation', () => {
    // The previous files installed Java plugins, so the kernel was rebuilt with these settings.
    const kernel = join(INSTALLATION, 'bin', 'kernel');
    // Only values that cannot appear by chance: the test database may use the password "mosaikit".
    const secrets = [DATABASE.password, ADMIN.password].filter(
      (secret) => secret.length >= 10 && !/^mosaikit$/i.test(secret),
    );
    expect(secrets).toContain(ADMIN.password);
    const leaks = files(kernel)
      .filter((file) => !file.includes(join('kernel', 'plugin-packages')))
      .filter((file) => {
        const content = readFileSync(file).toString('latin1');
        return secrets.some((secret) => content.includes(secret));
      });
    expect(leaks).toEqual([]);
  });
});

test.describe('MK-024 Assistant on the tools of the plugins', () => {
  test('24.6 a model that cannot be reached gives a readable error, and the shell works', async ({
    page,
  }) => {
    await restart({ ...defaultSettings(), 'mosaikit.assistant.url': 'http://localhost:18099/v1' });
    await signIn(page, MARIO);
    const assistant = page.locator('mk-assistant');
    await assistant.getByLabel('Question for the assistant').fill('Quali attività sono aperte?');
    await assistant.getByRole('button', { name: 'Ask' }).click();
    const alert = assistant.getByRole('alert');
    await expect(alert).toContainText(
      'Cannot reach the model: no answer at http://localhost:18099/v1/',
    );
    await expect(alert).not.toContainText('null');
    await openApp(page, 'Activities');
    await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible();
  });

  test('24.7 without a model there is no assistant, even after a rebuild with one', async ({
    page,
  }) => {
    const settings = defaultSettings();
    delete settings['mosaikit.assistant.url'];
    await restart(settings);
    expect((await api(MARIO, '/api/v1/ai/assistant')).body).toMatchObject({ enabled: false });
    await signIn(page, MARIO);
    await expect(page.locator('mk-assistant')).toHaveCount(0);
    const tools = await api(MARIO, '/api/v1/ai/tools');
    expect(tools.status).toBe(200);
    expect(JSON.stringify(tools.body)).toContain('sample-activities__list-activities');
  });
});
