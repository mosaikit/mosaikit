// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: C
import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from '../support/env.js';
import { apps, openApp, signIn } from '../support/shell.js';

/** The state of the fixture Hello, which keeps the folder opened in the address (MK-099). */
const state = (page: Page, value: string) =>
  page.getByText(`Address state: ${value}`, { exact: true });

test.describe('MK-099 Extension state in the address of the page', () => {
  test('a state written by an extension opens the same view in another browser, after sign-in', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    await openApp(page, 'Hello');
    await expect(state(page, '(none)')).toBeVisible();

    await page.getByRole('button', { name: 'Open folder Beta', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/hello\/folders\/beta$/);
    const address = page.url();

    // Another browser, where nobody is signed in, opens the copied address.
    const other = await browser.newContext();
    const visitor = await other.newPage();
    await visitor.goto(address);
    await visitor.getByRole('button', { name: 'Sign in with a password' }).click();
    await visitor.getByLabel('Email or username').fill(ADMIN.user);
    await visitor.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await visitor.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(state(visitor, '/folders/beta')).toBeVisible();
    await expect(visitor).toHaveURL(address);
    // The app bar marks the app of the address as the current page.
    await expect(apps(visitor).getByRole('link', { name: 'Hello', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await other.close();
  });

  test('the back and forward buttons move between the states written by the extension', async ({
    page,
  }) => {
    await signIn(page);
    await openApp(page, 'Hello');
    await page.getByRole('button', { name: 'Open folder Alpha', exact: true }).click();
    await expect(state(page, '/folders/alpha')).toBeVisible();
    await page.getByRole('button', { name: 'Open folder Beta', exact: true }).click();
    await expect(state(page, '/folders/beta')).toBeVisible();

    await page.goBack();
    await expect(state(page, '/folders/alpha')).toBeVisible();
    await expect(page).toHaveURL(/\/app\/hello\/folders\/alpha$/);
    await page.goBack();
    await expect(state(page, '(none)')).toBeVisible();
    await expect(page).toHaveURL(/\/app\/hello$/);
    await page.goForward();
    await expect(state(page, '/folders/alpha')).toBeVisible();
    await page.goForward();
    await expect(state(page, '/folders/beta')).toBeVisible();
  });
});
