// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: B
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, ANNA, ORGANIZATION } from '../support/env.js';
import { mailsTo } from '../support/mail.js';
import { api, openApp, signIn, signOut } from '../support/shell.js';

const MEMBER = `/api/v1/organizations/${ORGANIZATION.slug}/members/${ANNA.user}`;
const PASSWORD = 'Creata-2026-sicura';

/** The latest link to set the password mailed to an address, waiting for it to arrive. */
async function passwordLink(address: string, after = 0): Promise<string> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const received = mailsTo(address);
    const latest = received.length > after ? received.at(-1) : undefined;
    const link = latest ? /https?:\/\/\S+\?set-password=[\w-]+/.exec(latest.raw)?.[0] : undefined;
    if (link) {
      return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No mail with a link to set the password for ${address}`);
}

async function signInWithPassword(page: Page, email: string): Promise<void> {
  const toPassword = page.getByRole('button', { name: 'Sign in with a password' });
  if (await toPassword.isVisible()) {
    await toPassword.click();
  }
  await page.getByLabel('Email or username').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.describe('MK-048 Accounts created by an administrator, with a link to set the password', () => {
  test.beforeAll(async () => {
    // Anna administers the organization.
    await api(ADMIN, MEMBER, {
      method: 'PUT',
      body: JSON.stringify({ roles: ['organization-admin', 'organization-user'] }),
    });
  });

  test.afterAll(async () => {
    await api(ADMIN, MEMBER, {
      method: 'PUT',
      body: JSON.stringify({ roles: ['organization-user'] }),
    });
  });

  test('48.5 an administrator creates an account, the person sets the password from the mail and signs in', async ({
    page,
  }) => {
    const email = `piero.blu.${Date.now().toString(36)}@comune.test`;
    await signIn(page, ANNA);
    await openApp(page, 'Permissions');
    await page.getByRole('tab', { name: 'People' }).click();

    await page.getByRole('button', { name: 'Create an account' }).click();
    const form = page.getByRole('dialog', { name: 'Create an account' });
    await form.getByRole('textbox', { name: 'Name of the person' }).fill('Piero Blu');
    await form.getByRole('textbox', { name: 'Email address' }).fill(email);
    await form.getByRole('combobox', { name: 'Role in the organization' }).selectOption({
      label: 'Member',
    });
    await form.getByRole('button', { name: 'Create account' }).click();

    // The bench sends mail: the link goes to the person, not to the page.
    const result = page.getByRole('dialog', { name: 'Link to set the password' });
    await expect(result).toContainText(`We mailed ${email} a link`);
    await expect(result.getByRole('button', { name: 'Copy the link' })).toHaveCount(0);
    const first = await passwordLink(email);
    await result.getByRole('button', { name: 'Done' }).click();
    await expect(result).toBeHidden();

    // Until the password is set, the page of the person offers a new link, which replaces the first.
    await expect(page.getByText('Has not chosen a password yet.')).toBeVisible();
    await page.getByRole('button', { name: 'New link to set the password' }).click();
    await expect(result).toContainText(`We mailed ${email} a link`);
    const second = await passwordLink(email, 1);
    expect(second).not.toBe(first);
    await result.getByRole('button', { name: 'Done' }).click();
    await signOut(page);

    // Before the password is set, the account does not sign in.
    await signInWithPassword(page, email);
    await expect(page.getByRole('alert')).toBeVisible();

    await page.goto(first);
    await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Set the password' }).click();
    await expect(page.getByRole('alert')).toContainText('does not work any more');

    await page.goto(second);
    await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Set the password' }).click();
    await expect(page.getByRole('status')).toContainText('Your password is set');
    await signInWithPassword(page, email);
    await expect(page.getByRole('heading', { name: 'Welcome, Piero Blu' })).toBeVisible();

    // The link works once.
    await signOut(page);
    await page.goto(second);
    await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Set the password' }).click();
    await expect(page.getByRole('alert')).toContainText('does not work any more');
  });
});
