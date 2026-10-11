// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, INSTALLATION, MARIO } from '../support/env.js';
import { defaultSettings } from '../support/installation.js';
import { api, apps, restart, signIn, signOut } from '../support/shell.js';

const PREFERENCES = '/api/v1/accounts/me/preferences';
const DEFAULTS = { theme: null, appearance: null, language: null, hiddenApps: [] };

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Account:/ }).click();
  await page
    .getByRole('dialog', { name: 'Account' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page.getByRole('heading', { name: 'Your settings' })).toBeVisible();
}

test.describe('MK-027 Personal settings: theme, language and active organization', () => {
  test.afterEach(async () => {
    await api(MARIO, PREFERENCES, { method: 'PUT', body: JSON.stringify(DEFAULTS) });
  });

  test('27.1 theme, appearance and language apply at once and are kept at the next sign-in', async ({
    page,
  }) => {
    await signIn(page, MARIO);
    await openSettings(page);
    await page.getByRole('radio', { name: 'High contrast' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-mk-scheme', 'contrast');
    await page.getByLabel('Theme').selectOption('pa');
    await expect(page.locator('html')).toHaveAttribute('data-mk-theme', 'pa');
    await page.getByLabel('Language').selectOption('it');
    await expect(page.getByRole('heading', { name: 'Le tue impostazioni' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expect(page.getByRole('status')).toContainText('Salvato');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`,
      ),
    ).toEqual([]);

    // Hidden apps leave the app bar.
    await page.getByRole('checkbox', { name: 'To do' }).uncheck();
    await expect(apps(page).getByRole('link', { name: 'To do', exact: true })).toHaveCount(0);

    // At the next sign-in everything is as it was chosen.
    await page.getByRole('button', { name: /^Account:/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Esci' }).click();
    await signInItalian(page);
    await expect(page.locator('html')).toHaveAttribute('data-mk-scheme', 'contrast');
    await expect(page.locator('html')).toHaveAttribute('data-mk-theme', 'pa');
    await expect(page.getByRole('heading', { name: /Benvenuto, Mario Rossi/ })).toBeVisible();
    await expect(apps(page).getByRole('link', { name: 'To do', exact: true })).toHaveCount(0);
  });

  test('27.3 a section of a plugin shows only to the people the plugin allows, in their language', async ({
    page,
  }) => {
    // A plugin that adds a section for platform administrators; it shows the language it reads.
    const directory = join(INSTALLATION, 'plugins', 'audit-prefs');
    mkdirSync(join(directory, 'web'), { recursive: true });
    writeFileSync(
      join(directory, 'web', 'index.js'),
      `export default {
  activate(context) {
    customElements.define('acme-audit-section', class extends HTMLElement {
      connectedCallback() { this.textContent = 'Audit export, language ' + context.locale; }
    });
  },
};
`,
    );
    writeFileSync(
      join(directory, 'manifest.yaml'),
      [
        'id: dev.acme.auditprefs',
        'version: 0.1.0',
        'name: Audit settings',
        'kind: [extension]',
        "platform: '>=0.1 <1'",
        'frontend:',
        '  entry: web/index.js',
        'contributes:',
        '  settings.section:',
        '    - { id: export, title: Audit export, element: acme-audit-section, roles: [platform-admin] }',
        '',
      ].join('\n'),
    );
    try {
      await restart({ ...defaultSettings(), 'mosaikit.plugins.unverified-frontends': 'module' });
      await signIn(page, MARIO);
      await openSettings(page);
      await expect(page.getByText('Audit export')).toHaveCount(0);
      await signOut(page);

      await signIn(page, ADMIN);
      await openSettings(page);
      await expect(page.getByText('Audit export, language en')).toBeVisible();
      await page.getByLabel('Language').selectOption('it');
      await expect(page.getByText('Audit export, language it')).toBeVisible();
      await page.getByLabel('Lingua').selectOption('en');
      await expect(page.getByText('Audit export, language en')).toBeVisible();
    } finally {
      await api(ADMIN, PREFERENCES, { method: 'PUT', body: JSON.stringify(DEFAULTS) });
      rmSync(directory, { recursive: true, force: true });
      await restart(defaultSettings());
    }
  });
});

/** Signs in on the sign-in page in Italian, which the browser of the test does not ask for. */
async function signInItalian(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with a password' }).click();
  await page.getByLabel('Email or username').fill(MARIO.user);
  await page.getByLabel('Password', { exact: true }).fill(MARIO.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
