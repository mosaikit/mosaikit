// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test, type Locator, type Page } from '@playwright/test';
import { register } from '../../../sdk/testing/src/bench.js';
import { ANNA, BASE_URL, MAIL, MARIO, ORGANIZATION, type Person } from '../support/env.js';
import { api, openApp, signIn, unique } from '../support/shell.js';

/** The memos of the fixture Notes: resources that it registers with the kernel (MK-054). */
const MEMOS = '/api/v1/ext/fixture-notes/memos';
const SHARING = '/api/v1/sharing/resources/dev.mosaikit.fixture.notes/memo';

/** A person of the organization who is in no team of these tests. */
const GIULIA: Person = {
  user: 'giulia.neri@comune.test',
  password: 'Prova-2026-sicura',
  name: 'Giulia Neri',
};

interface Memo {
  readonly id: string;
  readonly text: string;
  readonly level: string | null;
}

/** Writes a memo in the Notes app and opens the sharing dialog of the kernel for it. */
async function writeAndShare(page: Page, text: string): Promise<Locator> {
  await openApp(page, 'Notes');
  await page.getByLabel('New memo', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Add memo', exact: true }).click();
  await page.getByRole('button', { name: `Share ${text}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Share ${text}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function memoOf(text: string): Promise<Memo> {
  const memos = (await api(MARIO, MEMOS)).body as Memo[];
  const memo = memos.find((found) => found.text === text);
  expect(memo).toBeDefined();
  return memo as Memo;
}

/** A day as the value of a date field, some days from now. */
function inDays(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test.describe('MK-055 Share a resource with people, groups, the organization, a link or the public', () => {
  const teamName = unique('Bilancio');
  let teamId = '';

  test.beforeAll(async () => {
    await register(BASE_URL, MAIL, ORGANIZATION.slug, GIULIA);
    const created = await api(MARIO, '/api/v1/teams', {
      method: 'POST',
      body: JSON.stringify({
        name: teamName,
        description: 'Reads the memos',
        visibility: 'private',
      }),
    });
    expect(created.status).toBe(201);
    teamId = (created.body as { id: string }).id;
    const added = await api(MARIO, `/api/v1/teams/${teamId}/members/${ANNA.user}`, {
      method: 'PUT',
      body: JSON.stringify({ role: 'member' }),
    });
    expect(added.status).toBe(200);
  });

  test.afterAll(async () => {
    await api(MARIO, `/api/v1/teams/${teamId}`, { method: 'DELETE' });
  });

  test('55.1, 55.2, 55.4, MK-054 54.2 a memo of an extension is shared with a team in the dialog of the kernel', async ({
    page,
  }) => {
    await signIn(page, MARIO);
    const text = unique('Bilancio previsionale');
    const dialog = await writeAndShare(page, text);
    const memo = await memoOf(text);

    // 55.1, 54.2: the dialog of the kernel, for a type that the extension only declared.
    await expect(dialog.getByText('Your level: Edit')).toBeVisible();
    await expect(dialog.getByText(/^Mario Rossi, who owns it, .* can share it\.$/)).toBeVisible();
    await dialog.getByLabel('Who', { exact: true }).selectOption('group');
    await dialog.getByLabel('Team', { exact: true }).selectOption(teamId);
    await dialog.getByLabel('Level', { exact: true }).selectOption('view');
    await dialog.getByRole('button', { name: 'Share', exact: true }).click();
    const access = dialog.getByRole('list', { name: 'Who has access' });
    await expect(access).toContainText(`Team ${teamName}`);

    // 55.2: the backend of the extension asks the kernel: the team reads it, the others do not.
    const read = await api(ANNA, `${MEMOS}/${memo.id}`);
    expect(read.status).toBe(200);
    expect((read.body as Memo).text).toBe(text);
    expect((await api(GIULIA, `${MEMOS}/${memo.id}`)).status).toBe(404);
    expect(((await api(GIULIA, MEMOS)).body as Memo[]).map((found) => found.id)).not.toContain(
      memo.id,
    );
    // Reading is not changing.
    const change = await api(ANNA, `${MEMOS}/${memo.id}`, {
      method: 'PUT',
      body: JSON.stringify({ text: 'Changed' }),
    });
    expect(change.status).toBe(403);

    // With a person, by email address.
    await dialog.getByLabel('Who', { exact: true }).selectOption('person');
    await dialog.getByLabel('Email', { exact: true }).fill(GIULIA.user);
    await dialog.getByLabel('Level', { exact: true }).selectOption('edit');
    await dialog.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(access).toContainText(GIULIA.name);
    expect((await api(GIULIA, `${MEMOS}/${memo.id}`)).status).toBe(200);

    // 55.4: the level that the extension gets is the one the dialog shows.
    for (const person of [MARIO, ANNA, GIULIA]) {
      const extension = (await api(person, `${MEMOS}/${memo.id}`)).body as Memo;
      const kernel = (await api(person, `${SHARING}/${memo.id}`)).body as { level: string };
      expect(extension.level, person.user).toBe(kernel.level);
    }
    expect(((await api(ANNA, `${SHARING}/${memo.id}`)).body as { level: string }).level).toBe(
      'view',
    );

    // Revoked in the dialog: the team no longer reads it.
    await dialog
      .getByRole('button', { name: `Remove access of Team ${teamName}`, exact: true })
      .click();
    await expect(access).not.toContainText(`Team ${teamName}`);
    expect((await api(ANNA, `${MEMOS}/${memo.id}`)).status).toBe(404);
  });

  test('55.3 a link opens the memo without an account until it is removed, then answers not found', async ({
    page,
    browser,
  }) => {
    await signIn(page, MARIO);
    const text = unique('Verbale della giunta');
    const dialog = await writeAndShare(page, text);
    const memo = await memoOf(text);

    await dialog.getByLabel('Link level', { exact: true }).selectOption('view');
    await dialog.getByLabel('Expires on', { exact: true }).fill(inDays(3));
    await dialog.getByRole('button', { name: 'Create link', exact: true }).click();
    const address = await dialog.getByLabel('Address of the link', { exact: true }).inputValue();
    expect(address).toMatch(/\/shared\/[\w-]{20,}$/);
    const token = address.slice(address.lastIndexOf('/') + 1);

    // Without an account: the page of the link shows the memo with the element of the extension.
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(address);
    await expect(visitor.getByRole('heading', { name: text, exact: true })).toBeVisible();
    const shown = visitor.locator('mk-fixture-memo');
    await expect(shown.getByText(text, { exact: true })).toBeVisible();
    await expect(shown.getByText('Level: view', { exact: true })).toBeVisible();

    // The link opens that memo only, and only through the routes that ask the kernel.
    const withLink = (path: string): Promise<Response> =>
      fetch(BASE_URL + path, { headers: { 'X-Mosaikit-Link': token } });
    expect((await withLink(`${MEMOS}/${memo.id}`)).status).toBe(200);
    expect((await withLink(MEMOS)).status).toBe(401);
    expect((await withLink('/api/v1/ext/fixture-notes/notes')).status).toBe(401);
    const other = await api(MARIO, MEMOS, {
      method: 'POST',
      body: JSON.stringify({ text: unique('Another memo') }),
    });
    expect((await withLink(`${MEMOS}/${(other.body as Memo).id}`)).status).toBe(404);
    expect((await fetch(`${BASE_URL}${MEMOS}/${memo.id}`)).status).toBe(401);

    // Removed in the dialog: the link no longer exists.
    await dialog.getByRole('button', { name: /^Remove access of Link/ }).click();
    await expect(dialog.getByRole('list', { name: 'Who has access' })).not.toContainText('Link');
    await visitor.reload();
    await expect(
      visitor.getByRole('heading', { name: 'Link not found', exact: true }),
    ).toBeVisible();
    expect((await withLink(`${MEMOS}/${memo.id}`)).status).toBe(401);
    await visitor.context().close();
  });
});
