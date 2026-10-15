// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: B
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, ANNA, MARIO, ORGANIZATION } from '../support/env.js';
import { api, openApp, signIn } from '../support/shell.js';

const MEMBER = `/api/v1/organizations/${ORGANIZATION.slug}/members/${ANNA.user}`;
const BRANDING = `/api/v1/organizations/${ORGANIZATION.slug}/branding`;
const LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#0a7a55"/></svg>',
);

/** A token of the theme as the page applies it. */
function token(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );
}

test.describe('MK-074 Branding per organization, with a live editor of the theme tokens', () => {
  test.beforeAll(async () => {
    await api(ADMIN, MEMBER, {
      method: 'PUT',
      body: JSON.stringify({ roles: ['organization-admin', 'organization-user'] }),
    });
  });

  test.afterAll(async () => {
    await api(ANNA, BRANDING, { method: 'PUT', body: JSON.stringify({}) });
    await api(ANNA, `${BRANDING}/images/logo`, { method: 'DELETE' });
    await api(ADMIN, MEMBER, {
      method: 'PUT',
      body: JSON.stringify({ roles: ['organization-user'] }),
    });
  });

  test('74.1–74.3 an administrator previews and saves the branding; members and the sign-in page show it', async ({
    page,
    browser,
  }) => {
    // No other member changes it.
    const refused = await api(MARIO, BRANDING, {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'Not mine' }),
    });
    expect(refused.status).toBe(403);

    await signIn(page, ANNA);
    await openApp(page, 'Branding');
    await expect(page.getByRole('heading', { name: 'Branding', exact: true })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

    // A change of a token shows on the open application before it is saved, for this page only.
    await page.getByLabel('Surface, Light scheme', { exact: true }).fill('#fdf6e3');
    await expect.poll(() => token(page, '--mk-surface')).toBe('#fdf6e3');
    const unsaved = await api(MARIO, BRANDING);
    expect((unsaved.body as { light: Record<string, string> }).light).toEqual({});

    await page.getByLabel('Display name', { exact: true }).fill('Comune Branded');
    await page.getByLabel('Accent color', { exact: true }).fill('#0a7a55');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Saved');
    await page
      .getByLabel('Logo for light backgrounds', { exact: true })
      .setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: LOGO });
    await expect(page.getByRole('status')).toContainText('Image saved');
    await expect(page.getByRole('img', { name: 'Logo for light backgrounds' })).toBeVisible();

    // A member sees the name and the colors of the organization after sign-in.
    const mario = await (await browser.newContext()).newPage();
    await signIn(mario, MARIO);
    await expect(mario.locator('mk-shell header .name')).toHaveText('Comune Branded');
    await expect(mario).toHaveTitle('Comune Branded');
    await expect.poll(() => token(mario, '--mk-surface')).toBe('#fdf6e3');
    await expect.poll(() => token(mario, '--mk-accent')).toBe('#0a7a55');

    // The sign-in page of the organization shows its name and its logo before sign-in.
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(`/?organization=${ORGANIZATION.slug}`);
    await expect(visitor).toHaveTitle('Comune Branded');
    await expect(visitor.locator('mk-sign-in .brand img.logo')).toHaveAttribute(
      'src',
      /\/branding\/images\/logo\?v=/,
    );
    // Without the organization in the address, the sign-in page of the installation.
    const other = await (await browser.newContext()).newPage();
    await other.goto('/');
    await expect(other.locator('mk-sign-in .brand img.logo')).toHaveCount(0);
  });
});
