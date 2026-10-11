// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, type Locator, type Page } from '@playwright/test';
import { ADMIN, BASE_URL, CONTROL_URL, ORGANIZATION, type Person } from './env.js';
import type { Settings } from './installation.js';

/**
 * Signs in on the sign-in form of the shell with a local password, in English or in Italian: the
 * page follows the language of the browser (MK-027).
 */
export async function signIn(page: Page, person: Person = ADMIN): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('button', { name: /^(Sign in with a password|Accedi con una password)$/ })
    .click();
  await page.getByLabel(/Email or username|Email o nome utente/).fill(person.user);
  await page.getByLabel('Password', { exact: true }).fill(person.password);
  await page.getByRole('button', { name: /^(Sign in|Accedi)$/ }).click();
  await expect(page.getByRole('heading', { name: /^(Welcome|Benvenuto)/ })).toBeVisible();
}

/** The app bar, called Apps, or App in Italian (MK-027). */
export const apps = (page: Page): Locator => page.getByRole('navigation', { name: /^(Apps|App)$/ });

/** Signs out from the menu of the person, in the top bar (MK-025). */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Account:/ }).click();
  await page
    .getByRole('dialog', { name: 'Account' })
    .getByRole('button', { name: 'Sign out' })
    .click();
}

export async function openApp(page: Page, name: string): Promise<void> {
  await apps(page).getByRole('link', { name, exact: true }).click();
}

/** Restarts the installation, with other settings when given; returns the log of the restart. */
export async function restart(settings?: Settings): Promise<string> {
  const response = await fetch(`${CONTROL_URL}/restart`, {
    method: 'POST',
    body: JSON.stringify(settings ? { settings } : {}),
  });
  const log = await response.text();
  if (!response.ok) {
    throw new Error(`Restart failed: ${log}`);
  }
  return log;
}

/** Calls the API of the kernel as a person, in the organization of the tests or in another one. */
export async function api(
  person: Person,
  path: string,
  init: RequestInit = {},
  organization: string = ORGANIZATION.slug,
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers(init.headers);
  headers.set(
    'authorization',
    `Basic ${Buffer.from(`${person.user}:${person.password}`).toString('base64')}`,
  );
  headers.set('X-Mosaikit-Organization', organization);
  headers.set('content-type', headers.get('content-type') ?? 'application/json');
  const response = await fetch(BASE_URL + path, { ...init, headers });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // not JSON
  }
  return { status: response.status, body };
}

export interface Activity {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
}

export async function activities(person: Person): Promise<Activity[]> {
  return (await api(person, '/api/v1/p/sample-activities/activities')).body as Activity[];
}

export async function createActivity(person: Person, title: string): Promise<Activity> {
  const { status, body } = await api(person, '/api/v1/p/sample-activities/activities', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  expect(status).toBe(201);
  return body as Activity;
}

export interface PluginStatus {
  readonly id: string;
  readonly version: string;
  readonly status: string;
  readonly problems: readonly string[];
  /** What still works but should change, such as launcher.app (MK-025). */
  readonly warnings: readonly string[];
}

export async function plugins(): Promise<PluginStatus[]> {
  const { body } = await api(ADMIN, '/api/v1/plugins');
  return Array.isArray(body)
    ? (body as PluginStatus[])
    : (body as { plugins: PluginStatus[] }).plugins;
}

/** A title that no other run of the tests used. */
export const unique = (prefix: string): string => `${prefix} ${Date.now().toString(36)}`;
