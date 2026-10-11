// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { MARIO, type Person } from '../support/env.js';
import { defaultSettings } from '../support/installation.js';
import { restart, signOut } from '../support/shell.js';

const DAY = 24 * 60 * 60;

async function signInWith(page: Page, person: Person, remember: boolean): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with a password' }).click();
  await page.getByLabel('Email or username').fill(person.user);
  await page.getByLabel('Password', { exact: true }).fill(person.password);
  if (remember) {
    await page.getByLabel(/Remember me/).check();
  }
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

/** A new browser with the cookies that survive closing the old one: those with an expiry. */
async function reopened(browser: Browser, page: Page): Promise<Page> {
  const kept = (await page.context().cookies()).filter((cookie) => cookie.expires > 0);
  const context = await browser.newContext();
  await context.addCookies(kept);
  return context.newPage();
}

/** No violation of WCAG 2.1 A and AA that axe-core can find. */
async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.describe('MK-047 Sign-in page with "remember me"', () => {
  test('47.1 a remembered person is still signed in after closing the browser, until sign-out', async ({
    browser,
    page,
  }) => {
    await signInWith(page, MARIO, true);
    const cookies = await page.context().cookies();
    const remembered = cookies.find((cookie) => cookie.name === 'mosaikit-remember');
    expect(remembered).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
    expect(remembered?.expires ?? 0).toBeGreaterThan(Date.now() / 1000 + 29 * DAY);
    // The session itself ends with the browser.
    expect(cookies.find((cookie) => cookie.name === 'mosaikit-session')?.expires).toBe(-1);

    const again = await reopened(browser, page);
    await again.goto('/');
    await expect(again.getByRole('heading', { name: /Welcome/ })).toBeVisible();

    const stolen = (await again.context().cookies()).filter((cookie) => cookie.expires > 0);
    await signOut(again);
    await expect(again.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    // A copy of the cookie taken before the sign-out signs nobody in.
    const thief = await browser.newContext();
    await thief.addCookies(stolen);
    const elsewhere = await thief.newPage();
    await elsewhere.goto('/');
    await expect(elsewhere.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('47.2 without "remember me" closing the browser signs the person out', async ({
    browser,
    page,
  }) => {
    await signInWith(page, MARIO, false);

    const again = await reopened(browser, page);
    await again.goto('/');
    await expect(again.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('47.3 the page is accessible and fits a phone', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Sign in with a password' }).click();
    await page.getByRole('button', { name: 'Show the password' }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await expectAccessible(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel('Email or username')).toBeInViewport();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  });

  test('47.4 the theme for public administrations, in the style of Bootstrap Italia', async ({
    page,
  }, testInfo) => {
    try {
      await restart({ ...defaultSettings(), 'mosaikit.ui.theme': 'pa' });
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-mk-theme', 'pa');
      const heading = page.getByRole('heading', { name: 'Sign in' });
      await expect(heading).toHaveCSS('font-family', /Titillium Web/);
      await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
      await testInfo.attach('sign-in-pa', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await expectAccessible(page);
    } finally {
      await restart(defaultSettings());
    }
  });
});
