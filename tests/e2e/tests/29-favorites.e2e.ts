// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: C
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, ANNA, MARIO, ORGANIZATION } from '../support/env.js';
import { api, openApp, signIn, unique } from '../support/shell.js';

const APPS = `/api/v1/organizations/${ORGANIZATION.slug}/apps`;
const MEMOS = '/api/v1/ext/fixture-notes/memos';
const NOTES = 'dev.mosaikit.fixture.notes';

/** Turns the app of Notes off in the organization, or every app back to the defaults. */
async function notes(on: boolean): Promise<void> {
  const changed = await api(ADMIN, APPS, {
    method: 'PUT',
    body: JSON.stringify(
      on ? [] : [{ extensionId: NOTES, appId: 'notes', enabled: false, pinned: false, roles: [] }],
    ),
  });
  expect(changed.status).toBe(200);
}

/** Opens the favorites of the person from the menu of their account. */
async function openFavorites(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Account:/ }).click();
  await page
    .getByRole('dialog', { name: 'Account' })
    .getByRole('link', { name: 'Favorites', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Favorites', exact: true })).toBeVisible();
}

/** The button that opens a favorite: its title, then the app it comes from. */
const opener = (page: Page, title: string) =>
  page
    .getByRole('list', { name: 'Favorites', exact: true })
    .getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });

test.describe('MK-094 Favorites across extensions', () => {
  test.afterAll(async () => {
    await notes(true);
  });

  test('94.1, 94.2 a memo marked as favorite is in the list of favorites and opens in Notes', async ({
    page,
  }) => {
    const text = unique('Favorite memo');
    await signIn(page, MARIO);
    await openApp(page, 'Notes');
    await page.getByLabel('New memo', { exact: true }).fill(text);
    await page.getByRole('button', { name: 'Add memo', exact: true }).click();
    const star = page.getByRole('button', { name: `Favorite ${text}`, exact: true });
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');

    await openFavorites(page);
    await opener(page, text).click();
    await expect(page).toHaveURL(/\/app\/notes\?memo=/);
    const memo = ((await api(MARIO, MEMOS)).body as { id: string; text: string }[]).find(
      (found) => found.text === text,
    );
    expect(page.url()).toContain(`memo=${memo?.id ?? 'missing'}`);
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: text })
        .and(page.locator('[aria-current="true"]')),
    ).toBeVisible();

    // While Notes is off, the favorite shows the placeholder of the kernel; back on, it opens again.
    await notes(false);
    await openFavorites(page);
    await expect(page.getByRole('note')).toContainText(`Not available: ${text}`);
    await notes(true);
    await expect(opener(page, text)).toBeVisible();
    await expect(page.getByRole('note')).toHaveCount(0);

    // Removed from the favorites.
    await page.getByRole('button', { name: `Remove ${text} from favorites`, exact: true }).click();
    await expect(opener(page, text)).toHaveCount(0);
  });

  test('94.3 a favorite the person can no longer open leaves the list', async ({ page }) => {
    const text = unique('Shared memo');
    const created = await api(MARIO, MEMOS, { method: 'POST', body: JSON.stringify({ text }) });
    expect(created.status).toBe(201);
    const memo = (created.body as { id: string }).id;
    const granted = await api(MARIO, `/api/v1/sharing/resources/${NOTES}/memo/${memo}/grants`, {
      method: 'PUT',
      body: JSON.stringify({ subject: { kind: 'person', email: ANNA.user }, level: 'view' }),
    });
    expect(granted.status).toBe(200);
    const marked = await api(ANNA, `/api/v1/favorites/${NOTES}/memo/${memo}`, { method: 'PUT' });
    expect(marked.status).toBe(200);

    await signIn(page, ANNA);
    await openFavorites(page);
    await expect(opener(page, text)).toBeVisible();

    const revoked = await api(
      MARIO,
      `/api/v1/sharing/grants/${(granted.body as { id: string }).id}`,
      {
        method: 'DELETE',
      },
    );
    expect(revoked.status).toBe(204);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Favorites', exact: true })).toBeVisible();
    await expect(opener(page, text)).toHaveCount(0);
  });
});
