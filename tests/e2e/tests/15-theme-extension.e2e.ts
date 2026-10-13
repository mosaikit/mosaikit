// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: C
// e2e-installs: theme
import { expect, test } from '@playwright/test';
import { MARIO } from '../support/env.js';
import { defaultSettings } from '../support/installation.js';
import { api, openApp, restart, signIn } from '../support/shell.js';

const ID = 'dev.mosaikit.fixture.theme';

test.describe('MK-028 Themes as theme extensions', () => {
  test.afterEach(async () => {
    await api(MARIO, '/api/v1/accounts/me/preferences', {
      method: 'PUT',
      body: JSON.stringify({ theme: null, appearance: null, language: null, hiddenApps: [] }),
    });
  });

  test('28.1 an installed theme extension is offered in the settings, and the shell follows it', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    await openApp(page, 'Extensions');
    const row = page.locator('tbody tr').filter({ hasText: ID });
    await row.getByRole('button', { name: 'Install' }).click();
    await expect(page.locator('mk-admin-extensions').getByRole('status')).toContainText(
      `${ID} 0.1.0 is installed and active`,
    );

    const person = await (await browser.newContext()).newPage();
    await signIn(person, MARIO);
    const root = person.locator('html');
    const defaultBackground = await root.evaluate((html) =>
      getComputedStyle(html).getPropertyValue('--mk-bg').trim(),
    );
    await person.getByRole('button', { name: /^Account:/ }).click();
    await person
      .getByRole('dialog', { name: 'Account' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await person.getByLabel('Theme').selectOption({ label: 'Green' });
    await person.getByRole('radio', { name: 'Light' }).check();

    await expect(root).toHaveAttribute('data-mk-theme', ID);
    await expect
      .poll(() =>
        root.evaluate((html) => getComputedStyle(html).getPropertyValue('--mk-accent').trim()),
      )
      .toBe('#1b6e3c');
    // 28.2 What the theme leaves out comes from the default theme.
    const background = await root.evaluate((html) =>
      getComputedStyle(html).getPropertyValue('--mk-bg').trim(),
    );
    expect(background).toBe(defaultBackground);
    // A part of the shell, colored by the tokens, follows the theme.
    await expect(person.locator('mk-shell').locator('.top')).toHaveCSS(
      'background-color',
      'rgb(27, 110, 60)',
    );
  });
});

test.describe('MK-052 The product name and logo of the theme of the installation', () => {
  const ASSETS = `/api/v1/extension-assets/${ID}/web`;

  test.afterAll(async () => {
    await restart(defaultSettings());
  });

  test('52.1 the shell, the sign-in page, the title and the icon of the page name the product', async ({
    page,
  }) => {
    // The theme installed by 28.1 becomes the theme of the installation.
    await restart({ ...defaultSettings(), 'mosaikit.ui.theme': ID });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');

    const signInPage = page.locator('mk-sign-in');
    await expect(signInPage.locator('.brand')).toHaveText('Green Works');
    await expect(signInPage.locator('.brand img')).toHaveAttribute('src', `${ASSETS}/logo.svg`);
    await expect(page).toHaveTitle('Green Works');
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', `${ASSETS}/logo.svg`);
    // The logo is served before sign-in.
    expect((await page.request.get(`${ASSETS}/logo.svg`)).status()).toBe(200);

    // On a dark background, the logo for dark backgrounds.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(signInPage.locator('.brand img')).toHaveAttribute(
      'src',
      `${ASSETS}/logo-dark.svg`,
    );

    await signIn(page, MARIO);
    const brand = page.locator('mk-shell').locator('.top .brand');
    await expect(brand.locator('.name')).toHaveText('Green Works');
    // The bar of the shell has the brand color in both schemes: the logo for dark backgrounds.
    await expect(brand.locator('img.logo')).toHaveAttribute('src', `${ASSETS}/logo-dark.svg`);
  });
});
