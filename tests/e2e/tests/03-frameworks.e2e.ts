// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test, type Page } from '@playwright/test';
import { MARIO } from '../support/env.js';
import { openApp, signIn } from '../support/shell.js';

/** The colours and the subtitle that the React app and its Vue widget render. */
async function rendered(page: Page): Promise<{ react: string; vue: string; subtitle: string }> {
  return page.evaluate(() => {
    const palette = document
      .querySelector('mk-shell')
      ?.shadowRoot?.querySelector('mk-sample-palette');
    const section = palette?.shadowRoot?.querySelector('section');
    const status = palette?.shadowRoot
      ?.querySelector('mk-sample-swatch')
      ?.shadowRoot?.querySelector('[role=status]');
    return {
      react: section ? getComputedStyle(section).backgroundColor : '',
      vue: status ? getComputedStyle(status).color : '',
      subtitle: palette?.shadowRoot?.querySelector('p.muted')?.textContent ?? '',
    };
  });
}

test.describe('MK-021 Plugin frontends written with any framework', () => {
  test('21.1–21.2 a Vue widget inside a React app receives its selection on the bus', async ({
    page,
  }) => {
    await signIn(page, MARIO);
    await openApp(page, 'Palette');
    const swatch = page.locator('mk-sample-swatch');
    await expect(swatch).toHaveCount(1);
    await page.getByRole('button', { name: 'Teal' }).click();
    await expect(page.getByRole('button', { name: 'Teal' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(swatch.getByRole('status')).toHaveText('Teal');
  });

  test.describe('in a dark browser in Italian', () => {
    test.use({ colorScheme: 'dark', locale: 'it-IT' });

    test('21.3 both frameworks follow the theme and the language of the shell', async ({
      page,
      browser,
    }) => {
      await signIn(page, MARIO);
      await openApp(page, 'Palette');
      await expect(page.locator('mk-sample-swatch').getByRole('status')).toBeVisible();
      const dark = await rendered(page);

      const lightContext = await browser.newContext({ colorScheme: 'light', locale: 'en-GB' });
      const light = await lightContext.newPage();
      await signIn(light, MARIO);
      await openApp(light, 'Palette');
      await expect(light.locator('mk-sample-swatch').getByRole('status')).toBeVisible();
      const bright = await rendered(light);
      await lightContext.close();

      expect(dark.react).not.toBe(bright.react);
      expect(dark.vue).not.toBe(bright.vue);
      // The language of the shell, chosen from the browser before any setting (MK-027).
      expect(dark.subtitle).toContain(', it:');
      expect(dark.subtitle).toMatch(/lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica/);
      expect(bright.subtitle).toContain(', en:');
    });
  });
});
