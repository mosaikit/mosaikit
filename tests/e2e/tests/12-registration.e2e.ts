// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ORGANIZATION } from '../support/env.js';
import { confirmationLink, mailsTo } from '../support/mail.js';
import { openApp, signIn, signOut } from '../support/shell.js';

const PASSWORD = 'Registrata-2026-sicura';

async function openRegistration(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
}

async function register(page: Page, email: string): Promise<void> {
  await openRegistration(page);
  await page.getByLabel('Your name').fill('Luigi Verdi');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
}

async function signInWithPassword(page: Page, email: string): Promise<void> {
  // After the link of the mail the page asks for the password at once.
  const toPassword = page.getByRole('button', { name: 'Sign in with a password' });
  if (await toPassword.isVisible()) {
    await toPassword.click();
  }
  await page.getByLabel('Email or username').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.describe('MK-048 Local registration confirmed by mail', () => {
  test('48.1 a person registers, confirms the address from the mail, then signs in', async ({
    page,
  }) => {
    const email = `luigi.verdi.${Date.now().toString(36)}@comune.test`;
    await register(page, email);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);

    // Before the confirmation the account does not sign in.
    await page.getByRole('button', { name: 'Back to sign in' }).click();
    await signInWithPassword(page, email);
    await expect(page.getByRole('alert')).toContainText('not confirmed yet');

    const first = await confirmationLink(email);
    await page.goto(first);
    await expect(page.getByRole('status')).toContainText('Your email address is confirmed');
    expect(new URL(page.url()).search).toBe('');
    await signInWithPassword(page, email);
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome, Luigi Verdi' })).toBeVisible();

    // A link works once.
    await signOut(page);
    await page.goto(first);
    await expect(page.getByRole('alert')).toContainText('does not work any more');
    expect(mailsTo(email)[0]?.subject).toBe('Confirm your email address');
  });

  test('48.2 the confirmation link can be sent again', async ({ page }) => {
    const email = `maria.neri.${Date.now().toString(36)}@comune.test`;
    await register(page, email);
    const first = await confirmationLink(email);
    await page.getByRole('button', { name: 'Send the link again' }).click();
    await expect(page.getByRole('status')).toContainText('We sent a new link');
    const second = await confirmationLink(email, 1);
    expect(second).not.toBe(first);

    await page.goto(first);
    await expect(page.getByRole('alert')).toContainText('does not work any more');
    await page.goto(second);
    await expect(page.getByRole('status')).toContainText('confirmed');
  });

  test('48.3 the platform administrator turns registration off and on', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    await openApp(page, 'Platform');
    const toggle = page.getByRole('switch', { name: 'People can create their own account' });
    await expect(toggle).toBeChecked();
    try {
      await toggle.uncheck();
      await expect(page.getByRole('status')).toContainText('Self-registration is off');

      const visitor = await (await browser.newContext()).newPage();
      await visitor.goto('/');
      await expect(visitor.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expect(visitor.getByRole('button', { name: 'Create an account' })).toHaveCount(0);
      const refused = await visitor.request.post('/api/v1/accounts/registrations', {
        data: {
          organization: ORGANIZATION.slug,
          email: 'blocked@comune.test',
          displayName: 'Blocked',
          password: PASSWORD,
        },
      });
      expect(refused.status()).toBe(403);
    } finally {
      await toggle.check();
      await expect(page.getByRole('status')).toContainText('People can create their own account');
    }
  });
});
