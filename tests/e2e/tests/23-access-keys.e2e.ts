// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BASE_URL, MARIO, ORGANIZATION } from '../support/env.js';
import { api, signIn } from '../support/shell.js';

const KEYS = '/api/v1/accounts/me/access-keys';

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Account:/ }).click();
  await page
    .getByRole('dialog', { name: 'Account' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page.getByRole('heading', { name: 'Your settings' })).toBeVisible();
}

/** A call made with an access key, as a script would. */
async function withKey(key: string, path: string, init: RequestInit = {}): Promise<number> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${key}`);
  headers.set('content-type', 'application/json');
  const response = await fetch(BASE_URL + path, { ...init, headers });
  await response.arrayBuffer();
  return response.status;
}

/** A key created by Mario through the API. */
async function createKey(name: string, write: boolean): Promise<{ id: string; secret: string }> {
  const created = await api(MARIO, KEYS, {
    method: 'POST',
    body: JSON.stringify({ name, organization: ORGANIZATION.slug, write }),
  });
  expect(created.status).toBe(201);
  return created.body as { id: string; secret: string };
}

test.describe('MK-060 Personal access keys for scripts and external clients', () => {
  test('60.1 a person creates a key, sees its secret once and finds it in the list', async ({
    context,
    page,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
    await signIn(page, MARIO);
    await openSettings(page);

    const form = page.getByRole('form', { name: 'New access key' });
    await form.getByLabel('Name').fill('E2E nightly export');
    await expect(form.getByLabel('Organization')).toHaveValue(ORGANIZATION.slug);
    await form.getByRole('button', { name: 'Create key' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Key created' })).toBeVisible();

    const secretBox = page.getByRole('textbox', { name: 'The new access key' });
    const secret = await secretBox.inputValue();
    expect(secret).toMatch(/^mk_/);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Key copied.' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(secretBox).toHaveCount(0);

    const keys = page.getByRole('list', { name: 'Access keys' });
    const item = keys.getByRole('listitem').filter({ hasText: 'E2E nightly export' });
    await expect(item).toContainText(secret.slice(0, 11));
    await expect(item).toContainText('Read only');
    await expect(item).toContainText('last used never');
    expect(await item.textContent()).not.toContain(secret);

    // The key works for a script, and its use shows in the list.
    expect(await withKey(secret, '/api/v1/accounts/me')).toBe(200);
    await page.reload();
    await openSettings(page);
    await expect(
      page
        .getByRole('list', { name: 'Access keys' })
        .getByRole('listitem')
        .filter({ hasText: 'E2E nightly export' }),
    ).not.toContainText('last used never');
  });

  test('60.2 a revoked key is refused at once while the session goes on', async ({ page }) => {
    const key = await createKey('E2E to revoke', false);
    expect(await withKey(key.secret, '/api/v1/accounts/me')).toBe(200);

    await signIn(page, MARIO);
    await openSettings(page);
    const item = page
      .getByRole('list', { name: 'Access keys' })
      .getByRole('listitem')
      .filter({ hasText: 'E2E to revoke' });
    await item.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Key revoked' })).toBeVisible();
    await expect(item).toHaveCount(0);

    expect(await withKey(key.secret, '/api/v1/accounts/me')).toBe(401);
    // The session of the browser goes on.
    await page.reload();
    await expect(page.getByRole('button', { name: /^Account:/ })).toBeVisible();
  });

  test('60.3 a key without the write switch only reads, on the kernel and on extensions', async () => {
    const reader = await createKey('E2E reader', false);
    expect(await withKey(reader.secret, '/api/v1/ext/fixture-notes/notes')).toBe(200);
    expect(
      await withKey(reader.secret, '/api/v1/ext/fixture-notes/notes', {
        method: 'POST',
        body: JSON.stringify({ text: 'Written with a read-only key' }),
      }),
    ).toBe(403);
    expect(await withKey(reader.secret, '/api/v1/notifications/read', { method: 'POST' })).toBe(
      403,
    );

    const writer = await createKey('E2E writer', true);
    expect(
      await withKey(writer.secret, '/api/v1/ext/fixture-notes/notes', {
        method: 'POST',
        body: JSON.stringify({ text: 'Written with an access key' }),
      }),
    ).toBe(201);
    // No key manages keys.
    expect(await withKey(writer.secret, KEYS)).toBe(403);
  });
});
