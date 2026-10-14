// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: B
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ADMIN } from '../support/env.js';
import { OTHER, otherOrganizationPerson } from '../support/people.js';
import { api, openApp, signIn } from '../support/shell.js';

const suspension = (email: string): string =>
  `/api/v1/platform/accounts/${encodeURIComponent(email)}/suspension`;

test.describe('MK-125 Sign-out and administrators end sessions on the server', () => {
  test('125.4 a platform administrator suspends an account with a reason and reinstates it', async ({
    page,
  }) => {
    const luca = await otherOrganizationPerson();
    await api(ADMIN, suspension(luca.user), { method: 'DELETE' });
    try {
      await signIn(page, ADMIN);
      await openApp(page, 'Accounts');
      await expect(page.getByRole('heading', { name: 'Accounts', level: 1 })).toBeVisible();

      const find = page.getByRole('form', { name: 'Find an account' });
      await find.getByLabel('Email address of the account', { exact: true }).fill(luca.user);
      await find.getByRole('button', { name: 'Find', exact: true }).click();
      const account = page.getByRole('region', { name: `${luca.name} (${luca.user})` });
      await expect(account).toContainText('Active: the person signs in.');

      // The reason is asked for.
      await account.getByRole('button', { name: 'Suspend', exact: true }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Write the reason for the suspension.' }),
      ).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

      await account
        .getByLabel('Reason for the suspension', { exact: true })
        .fill('Left the office');
      page.once('dialog', (dialog) => void dialog.accept());
      await account.getByRole('button', { name: 'Suspend', exact: true }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'is suspended: their sessions ended.' }),
      ).toBeVisible();
      await expect(account).toContainText('Reason: Left the office');
      const row = page
        .getByRole('table', { name: 'Suspended accounts' })
        .getByRole('row')
        .filter({ hasText: luca.user });
      await expect(row).toContainText('Left the office');

      // The person signs in by no means.
      expect((await api(luca, '/api/v1/accounts/me', {}, OTHER.slug)).status).toBe(401);

      await row.getByRole('button', { name: `Reinstate ${luca.user}`, exact: true }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'is reinstated and can sign in again.' }),
      ).toBeVisible();
      await expect(row).toHaveCount(0);
      await expect(account).toContainText('Active: the person signs in.');
      expect((await api(luca, '/api/v1/accounts/me', {}, OTHER.slug)).status).toBe(200);
    } finally {
      await api(ADMIN, suspension(luca.user), { method: 'DELETE' });
    }
  });
});
