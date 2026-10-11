// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test } from '@playwright/test';
import { ANNA, MARIO } from '../support/env.js';
import { api, apps, signIn } from '../support/shell.js';

const PREFERENCES = '/api/v1/accounts/me/preferences';

/** Anna notifies Mario as the sample To do, as a frontend plugin does with context.notify. */
async function annaNotifiesMario(kind: string, title: string): Promise<number> {
  const response = await api(ANNA, '/api/v1/notifications', {
    method: 'POST',
    body: JSON.stringify({
      plugin: 'dev.mosaikit.sample.todo',
      to: [MARIO.user],
      kind,
      title,
      body: 'Anna Bianchi added it to the list.',
      link: '/app/todo',
    }),
  });
  return response.status;
}

test.describe('MK-038 Activity feed and notifications for plugins', () => {
  test.afterAll(async () => {
    await api(MARIO, PREFERENCES, {
      method: 'PUT',
      body: JSON.stringify({
        theme: null,
        appearance: null,
        language: null,
        hiddenApps: [],
        mutedNotifications: [],
      }),
    });
    await api(MARIO, '/api/v1/notifications/read', { method: 'POST', body: '{}' });
  });

  test('38.1 a notification reaches the activity feed at once and opens what it refers to', async ({
    page,
  }) => {
    await signIn(page, MARIO);
    const activity = apps(page).getByRole('link', { name: /^Activity/ });
    await expect(activity).toHaveAccessibleName('Activity');

    expect(await annaNotifiesMario('assignment', 'A task for you: call the mayor')).toBe(202);
    // Pushed on the real-time channel: no reload.
    await expect(activity).toHaveAccessibleName('Activity, 1 unread', { timeout: 3000 });

    await activity.click();
    await page.getByRole('button', { name: 'Unread: A task for you: call the mayor' }).click();
    await expect(page).toHaveURL(/\/app\/todo$/);
    await expect(page.getByRole('heading', { name: 'To do' })).toBeVisible();
    await expect(activity).toHaveAccessibleName('Activity');
  });

  test('38.2 a person who turns off a kind of notifications no longer receives it', async ({
    page,
  }) => {
    await signIn(page, MARIO);
    await page.getByRole('button', { name: /^Account:/ }).click();
    await page
      .getByRole('dialog', { name: 'Account' })
      .getByRole('link', { name: 'Settings' })
      .click();
    const kind = page.getByRole('checkbox', { name: /assignment/ });
    await expect(kind).toBeChecked();
    await kind.uncheck();
    await expect(page.getByRole('status')).toContainText('Saved');

    expect(await annaNotifiesMario('assignment', 'Another task')).toBe(202);
    expect(await annaNotifiesMario('reminder', 'Do not forget the meeting')).toBe(202);
    const feed = (await api(MARIO, '/api/v1/notifications')).body as {
      notifications: { title: string }[];
    };
    const titles = feed.notifications.map((notification) => notification.title);
    expect(titles).toContain('Do not forget the meeting');
    expect(titles).not.toContain('Another task');
  });
});
