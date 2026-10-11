// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test } from '@playwright/test';
import { ADMIN, ANNA, MARIO, ORGANIZATION } from '../support/env.js';
import { api, apps, openApp, signIn } from '../support/shell.js';

const MEMBER = `/api/v1/organizations/${ORGANIZATION.slug}/members/${ANNA.user}`;

test.describe('MK-030 Apps of the app bar per organization and role', () => {
  test.beforeAll(async () => {
    await api(ADMIN, MEMBER, {
      method: 'PUT',
      body: JSON.stringify({ roles: ['organization-admin', 'organization-user'] }),
    });
  });

  test.afterAll(async () => {
    await api(ADMIN, `/api/v1/organizations/${ORGANIZATION.slug}/apps`, {
      method: 'PUT',
      body: JSON.stringify([]),
    });
    await api(ADMIN, MEMBER, {
      method: 'PUT',
      body: JSON.stringify({ roles: ['organization-user'] }),
    });
  });

  test('30.1–30.2 an administrator of the organization turns an app off, pins one and orders them', async ({
    page,
    browser,
  }) => {
    await signIn(page, ANNA);
    await openApp(page, 'Organization apps');
    await expect(page.getByRole('heading', { name: 'Organization apps' })).toBeVisible();
    await page.getByLabel('Show Notes').uncheck();
    await page.getByLabel('Pin To do').check();
    // Activities to the top of the bar.
    const up = page.getByRole('button', { name: 'Move Activities up' });
    while (await up.isEnabled()) {
      await up.click();
    }
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status')).toContainText('Saved');

    const mario = await (await browser.newContext()).newPage();
    await signIn(mario, MARIO);
    const bar = apps(mario);
    await expect(bar.getByRole('link', { name: 'Notes', exact: true })).toHaveCount(0);
    const titles = await bar.getByRole('link').allInnerTexts();
    expect(titles.slice(0, 3)).toEqual(['Activity', 'Home', 'Activities']);
    // The API of the app that is off refuses the people of the organization.
    const notes = await api(MARIO, '/api/v1/p/sample-notes/notes');
    expect(notes.status).toBe(403);

    // A pinned app cannot be hidden in the personal settings.
    await mario.getByRole('button', { name: /^Account:/ }).click();
    await mario
      .getByRole('dialog', { name: 'Account' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await expect(mario.getByRole('checkbox', { name: 'To do' })).toBeDisabled();
    await expect(mario.getByRole('checkbox', { name: 'To do' })).toBeChecked();
    await expect(mario.getByText('Pinned by your organization')).toBeVisible();
  });

  test('30.3 an app for administrators only is not in the bar of the other people', async ({
    page,
  }) => {
    await api(ANNA, `/api/v1/organizations/${ORGANIZATION.slug}/apps`, {
      method: 'PUT',
      body: JSON.stringify([
        {
          pluginId: 'dev.mosaikit.sample.todo',
          appId: 'todo',
          enabled: true,
          pinned: false,
          roles: ['organization-admin'],
        },
      ]),
    });
    await signIn(page, MARIO);
    await expect(apps(page).getByRole('link', { name: 'To do', exact: true })).toHaveCount(0);
    await expect(apps(page).getByRole('link', { name: 'Activities', exact: true })).toBeVisible();
    // A person who is not an administrator of the organization cannot change its apps.
    const refused = await api(MARIO, `/api/v1/organizations/${ORGANIZATION.slug}/apps`);
    expect(refused.status).toBe(403);
  });
});
