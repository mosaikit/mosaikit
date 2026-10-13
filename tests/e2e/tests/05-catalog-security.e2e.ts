// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: A
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { CATALOG, INSTALLATION, MARIO, WORK } from '../support/env.js';
import { api, openApp, extensions, signIn } from '../support/shell.js';
import { addToZip, index, sign, unzip, zip } from '../support/tools.js';

const EXTENSIONS = join(INSTALLATION, 'extensions');

test.describe('MK-022 Minimal marketplace with signed catalogs', () => {
  test('22.4 an update keeps the package it replaces', async ({ page }) => {
    // Hello 0.1.1, signed by a trusted publisher and added to the signed index.
    const source = readdirSync(CATALOG).find((f) => f.startsWith('fixture-hello-0.1.0'));
    expect(source).toBeDefined();
    const unpacked = join(WORK, 'hello-0.1.1');
    unzip(join(CATALOG, source ?? ''), unpacked);
    const manifest = join(unpacked, 'manifest.yaml');
    writeFileSync(
      manifest,
      readFileSync(manifest, 'utf8').replace(/^version: .*$/m, 'version: 0.1.1'),
    );
    // The signature of 0.1.0 goes; the package is signed again below.
    rmSync(join(unpacked, 'META-INF', 'mosaikit'), { recursive: true, force: true });
    const packaged = join(CATALOG, 'fixture-hello-0.1.1.zip');
    zip(unpacked, packaged);
    sign(packaged);
    index(CATALOG);

    await signIn(page);
    await openApp(page, 'Extensions');
    const row = page
      .locator('tbody tr')
      .filter({ hasText: 'dev.mosaikit.fixture.hello' })
      .filter({ hasText: '0.1.1' });
    await row.getByRole('button', { name: 'Update' }).click();
    await expect(page.locator('mk-admin-extensions').getByRole('status')).toContainText(
      'dev.mosaikit.fixture.hello 0.1.1 is installed',
    );
    expect(existsSync(join(EXTENSIONS, 'dev.mosaikit.fixture.hello-0.1.1.zip'))).toBe(true);
    expect(existsSync(join(EXTENSIONS, '.previous', 'dev.mosaikit.fixture.hello-0.1.0.zip'))).toBe(
      true,
    );
    // A frontend without a backend is replaced at once (ADR-0031).
    await expect(page.locator('mk-admin-extensions').getByRole('status')).toContainText(
      'is installed and active',
    );
    const hello = (await extensions()).find((p) => p.id === 'dev.mosaikit.fixture.hello');
    expect(hello).toMatchObject({ status: 'ACTIVE', version: '0.1.1' });
  });

  test('22.5 a catalog whose index was changed is refused, with all it offers', async ({
    page,
  }) => {
    const file = join(CATALOG, 'index.json');
    const original = readFileSync(file, 'utf8');
    try {
      writeFileSync(file, original.replace('"size": ', '"size": 1'));
      await signIn(page);
      await openApp(page, 'Extensions');
      await expect(
        page.getByText(/refused, The signature of the index does not match/),
      ).toBeVisible();
      await expect(page.locator('tbody tr')).toHaveCount(0);
    } finally {
      writeFileSync(file, original);
    }
  });

  test('22.6 a signed package with a file added is refused at upload', async ({ page }) => {
    const hello = readdirSync(CATALOG).find((f) => f.startsWith('fixture-hello-0.1.0'));
    const tampered = join(WORK, 'tampered-hello.zip');
    copyFileSync(join(CATALOG, hello ?? ''), tampered);
    const extra = join(WORK, 'extra');
    mkdirSync(join(extra, 'web'), { recursive: true });
    writeFileSync(join(extra, 'web', 'extra.js'), 'alert(1)');
    addToZip(tampered, extra);
    const before = readdirSync(EXTENSIONS).filter((f) => f.endsWith('.zip')).length;

    await signIn(page);
    await openApp(page, 'Extensions');
    await page.getByLabel('Extension package').setInputFiles(tampered);
    const status = page.locator('mk-admin-extensions').getByRole('status');
    await expect(status).toContainText('Refused package');
    await expect(status).toContainText('web/extra.js');
    await expect(status).toHaveClass(/error/);
    expect(readdirSync(EXTENSIONS).filter((f) => f.endsWith('.zip'))).toHaveLength(before);
  });

  test('22.7 only platform administrators reach the Extensions page and the marketplace API', async ({
    page,
  }) => {
    await signIn(page, MARIO);
    await expect(
      page.getByRole('navigation', { name: 'Apps' }).getByRole('link', { name: 'Extensions' }),
    ).toHaveCount(0);
    expect((await api(MARIO, '/api/v1/marketplace')).status).toBe(403);
  });
});
