// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: C
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ADMIN, BASE_URL, MARIO, ORGANIZATION } from '../support/env.js';
import { api, openApp, signIn } from '../support/shell.js';

const IDENTITIES = '/api/v1/platform/service-identities';
const NOTES = '/api/v1/ext/fixture-notes/notes';

/** A call made with the key of a service, as a gateway would. */
async function withKey(
  key: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${key}`);
  headers.set('content-type', 'application/json');
  const response = await fetch(BASE_URL + path, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as unknown) : undefined };
}

test.describe('MK-124 Service identities for internal callers of the APIs of extensions', () => {
  test('124.1 a platform administrator creates an identity, copies its key once, rotates and revokes it', async ({
    context,
    page,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
    await signIn(page, ADMIN);
    await openApp(page, 'Service identities');
    await expect(page.getByRole('heading', { name: 'Service identities', level: 1 })).toBeVisible();

    const form = page.getByRole('form', { name: 'New service identity' });
    await form.getByLabel('Name', { exact: true }).fill('e2e-gateway');
    await form.getByLabel('Description').fill('In front of the map server');
    await form.getByLabel('APIs of extensions').fill('fixture-notes');
    await form.getByLabel('Check the access keys of people').check();
    await form.getByLabel('Organizations it may name').fill(ORGANIZATION.slug);
    await form.getByRole('button', { name: 'Create service identity' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Service identity created' }),
    ).toBeVisible();

    const secretBox = page.getByRole('textbox', { name: 'The new key of the service' });
    const secret = await secretBox.inputValue();
    expect(secret).toMatch(/^mks_/);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Key copied.' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(secretBox).toHaveCount(0);

    const identity = page
      .getByRole('list', { name: 'Service identities' })
      .getByRole('listitem')
      .filter({ hasText: 'e2e-gateway' })
      .first();
    await expect(identity).toContainText('APIs: fixture-notes');
    await expect(identity).toContainText(secret.slice(0, 12));
    expect(await identity.textContent()).not.toContain(secret);

    // The service reaches its API on the organization it names, and nothing else.
    const notes = await withKey(secret, NOTES, {
      headers: { 'X-Mosaikit-Organization': ORGANIZATION.slug },
    });
    expect(notes.status).toBe(200);
    expect((await withKey(secret, '/api/v1/accounts/me')).status).toBe(403);
    expect((await withKey(secret, '/')).status).toBe(403);

    // Rotation: a second key, then the first one revoked.
    await identity.getByRole('button', { name: 'New key' }).click();
    const fresh = await page
      .getByRole('textbox', { name: 'The new key of the service' })
      .inputValue();
    expect(fresh).toMatch(/^mks_/);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(identity.getByRole('button', { name: 'New key' })).toBeDisabled();
    await identity
      .getByRole('listitem')
      .filter({ hasText: secret.slice(0, 12) })
      .getByRole('button', { name: 'Revoke' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Key revoked' })).toBeVisible();
    expect((await withKey(secret, NOTES)).status).toBe(401);
    expect(
      (
        await withKey(fresh, NOTES, {
          headers: { 'X-Mosaikit-Organization': ORGANIZATION.slug },
        })
      ).status,
    ).toBe(200);
  });

  test('124.2 a gateway checks the access key of a person through the kernel', async () => {
    const created = await api(ADMIN, IDENTITIES, {
      method: 'POST',
      body: JSON.stringify({ name: 'e2e-checker', apis: [], endpoints: ['check-key'] }),
    });
    expect(created.status).toBe(201);
    const service = (created.body as { keys: { secret: string }[] }).keys[0]?.secret ?? '';

    const personal = await api(MARIO, '/api/v1/accounts/me/access-keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'E2E map client', organization: ORGANIZATION.slug }),
    });
    expect(personal.status).toBe(201);
    const key = (personal.body as { secret: string }).secret;

    const checked = await withKey(service, '/api/v1/services/check', {
      method: 'POST',
      body: JSON.stringify({ key }),
    });
    expect(checked.status).toBe(200);
    expect(checked.body).toMatchObject({
      kind: 'key',
      account: { username: MARIO.user },
      organization: { slug: ORGANIZATION.slug },
    });
    expect(
      (
        await withKey(service, '/api/v1/services/check', {
          method: 'POST',
          body: JSON.stringify({ session: 'not-a-session' }),
        })
      ).status,
    ).toBe(403);
  });
});
