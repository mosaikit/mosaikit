// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test } from '@playwright/test';
import { ADMIN, ANNA, MARIO, ORGANIZATION } from '../support/env.js';
import { api, openApp, signIn, unique } from '../support/shell.js';

const SLUG = ORGANIZATION.slug;
const MEMBER = `/api/v1/organizations/${SLUG}/members/${ANNA.user}`;
const PERMISSIONS = `/api/v1/organizations/${SLUG}/permissions`;
/** The permission that the fixture Notes declares in its manifest, and the endpoint that needs it. */
const EXPORT = 'dev.mosaikit.fixture.notes:export-notes';
const EXPORT_API = '/api/v1/ext/fixture-notes/notes/export';

test.describe('MK-056 Permissions declared by extensions, granted through profiles, groups and people', () => {
  const team = unique('Exporters');
  const profile = unique('Readers');
  const invited = `${unique('invited').replace(/\s+/g, '-')}@comune.test`;
  let teamId = '';

  test.beforeAll(async () => {
    // Anna administers the organization; Mario is a member of a team of hers.
    await api(ADMIN, MEMBER, {
      method: 'PUT',
      body: JSON.stringify({ roles: ['organization-admin', 'organization-user'] }),
    });
    const created = await api(ANNA, '/api/v1/teams', {
      method: 'POST',
      body: JSON.stringify({ name: team, description: 'Exports notes', visibility: 'private' }),
    });
    expect(created.status).toBe(201);
    teamId = (created.body as { id: string }).id;
    const added = await api(ANNA, `/api/v1/teams/${teamId}/members/${MARIO.user}`, {
      method: 'PUT',
      body: JSON.stringify({ role: 'member' }),
    });
    expect(added.status).toBe(200);
  });

  test.afterAll(async () => {
    await api(ANNA, `/api/v1/teams/${teamId}`, { method: 'DELETE' });
    const profiles = await api(ANNA, `${PERMISSIONS}/profiles`);
    for (const found of profiles.body as { id: string; name: string }[]) {
      if (found.name === profile) {
        await api(ANNA, `${PERMISSIONS}/profiles/${found.id}`, { method: 'DELETE' });
      }
    }
    await api(ADMIN, `/api/v1/organizations/${SLUG}/members/${invited}`, { method: 'DELETE' });
    await api(ADMIN, MEMBER, {
      method: 'PUT',
      body: JSON.stringify({ roles: ['organization-user'] }),
    });
  });

  test('56.1–56.4 a permission is off until granted, the API refuses without it, a team grants it, an invitation shows it', async ({
    page,
  }) => {
    await signIn(page, ANNA);
    await openApp(page, 'Permissions');
    await expect(page.getByRole('heading', { name: 'Permissions', level: 1 })).toBeVisible();

    // 56.1 The permission of the extension is in the profile editor, off.
    await page.getByRole('button', { name: 'New profile' }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(profile);
    const exportBox = page.getByRole('checkbox', { name: 'Export notes', exact: true });
    await expect(exportBox).toBeVisible();
    await expect(exportBox).not.toBeChecked();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status')).toContainText('Saved.');
    const saved = (await api(ANNA, `${PERMISSIONS}/profiles`)).body as {
      name: string;
      permissions: string[];
    }[];
    expect(saved.find((found) => found.name === profile)?.permissions).toEqual([]);

    // 56.2 A member without it gets 403 from the API of the extension, around the interface.
    expect((await api(MARIO, EXPORT_API)).status).toBe(403);

    // 56.3 Granted to a team of the member, the same request succeeds.
    await page.getByRole('tab', { name: 'Teams' }).click();
    await page.getByRole('combobox', { name: 'Team', exact: true }).selectOption({ label: team });
    await page.getByRole('checkbox', { name: 'Export notes', exact: true }).check();
    await expect(page.getByRole('status')).toContainText('Granted.');
    expect((await api(MARIO, EXPORT_API)).status).toBe(200);

    // The person page says where the permission comes from.
    await page.getByRole('tab', { name: 'People' }).click();
    await page.getByRole('combobox', { name: 'Person', exact: true }).selectOption(MARIO.user);
    await expect(
      page.locator(`mk-effective-permissions li[data-permission="${EXPORT}"]`),
    ).toContainText(`Team ${team}`);

    // 56.4 The invitation shows the permissions before it is sent.
    await page.getByRole('button', { name: 'Invite a person' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite a person' });
    await dialog.getByRole('textbox', { name: 'Email' }).fill(invited);
    await dialog.getByRole('combobox', { name: 'Profile' }).selectOption({ label: profile });
    await dialog.getByRole('checkbox', { name: team }).check();
    await expect(dialog.locator(`li[data-permission="${EXPORT}"]`)).toContainText(`Team ${team}`);
    expect((await api(ANNA, `${PERMISSIONS}/members/${invited}`)).status).toBe(404);
    await dialog.getByRole('button', { name: 'Invite' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status')).toContainText(`${invited} is in the organization.`);
    const member = (await api(ANNA, `${PERMISSIONS}/members/${invited}`)).body as {
      profile: { name: string };
      permissions: { id: string }[];
    };
    expect(member.profile.name).toBe(profile);
    expect(member.permissions.map((permission) => permission.id)).toContain(EXPORT);

    // Revoked from the team, refused again.
    await page.getByRole('tab', { name: 'Teams' }).click();
    await page.getByRole('combobox', { name: 'Team', exact: true }).selectOption({ label: team });
    await page.getByRole('checkbox', { name: 'Export notes', exact: true }).uncheck();
    await expect(page.getByRole('status')).toContainText('Revoked.');
    expect((await api(MARIO, EXPORT_API)).status).toBe(403);
  });
});
