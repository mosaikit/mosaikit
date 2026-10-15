// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: C
import { expect, test } from '@playwright/test';
import { ADMIN, ANNA, MARIO, ORGANIZATION } from '../support/env.js';
import { api, openApp, signIn, unique } from '../support/shell.js';

const APPS = `/api/v1/organizations/${ORGANIZATION.slug}/apps`;
const MEMBER = `/api/v1/organizations/${ORGANIZATION.slug}/members/${ANNA.user}`;
const MEMOS = '/api/v1/ext/fixture-notes/memos';

/** Turns the app of Notes off in the organization, or every app back to the defaults. */
async function notes(on: boolean): Promise<void> {
  const changed = await api(ADMIN, APPS, {
    method: 'PUT',
    body: JSON.stringify(
      on
        ? []
        : [
            {
              extensionId: 'dev.mosaikit.fixture.notes',
              appId: 'notes',
              enabled: false,
              pinned: false,
              roles: [],
            },
          ],
    ),
  });
  expect(changed.status).toBe(200);
}

test.describe('MK-135 References between resources of different extensions degrade gracefully when one is absent', () => {
  test.beforeAll(async () => {
    await api(ADMIN, MEMBER, {
      method: 'PUT',
      body: JSON.stringify({ roles: ['organization-admin', 'organization-user'] }),
    });
  });

  test.afterAll(async () => {
    await notes(true);
    await api(ADMIN, MEMBER, {
      method: 'PUT',
      body: JSON.stringify({ roles: ['organization-user'] }),
    });
  });

  test('135.1 a placeholder while the extension is off, the resource again without a reload', async ({
    page,
    browser,
  }) => {
    const text = unique('Pinned memo');
    const created = await api(MARIO, MEMOS, { method: 'POST', body: JSON.stringify({ text }) });
    expect(created.status).toBe(201);
    const memo = (created.body as { id: string }).id;

    // Hello keeps a reference to the memo of Notes, and shows it.
    await signIn(page, MARIO);
    await page.evaluate((id) => localStorage.setItem('fixture.hello.memo', id), memo);
    await openApp(page, 'Hello');
    const pinned = page.getByRole('region', { name: 'Pinned memo' });
    await expect(pinned.getByText(text, { exact: true })).toBeVisible();
    const anna = await (await browser.newContext()).newPage();
    await signIn(anna, ANNA);
    await anna.evaluate((id) => localStorage.setItem('fixture.hello.memo', id), memo);
    await openApp(anna, 'Hello');
    await expect(anna.getByRole('region', { name: 'Pinned memo' }).getByText(text)).toBeVisible();

    // Notes turned off: the open pages show the placeholder, and only administrators what to do.
    await notes(false);
    const note = pinned.getByRole('note');
    await expect(note).toContainText('Not available: Pinned memo');
    await expect(note).toContainText(
      'The extension that provides it is not active in this organization.',
    );
    await expect(note).not.toContainText('Turn on');
    await expect(pinned.getByText(text, { exact: true })).toHaveCount(0);
    await expect(anna.getByRole('region', { name: 'Pinned memo' }).getByRole('note')).toContainText(
      'Turn on the extension Notes (fixture) (dev.mosaikit.fixture.notes) in the apps of the organization.',
    );
    // The rest of Hello works.
    await page.getByRole('button', { name: 'Publish an event' }).click();
    await expect(page.getByText('Received fixture.hello.greeted', { exact: false })).toBeVisible();

    // Back on: the memo again, in the same pages, with nothing to repair.
    await notes(true);
    await expect(pinned.getByText(text, { exact: true })).toBeVisible();
    await expect(pinned.getByRole('note')).toHaveCount(0);
    await expect(anna.getByRole('region', { name: 'Pinned memo' }).getByText(text)).toBeVisible();
    const memos = (await api(MARIO, MEMOS)).body as { id: string; text: string }[];
    expect(memos.find((found) => found.id === memo)?.text).toBe(text);
  });
});
