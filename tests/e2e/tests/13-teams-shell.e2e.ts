// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, INSTALLATION, MARIO } from '../support/env.js';
import { defaultSettings } from '../support/installation.js';
import { apps, plugins, restart, signIn, signOut } from '../support/shell.js';

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.help} (${v.nodes.map((node) => node.target.join(' ')).join(', ')})`,
    ),
  ).toEqual([]);
}

test.describe('MK-025 Shell with app bar, top bar and work area', () => {
  test('25.1 the app bar opens each app in the work area with its own route', async ({ page }) => {
    await signIn(page, MARIO);
    const bar = apps(page);
    // The sample plugins contribute to rail.app with an order: To do (10) before Activities (20).
    const titles = await bar.getByRole('link').allInnerTexts();
    expect(titles.slice(0, 2)).toEqual(['Activity', 'Home']);
    expect(titles.indexOf('To do')).toBeLessThan(titles.indexOf('Activities'));
    await expect(
      bar.getByRole('link', { name: 'To do', exact: true }).locator('img'),
    ).toHaveAttribute(
      'src',
      /\/api\/v1\/plugin-assets\/dev\.mosaikit\.sample\.todo\/web\/icon\.svg$/,
    );

    await bar.getByRole('link', { name: 'Activities', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/activities$/);
    await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Activities', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectAccessible(page);

    // The search of the top bar opens apps and pages by name.
    const search = page.getByRole('combobox', { name: 'Search apps and pages' });
    await search.fill('to d');
    await expect(page.getByRole('option', { name: 'To do' })).toBeVisible();
    await search.press('Enter');
    await expect(page).toHaveURL(/\/app\/todo$/);

    // Home shows the apps too.
    await bar.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Your apps' }).getByRole('link')).not.toHaveCount(
      0,
    );
    await expectAccessible(page);
  });

  test('25.2 an app contributed with launcher.app is shown, with a deprecation warning', async ({
    page,
  }) => {
    // A plugin written before rail.app, as a directory of the installation.
    const legacy = join(INSTALLATION, 'plugins', 'legacy');
    mkdirSync(join(legacy, 'web'), { recursive: true });
    writeFileSync(join(legacy, 'web', 'index.js'), 'export default { activate() {} };\n');
    writeFileSync(
      join(legacy, 'manifest.yaml'),
      [
        'id: dev.acme.legacy',
        'version: 0.1.0',
        'name: Legacy',
        'kind: [app]',
        "platform: '>=0.1 <1'",
        'frontend:',
        '  entry: web/index.js',
        'contributes:',
        '  launcher.app:',
        '    - { id: legacy, title: Legacy, route: /app/legacy, element: acme-legacy }',
        '',
      ].join('\n'),
    );
    try {
      await restart(defaultSettings());
      const legacyPlugin = (await plugins()).find((plugin) => plugin.id === 'dev.acme.legacy');
      expect(legacyPlugin?.status).toBe('ACTIVE');
      expect(legacyPlugin?.warnings.join(' ')).toContain('launcher.app is deprecated');
      await signIn(page, MARIO);
      await expect(apps(page).getByRole('link', { name: 'Legacy', exact: true })).toBeVisible();
    } finally {
      rmSync(legacy, { recursive: true, force: true });
      await restart(defaultSettings());
    }
  });

  test('25.3 the menu of the person shows who is signed in and signs out', async ({ page }) => {
    await signIn(page, MARIO);
    await page.getByRole('button', { name: 'Account: Mario Rossi' }).click();
    const menu = page.getByRole('dialog', { name: 'Account' });
    await expect(menu).toContainText(MARIO.user);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await signOut(page);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('25.4 at phone width the app bar is at the bottom and every screen fits', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signIn(page, ADMIN);
    const bar = apps(page);
    const box = await bar.boundingBox();
    expect(box?.y ?? 0).toBeGreaterThan(600);
    for (const name of ['Home', 'Plugins', 'Platform']) {
      await bar.getByRole('link', { name, exact: true }).click();
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width).toBeLessThanOrEqual(360);
    }
  });

  test('25.6 when the apps cannot be loaded the person still enters, and is told why', async ({
    page,
  }) => {
    await page.route('**/api/v1/shell/plugins', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Internal Server Error', status: 500, detail: 'Broken.' }),
      }),
    );
    await signIn(page, MARIO);
    await expect(page.getByRole('alert')).toContainText(
      'You are signed in, but the apps could not be loaded',
    );
    await expect(page.getByRole('button', { name: 'Account: Mario Rossi' })).toBeVisible();
  });

  test('25.5 no name or logo of another product is in the shell', async ({ page }) => {
    await signIn(page, MARIO);
    const text = await page.locator('body').evaluate((body) => {
      const shell = body.querySelector('mk-shell');
      return shell?.shadowRoot?.textContent ?? '';
    });
    expect(text).not.toMatch(/Microsoft|Teams|Office/);
  });
});
