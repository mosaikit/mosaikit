// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: C
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, BASE_URL, MARIO, ORGANIZATION } from '../support/env.js';
import { api, apps, signIn, unique } from '../support/shell.js';

/** The memos of the fixture Notes, which it shares through the kernel (MK-055). */
const MEMOS = '/api/v1/ext/fixture-notes/memos';
const MEMO_TYPE = 'dev.mosaikit.fixture.notes/memo';
const SITES = `/api/v1/organizations/${ORGANIZATION.slug}/embed-sites`;

/** A site that the organization lists, and one that it does not: both are pages of the test. */
const LISTED = 'http://news.example.org';
const OTHER = 'http://elsewhere.example.org';

/** The address of an embedded view of the organization of the tests. */
const embed = (path: string): string => `${BASE_URL}/embed/${ORGANIZATION.slug}${path}`;

/** Writes a memo as Mario; answers its identifier. */
async function memo(text: string): Promise<string> {
  const created = await api(MARIO, MEMOS, { method: 'POST', body: JSON.stringify({ text }) });
  expect(created.status).toBe(201);
  return (created.body as { id: string }).id;
}

/** A page of another site, with what its frame asked the installation. */
interface Framing {
  readonly page: Page;
  readonly requests: string[];
}

/**
 * A page of another site that frames one address of the installation: the browser asks the
 * installation for the address, and shows it in the frame only when the installation lets that site
 * frame it.
 */
async function framedOn(browser: Browser, site: string, address: string): Promise<Framing> {
  const context = await browser.newContext();
  await context.route(`${site}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>News</title></head><body>
        <h1>Local news</h1>
        <iframe title="Embedded view" src="${address}" width="800" height="600"></iframe>
        </body></html>`,
    }),
  );
  const page = await context.newPage();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const answered = page.waitForResponse((response) => response.url() === address);
  await page.goto(`${site}/page.html`);
  // The frame asks the installation; a refused frame may report no answer of its own.
  await Promise.race([answered, page.waitForTimeout(10_000)]);
  return { page, requests };
}

/** The frame refused: after a while, the shell in it never asked the kernel for anything. */
async function refused(framing: Framing, element: string): Promise<void> {
  await framing.page.waitForTimeout(5_000);
  expect(framing.requests.filter((url) => url.startsWith(`${BASE_URL}/api/`))).toEqual([]);
  await expect(
    framing.page.frameLocator('iframe[title="Embedded view"]').locator(element),
  ).toHaveCount(0);
}

test.describe('MK-100 Embed an extension view in a page of another site', () => {
  test.beforeAll(async () => {
    const listed = await api(ADMIN, SITES, {
      method: 'POST',
      body: JSON.stringify({ origin: LISTED }),
    });
    expect([201, 409]).toContain(listed.status);
  });

  test.afterAll(async () => {
    await api(ADMIN, `${SITES}?origin=${encodeURIComponent(LISTED)}`, { method: 'DELETE' });
  });

  test('100.1 a view of an app opened in embed mode shows no app bar and no top bar', async ({
    page,
  }) => {
    await signIn(page, MARIO);
    // The console has them.
    await expect(apps(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Account:/ })).toBeVisible();

    await page.goto(embed('/app/notes'));
    await expect(page.getByLabel('New memo', { exact: true })).toBeVisible();
    await expect(apps(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Account:/ })).toHaveCount(0);
    await expect(page.locator('header.top')).toHaveCount(0);
  });

  test('100.2 an iframe on a listed site loads the view, and on any other site the browser refuses it', async ({
    browser,
  }) => {
    const text = unique('Orari della biblioteca');
    const id = await memo(text);
    const shared = await api(MARIO, `/api/v1/sharing/resources/${MEMO_TYPE}/${id}/grants`, {
      method: 'PUT',
      body: JSON.stringify({ subject: { kind: 'public' }, level: 'view' }),
    });
    expect(shared.status).toBe(200);
    const address = embed(`/public/dev.mosaikit.fixture.notes/memo/${id}`);

    // The header that the browser enforces: the installation and the listed site only.
    const policy = (await fetch(address)).headers.get('content-security-policy') ?? '';
    expect(policy).toContain(`frame-ancestors 'self' ${LISTED}`);

    // On the listed site the frame shows the memo.
    const listed = await framedOn(browser, LISTED, address);
    const view = listed.page
      .frameLocator('iframe[title="Embedded view"]')
      .locator('mk-fixture-memo');
    await expect(view.getByText(text, { exact: true })).toBeVisible();
    await expect(view.getByText('Level: view', { exact: true })).toBeVisible();
    await listed.page.context().close();

    // On another site the browser refuses it.
    const other = await framedOn(browser, OTHER, address);
    await refused(other, 'mk-fixture-memo');
    await other.page.context().close();

    // The console is framed by no site, not even a listed one.
    const shell = await framedOn(browser, LISTED, `${BASE_URL}/`);
    await refused(shell, 'mk-sign-in');
    await shell.page.context().close();
  });

  test('100.3 a view shared with the public opens without sign-in, and one not shared does not', async ({
    browser,
  }) => {
    const hidden = unique('Bozza riservata');
    const id = await memo(hidden);

    // Not shared with the public: the frame says so and offers to sign in, in a tab of its own.
    const notShared = await framedOn(
      browser,
      LISTED,
      embed(`/public/dev.mosaikit.fixture.notes/memo/${id}`),
    );
    const frame = notShared.page.frameLocator('iframe[title="Embedded view"]');
    await expect(frame.getByText('This view is not shared with the public.')).toBeVisible();
    await expect(frame.getByRole('link', { name: /^Sign in to .+ to open it$/ })).toHaveAttribute(
      'target',
      '_blank',
    );
    await expect(frame.getByText(hidden)).toHaveCount(0);
    await notShared.page.context().close();

    // The view of an app needs an account: the frame offers to sign in, never a sign-in form.
    const app = await framedOn(browser, LISTED, embed('/app/notes'));
    const appFrame = app.page.frameLocator('iframe[title="Embedded view"]');
    await expect(appFrame.getByText('Sign in to see this view.')).toBeVisible();
    await expect(appFrame.getByRole('link', { name: /^Open it in / })).toHaveAttribute(
      'href',
      '/app/notes',
    );
    await expect(appFrame.getByLabel('Password', { exact: true })).toHaveCount(0);
    await app.page.context().close();

    // A link of the organization opens the memo without an account too.
    const link = await api(MARIO, `/api/v1/sharing/resources/${MEMO_TYPE}/${id}/links`, {
      method: 'POST',
      body: JSON.stringify({
        level: 'view',
        expires: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(link.status).toBe(201);
    const token = (link.body as { token: string }).token;
    const byLink = await framedOn(browser, LISTED, embed(`/shared/${token}`));
    await expect(
      byLink.page
        .frameLocator('iframe[title="Embedded view"]')
        .locator('mk-fixture-memo')
        .getByText(hidden, { exact: true }),
    ).toBeVisible();
    await byLink.page.context().close();
  });
});
