// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: B
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BASE_URL, MARIO } from '../support/env.js';
import { signIn } from '../support/shell.js';

/** A user agent no other test uses, so that its session is found in the list. */
const OTHER_BROWSER = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Account:/ }).click();
  await page
    .getByRole('dialog', { name: 'Account' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page.getByRole('heading', { name: 'Your settings' })).toBeVisible();
}

test.describe('MK-125 Sign-out and administrators end sessions on the server', () => {
  test('125.3 a person sees their sessions in the settings and ends another one', async ({
    browser,
    page,
  }) => {
    const other = await browser.newContext({ userAgent: OTHER_BROWSER });
    const away = await other.newPage();
    await signIn(away, MARIO);
    const stolen = (await other.cookies()).find((cookie) => cookie.name === 'mosaikit-session');
    expect(stolen).toBeDefined();

    await signIn(page, MARIO);
    await openSettings(page);
    const sessions = page.getByRole('list', { name: 'Sessions' });
    await expect(sessions.getByRole('listitem').filter({ hasText: 'This browser' })).toHaveCount(1);
    const awaySession = sessions.getByRole('listitem').filter({ hasText: 'Firefox on Linux' });
    await expect(awaySession).toHaveCount(1);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

    await awaySession.getByRole('button', { name: 'End session' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Session ended' })).toBeVisible();
    await expect(awaySession).toHaveCount(0);

    // The other browser is signed out at its next request, and a copy of its cookie opens nothing.
    await away.reload();
    await expect(away.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    const replayed = await fetch(`${BASE_URL}/api/v1/accounts/me`, {
      headers: { cookie: `mosaikit-session=${stolen?.value ?? ''}` },
    });
    expect(replayed.status).toBe(401);
    await other.close();
  });
});
