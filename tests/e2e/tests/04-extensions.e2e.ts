// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test } from '@playwright/test';
import { MARIO } from '../support/env.js';
import { openApp, signIn, unique } from '../support/shell.js';

test.describe('MK-020 Plugins that extend other plugins', () => {
  test('22.3 Estimates adds a field and a total to Activities', async ({ page }) => {
    await signIn(page, MARIO);
    await openApp(page, 'Activities');
    const title = unique('Riparare il lampione');
    await page.getByLabel('New activity').fill(title);
    await page.getByRole('button', { name: 'Add' }).click();
    const item = page.locator('li').filter({ hasText: title });
    await expect(item).toBeVisible();
    const estimate = item.getByLabel('Estimated hours');
    await estimate.fill('3');
    await estimate.press('Tab');
    await expect(page.getByText(/Estimated: \d+(\.\d+)? h/)).toBeVisible();
  });
});
