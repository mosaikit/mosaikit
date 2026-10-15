// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: C
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, BASE_URL, MARIO } from '../support/env.js';
import { OTHER, otherOrganizationPerson } from '../support/people.js';
import { api, apps, openApp, signIn } from '../support/shell.js';

async function accessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.describe('MK-072 Administration pages of the platform and of organizations on one model', () => {
  test('72.1 the console shows organizations, people, extensions, the system and refused sign-ins, only to platform administrators', async ({
    page,
  }) => {
    // A refused sign-in, for the security events.
    const stranger = `intruder-${Date.now().toString(36)}@example.org`;
    const refused = await fetch(`${BASE_URL}/api/v1/accounts/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: stranger, password: 'not the password' }).toString(),
    });
    expect(refused.status).toBe(401);

    await signIn(page, ADMIN);
    await openApp(page, 'Console');
    await expect(page.getByRole('heading', { name: 'Console', level: 1 })).toBeVisible();
    const metrics = page.getByRole('list', { name: 'Metrics' });
    for (const label of [
      'Organizations',
      'People',
      'Active extensions',
      'Failed sign-ins',
      'Memory',
      'Running for',
    ]) {
      await expect(metrics.getByRole('listitem').filter({ hasText: label })).toHaveCount(1);
    }
    const security = page.getByRole('table', { name: 'Security events' });
    await expect(security.getByRole('row').filter({ hasText: stranger })).toContainText(
      `Sign-in refused for ${stranger}`,
    );
    await expect(
      page
        .getByRole('region', { name: 'Active extensions' })
        .getByText('dev.mosaikit.fixture.hello'),
    ).toBeVisible();
    // The panel that the extension Hello adds through console.panel.
    await expect(page.getByRole('region', { name: 'Greetings' })).toContainText(
      'greets the platform administrators.',
    );
    await accessible(page);

    // Not for the others: no link, and the API refuses them.
    await page.context().clearCookies();
    await signIn(page, MARIO);
    await expect(apps(page).getByRole('link', { name: 'Console', exact: true })).toHaveCount(0);
    expect((await api(MARIO, '/api/v1/platform/console')).status).toBe(403);
  });

  test('72.2 a guided flow creates an organization with its administrator; it is suspended, reactivated and deleted', async ({
    page,
  }) => {
    const luca = await otherOrganizationPerson();
    const suffix = Date.now().toString(36);
    const name = `Green ${suffix}`;
    const slug = `green-${suffix}`;

    await signIn(page, ADMIN);
    await openApp(page, 'Organizations');
    await expect(page.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Metrics' })).toContainText('Suspended');

    await page.getByRole('button', { name: 'New organization', exact: true }).click();
    const wizard = page.getByRole('form', { name: 'New organization' });
    // Each step says what is missing before the next.
    await wizard.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(wizard).toContainText('Write the name of the organization.');
    await wizard.getByLabel('Name', { exact: true }).fill(name);
    await expect(wizard.getByLabel('Address name', { exact: true })).toHaveValue(slug);
    await wizard.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(wizard.getByRole('radio', { name: 'Password', exact: true })).toBeChecked();
    await wizard.getByRole('button', { name: 'Next', exact: true }).click();
    await wizard
      .getByLabel('Email address of the administrator', { exact: true })
      .fill(`robin.${suffix}@example.org`);
    await wizard.getByLabel('First name', { exact: true }).fill('Robin');
    await wizard.getByLabel('Last name', { exact: true }).fill('Green');
    await wizard.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(wizard.getByRole('definition').filter({ hasText: slug })).toHaveCount(1);
    await accessible(page);
    await wizard.getByRole('button', { name: 'Create the organization', exact: true }).click();
    await expect(page.getByRole('heading', { name: `${name} is created` })).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    const created = await api(ADMIN, `/api/v1/organizations/${slug}/members`, {}, slug);
    expect(created.status).toBe(200);
    expect(JSON.stringify(created.body)).toContain(`robin.${suffix}@example.org`);
    expect(JSON.stringify(created.body)).toContain('organization-admin');

    // A member of it, who signs in with a password.
    expect(
      (
        await api(ADMIN, `/api/v1/organizations/${slug}/members/${encodeURIComponent(luca.user)}`, {
          method: 'PUT',
          body: JSON.stringify({ roles: ['organization-user'] }),
        })
      ).status,
    ).toBe(200);
    const organizationOf = async (): Promise<unknown> =>
      ((await api(luca, '/api/v1/accounts/me', {}, slug)).body as { organization?: unknown })
        .organization;
    expect(await organizationOf()).toBe(slug);

    // Filters above the table, actions on each row, the detail in a side pane.
    await page.getByLabel('Search organizations', { exact: true }).fill(suffix);
    const row = page
      .getByRole('table', { name: 'Organizations' })
      .getByRole('row')
      .filter({ hasText: slug });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: `Suspend ${name}`, exact: true }).click();
    const pane = page.getByRole('complementary', { name });
    await expect(pane).toContainText('Active: its members sign in.');
    await pane.getByLabel('Reason for the suspension', { exact: true }).fill('Trial ended');
    page.once('dialog', (dialog) => void dialog.accept());
    await pane.getByRole('button', { name: 'Suspend the organization', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `${name} is suspended` }),
    ).toBeVisible();
    await expect(pane).toContainText('Reason: Trial ended');
    await expect(row).toContainText('Suspended');
    // Its members cannot sign in to it.
    expect(await organizationOf()).toBeFalsy();
    await accessible(page);

    await row.getByRole('button', { name: `Reactivate ${name}`, exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `${name} is active again` }),
    ).toBeVisible();
    expect(await organizationOf()).toBe(slug);

    await row.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
    const confirmation = page.getByRole('form', { name: `Delete ${name}` });
    await confirmation.getByLabel(`Write ${slug} to confirm`, { exact: true }).fill(slug);
    await confirmation
      .getByRole('button', { name: 'Delete the organization', exact: true })
      .click();
    await expect(page.getByRole('status').filter({ hasText: `${name} deleted` })).toBeVisible();
    await expect(row).toHaveCount(0);
    // The person keeps the other organization.
    expect((await api(luca, '/api/v1/accounts/me', {}, OTHER.slug)).status).toBe(200);
  });

  test('72.3 the people of the installation follow the same model', async ({ page }) => {
    const luca = await otherOrganizationPerson();
    await signIn(page, ADMIN);
    await openApp(page, 'People');
    await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Metrics' })).toContainText('Suspended');
    await expect(page.getByRole('search', { name: 'Filters' })).toBeVisible();
    await page.getByLabel('Search people', { exact: true }).fill(luca.user);
    const row = page
      .getByRole('table', { name: 'People' })
      .getByRole('row')
      .filter({ hasText: luca.user });
    await expect(row).toContainText(OTHER.name);
    await row.getByRole('button', { name: `Details of ${luca.user}`, exact: true }).click();
    const pane = page.getByRole('complementary', { name: `${luca.name} (${luca.user})` });
    await expect(pane).toContainText('Active: the person signs in.');
    await expect(pane.getByRole('list', { name: 'Organizations' })).toContainText(OTHER.name);
    await accessible(page);
  });
});
