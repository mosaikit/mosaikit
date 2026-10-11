// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test } from '@playwright/test';
import { MARIO } from '../support/env.js';
import { api, openApp, signIn } from '../support/shell.js';

const ID = 'dev.mosaikit.sample.theme';

test.describe('MK-028 Themes as theme plugins', () => {
  test.afterEach(async () => {
    await api(MARIO, '/api/v1/accounts/me/preferences', {
      method: 'PUT',
      body: JSON.stringify({ theme: null, appearance: null, language: null, hiddenApps: [] }),
    });
  });

  test('28.1 an installed theme plugin is offered in the settings, and the shell follows it', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    await openApp(page, 'Plugins');
    const row = page.locator('tbody tr').filter({ hasText: ID });
    await row.getByRole('button', { name: 'Install' }).click();
    await expect(page.locator('mk-admin-plugins').getByRole('status')).toContainText(
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
