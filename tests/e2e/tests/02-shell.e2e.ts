// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test } from '@playwright/test';
import { MARIO } from '../support/env.js';
import { openApp, signIn, signOut } from '../support/shell.js';

test.describe('MK-008 Shell with sign-in, launcher and plugin apps', () => {
  test('the way back to Home works from an app and from the Plugins page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await signIn(page);
    await openApp(page, 'Plugins');
    await expect(page.getByRole('heading', { name: 'Plugins', level: 1 })).toBeVisible();
    await openApp(page, 'Home');
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plugins', level: 1 })).toHaveCount(0);

    await openApp(page, 'Plugins');
    await openApp(page, 'Activities');
    await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible();
    await openApp(page, 'Home');
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Activities' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a reload keeps the session of a local account, in its organization', async ({ page }) => {
    await signIn(page, MARIO);
    await openApp(page, 'Activities');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in with a password' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account: Mario Rossi' })).toBeVisible();
  });

  test('the password is never kept by the page, and sign-out ends the session', async ({
    page,
    context,
  }) => {
    await signIn(page, MARIO);
    const cookie = (await context.cookies()).find((c) => c.name === 'mosaikit-session');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
    const stored = await page.evaluate(() =>
      [sessionStorage, localStorage]
        .flatMap((storage) =>
          Array.from({ length: storage.length }, (_, i) => storage.getItem(storage.key(i) ?? '')),
        )
        .join(' '),
    );
    expect(stored).not.toContain(MARIO.password);

    await signOut(page);
    await expect(page.getByRole('button', { name: 'Sign in with a password' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in with a password' })).toBeVisible();
  });

  test('a person in no organization is told why the apps have nothing to show', async ({
    page,
  }) => {
    await signIn(page);
    await expect(page.getByText('not working in an organization')).toBeVisible();
    await openApp(page, 'Activities');
    await expect(page.getByText('not working in an organization')).toBeVisible();
  });
});
