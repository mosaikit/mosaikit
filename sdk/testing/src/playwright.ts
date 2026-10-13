// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, type Locator, type Page } from '@playwright/test';
import { basic, fromEnvironment, type Person } from './bench.js';
import type { Settings } from './installation.js';

/** Helpers for Playwright tests on the bench that the global setup started. */

/** The administrator, the organization and the people of the bench. */
export function bench(): ReturnType<typeof fromEnvironment> {
  return fromEnvironment();
}

/** A person of the organization of the bench: the first one by default. */
export function member(index = 0): Person {
  const person = bench().people[index];
  if (!person) {
    throw new Error(`The bench has no person ${String(index)}`);
  }
  return person;
}

/**
 * Signs in on the sign-in form of the shell with a local password, in English or in Italian: the
 * page follows the language of the browser.
 */
export async function signIn(page: Page, person: Person = bench().admin): Promise<void> {
  await page.goto(bench().baseUrl + '/');
  await page
    .getByRole('button', { name: /^(Sign in with a password|Accedi con una password)$/ })
    .click();
  await page.getByLabel(/Email or username|Email o nome utente/).fill(person.user);
  await page.getByLabel('Password', { exact: true }).fill(person.password);
  await page.getByRole('button', { name: /^(Sign in|Accedi)$/ }).click();
  await expect(page.getByRole('heading', { name: /^(Welcome|Benvenuto)/ })).toBeVisible();
}

/** The app bar, called Apps, or App in Italian. */
export const apps = (page: Page): Locator => page.getByRole('navigation', { name: /^(Apps|App)$/ });

/** Opens an app from the app bar. */
export async function openApp(page: Page, name: string): Promise<void> {
  await apps(page).getByRole('link', { name, exact: true }).click();
}

/** Calls the API of the kernel as a person, in the organization of the bench or in another one. */
export async function api(
  person: Person,
  path: string,
  init: RequestInit = {},
  organization: string = bench().organization.slug,
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers(init.headers);
  headers.set('authorization', basic(person));
  headers.set('X-Mosaikit-Organization', organization);
  headers.set('content-type', headers.get('content-type') ?? 'application/json');
  const response = await fetch(bench().baseUrl + path, { ...init, headers });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // not JSON
  }
  return { status: response.status, body };
}

/**
 * Restarts the installation of the bench, with other settings when given, and returns the log of
 * the restart. Needs a bench started with a control port.
 */
export async function restart(settings?: Settings): Promise<string> {
  const { controlUrl } = bench();
  if (!controlUrl) {
    throw new Error('The bench was started without a control port');
  }
  const response = await fetch(`${controlUrl}/restart`, {
    method: 'POST',
    body: JSON.stringify(settings ? { settings } : {}),
  });
  const log = await response.text();
  if (!response.ok) {
    throw new Error(`Restart failed: ${log}`);
  }
  return log;
}

/** A title that no other run of the tests used. */
export const unique = (prefix: string): string => `${prefix} ${Date.now().toString(36)}`;
