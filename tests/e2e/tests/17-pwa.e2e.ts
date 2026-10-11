// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test } from '@playwright/test';
import { MARIO } from '../support/env.js';
import { signIn } from '../support/shell.js';

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
}

test.describe('MK-029 Installable progressive web app', () => {
  test('29.1 the shell is installable: a manifest with icons, and a service worker', async ({
    page,
    request,
  }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.headers()['content-type']).toContain('application/manifest+json');
    const manifest = (await response.json()) as Manifest;
    // What the browsers ask for to offer the installation.
    expect(manifest).toMatchObject({ name: 'Mosaikit', start_url: '/', display: 'standalone' });
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    for (const size of ['192x192', '512x512']) {
      const icon = manifest.icons.find(
        (candidate) => candidate.sizes === size && candidate.purpose === 'any',
      );
      expect(icon?.type).toBe('image/png');
      const image = await request.get(icon?.src ?? '');
      expect(image.status()).toBe(200);
      expect(image.headers()['content-type']).toBe('image/png');
    }
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

    await page.goto('/');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    const active = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.active?.scriptURL ?? '';
    });
    expect(active).toMatch(/\/sw\.js$/);
    const worker = await request.get('/sw.js');
    expect(worker.headers()['cache-control']).toBe('no-cache');
  });

  test('29.2 without network the app opens and says that it is offline', async ({
    page,
    context,
  }) => {
    await signIn(page, MARIO);
    await page.evaluate(() => navigator.serviceWorker.ready);
    // A second load puts the page under the service worker and its files in the cache.
    await page.reload();
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);

    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByRole('status').filter({ hasText: 'You are offline' })).toBeVisible();
      // The shell, not an error page of the browser.
      await expect(page.locator('mk-shell')).toHaveCount(1);
    } finally {
      await context.setOffline(false);
    }
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'You are offline' })).toHaveCount(0);
  });
});
