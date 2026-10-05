// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, ANNA, MARIO, ORGANIZATION, type Person } from '../support/env.js';
import { api, signIn } from '../support/shell.js';

// app-teams (21-channels) and the sample To do (09-data), which contributes a tab, are installed.
const APPS = `/api/v1/organizations/${ORGANIZATION.slug}/apps`;
const TEAM = `Viabilità ${Date.now().toString(36)}`;

async function inTeam(browser: Browser, person: Person, team: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, person);
  await page.goto(`/app/teams?team=${team}&channel=general`);
  await expect(page.getByRole('heading', { name: `General · ${TEAM}` })).toBeVisible();
  return page;
}

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Tabs of General' });

test.describe.serial('MK-035 Tabs of the channels added by plugins', () => {
  let team = '';

  test.beforeAll(async () => {
    const created = await api(MARIO, '/api/v1/teams', {
      method: 'POST',
      body: JSON.stringify({ name: TEAM, visibility: 'private' }),
    });
    expect(created.status).toBe(201);
    team = (created.body as { id: string }).id;
    const added = await api(MARIO, `/api/v1/teams/${team}/members/${ANNA.user}`, {
      method: 'PUT',
      body: JSON.stringify({ role: 'member' }),
    });
    expect(added.status).toBe(200);
  });

  test.afterAll(async () => {
    await api(ADMIN, APPS, { method: 'PUT', body: '[]' });
    await api(MARIO, `/api/v1/teams/${team}`, { method: 'DELETE' });
  });

  test('35.1 a member adds a tab of an installed plugin to a channel, and every member sees it', async ({
    browser,
  }) => {
    const mario = await inTeam(browser, MARIO, team);
    await expect(tabs(mario).getByRole('tab', { name: 'Posts' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(tabs(mario).getByRole('tab', { name: 'Files' })).toBeVisible();

    const add = mario.getByRole('form', { name: 'Add a tab' });
    await add.getByLabel('App of the tab').selectOption({ label: 'To do' });
    await add.getByRole('button', { name: 'Add tab' }).click();
    await expect(tabs(mario).getByRole('tab', { name: 'To do' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(mario.getByRole('tabpanel').getByRole('heading', { name: 'To do' })).toBeVisible();

    const anna = await inTeam(browser, ANNA, team);
    await tabs(anna).getByRole('tab', { name: 'To do' }).click();
    await expect(anna.getByRole('tabpanel').getByRole('heading', { name: 'To do' })).toBeVisible();
  });

  test('35.2 a tab of a plugin turned off for the organization is unavailable, and the channel works on', async ({
    browser,
  }) => {
    const settings = (await api(ADMIN, APPS)).body as { pluginId: string; enabled: boolean }[];
    const off = settings.map((app) =>
      app.pluginId === 'dev.mosaikit.sample.todo' ? { ...app, enabled: false } : app,
    );
    expect((await api(ADMIN, APPS, { method: 'PUT', body: JSON.stringify(off) })).status).toBe(200);

    const mario = await inTeam(browser, MARIO, team);
    await tabs(mario).getByRole('tab', { name: 'To do' }).click();
    await expect(mario.getByRole('region', { name: 'To do is unavailable' })).toContainText(
      'turned off for your organization',
    );

    await tabs(mario).getByRole('tab', { name: 'Posts' }).click();
    await mario.getByLabel('Message in General').fill('Il canale funziona anche così');
    await mario.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(mario.getByRole('list', { name: 'Posts' })).toContainText(
      'Il canale funziona anche così',
    );
  });
});
