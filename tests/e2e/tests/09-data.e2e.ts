// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test } from '@playwright/test';
import { ANNA, MARIO } from '../support/env.js';
import { OTHER, otherOrganizationPerson } from '../support/people.js';
import { api, apps, openApp, plugins, signIn, unique } from '../support/shell.js';

const ID = 'dev.mosaikit.sample.todo';
const ITEMS = `/api/v1/data/${ID}/items`;

test.describe('MK-046 Data of plugins without a backend', () => {
  test('46.1 a frontend-only plugin is active as soon as it is installed', async ({ page }) => {
    await signIn(page);
    await openApp(page, 'Plugins');
    const row = page.locator('tbody tr').filter({ hasText: ID });
    await row.getByRole('button', { name: 'Install' }).click();
    await expect(page.locator('mk-admin-plugins').getByRole('status')).toContainText(
      `${ID} 0.1.0 is installed and active`,
    );
    // No restart, no reload of the page: the shell loads the new app at once.
    await expect(apps(page).getByRole('link', { name: 'To do', exact: true })).toBeVisible();
    expect((await plugins()).find((plugin) => plugin.id === ID)?.status).toBe('ACTIVE');
  });

  test('46.2 the items are kept for the organization and nobody else', async ({ page }) => {
    const title = unique('Paint the fence');
    await signIn(page, MARIO);
    await openApp(page, 'To do');
    await page.getByLabel('New item').fill(title);
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('list', { name: 'Items' })).toContainText(title);
    await page.getByLabel(`Done: ${title}`).check();
    await expect(page.getByRole('status')).toContainText('shared with your organization');

    // A reload reads them again from the kernel.
    await page.reload();
    await expect(page.getByLabel(`Done: ${title}`)).toBeChecked();

    // Anna, in the same organization, sees the item.
    const seen = (await api(ANNA, ITEMS)).body as { data: { title: string; done: boolean } }[];
    expect(seen.find((item) => item.data.title === title)?.data.done).toBe(true);

    // A person of another organization sees nothing.
    const other = await api(await otherOrganizationPerson(), ITEMS, {}, OTHER.slug);
    expect(other.status).toBe(200);
    expect(other.body).toEqual([]);

    await page.getByRole('button', { name: `Remove ${title}` }).click();
    await expect(page.getByRole('list', { name: 'Items' })).not.toContainText(title);
  });
});
