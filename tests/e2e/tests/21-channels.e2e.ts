// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ANNA, MARIO } from '../support/env.js';
import { api, apps, openApp, signIn } from '../support/shell.js';

const ID = 'dev.mosaikit.app.teams';
const TEAM = `Ufficio tecnico ${Date.now().toString(36)}`;

async function personIn(browser: Browser, person: typeof MARIO): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, person);
  await openApp(page, 'Teams');
  return page;
}

/** The posts of the open channel, in the plugin. */
const posts = (page: Page) => page.getByRole('list', { name: 'Posts' });

test.describe.serial('MK-034 Channels with posts, threads, mentions and reactions', () => {
  let teamId = '';

  test.afterAll(async () => {
    if (teamId) {
      await api(MARIO, `/api/v1/teams/${teamId}`, { method: 'DELETE' });
    }
    await api(ANNA, '/api/v1/notifications/read', { method: 'POST', body: '{}' });
  });

  test('34.1 an installed app-teams lets an owner create a team and add a colleague', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    await openApp(page, 'Plugins');
    const row = page.locator('tbody tr').filter({ hasText: ID });
    await row.getByRole('button', { name: 'Install' }).click();
    await expect(page.locator('mk-admin-plugins').getByRole('status')).toContainText(
      `${ID} 0.1.0 is installed and active`,
    );

    const mario = await personIn(browser, MARIO);
    const newTeam = mario.getByRole('form', { name: 'New team' });
    await newTeam.getByLabel('Team name').fill(TEAM);
    await newTeam.getByRole('button', { name: 'Create team' }).click();
    await expect(mario.getByRole('heading', { name: `General · ${TEAM}` })).toBeVisible();
    teamId = new URL(mario.url()).searchParams.get('team') ?? '';
    expect(teamId).not.toBe('');

    await mario.getByRole('button', { name: /^People/ }).click();
    const add = mario.getByRole('form', { name: 'Add a person' });
    await add.getByLabel('Email of the person').fill(ANNA.user);
    await add.getByRole('button', { name: 'Add' }).click();
    await expect(mario.getByRole('region', { name: 'People of the team' })).toContainText(
      ANNA.user,
    );
  });

  test('34.2 a post appears at once for the others, and a reply goes to its thread', async ({
    browser,
  }) => {
    const mario = await personIn(browser, MARIO);
    const anna = await personIn(browser, ANNA);
    await anna.getByRole('button', { name: TEAM }).click();
    await expect(anna.getByRole('heading', { name: `General · ${TEAM}` })).toBeVisible();
    await mario.getByRole('button', { name: TEAM }).click();

    await mario.getByLabel('Message in General').fill('Riunione alle 10 in sala consiglio');
    await mario.getByRole('button', { name: 'Post', exact: true }).click();
    // Pushed on the real-time channel: Anna does not reload.
    await expect(posts(anna)).toContainText('Riunione alle 10 in sala consiglio', {
      timeout: 3000,
    });

    const post = posts(anna)
      .getByRole('article', { name: `Post of ${MARIO.name}` })
      .first();
    await post.getByRole('button', { name: 'Reply' }).click();
    await anna.getByLabel('Your reply').fill('Ci sarò');
    await anna.getByRole('button', { name: 'Send reply' }).click();
    await expect(
      posts(mario)
        .getByRole('list', { name: 'Replies' })
        .getByRole('article', {
          name: `Reply of ${ANNA.name}`,
        }),
    ).toContainText('Ci sarò', { timeout: 3000 });

    // The reactions of the post come before those of its replies.
    await post.getByRole('button', { name: '👍 0' }).first().click();
    await expect(posts(mario).getByRole('button', { name: '👍 1' }).first()).toBeVisible({
      timeout: 3000,
    });

    const results = await new AxeBuilder({ page: mario })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test('34.3 a mention notifies the person in the activity feed, which opens the channel', async ({
    browser,
  }) => {
    const mario = await personIn(browser, MARIO);
    const anna = await personIn(browser, ANNA);
    await mario.getByRole('button', { name: TEAM }).click();
    await mario.getByLabel('Message in General').fill(`@${ANNA.user} puoi controllare il verbale?`);
    await mario.getByRole('button', { name: 'Post', exact: true }).click();

    const activity = apps(anna).getByRole('link', { name: /^Activity/ });
    await expect(activity).toHaveAccessibleName(/Activity, \d+ unread/, { timeout: 3000 });
    await activity.click();
    await anna
      .getByRole('button', { name: `Unread: ${MARIO.name} mentioned you in General` })
      .first()
      .click();
    await expect(anna).toHaveURL(new RegExp(`/app/teams\\?team=${teamId}&channel=general$`));
    await expect(posts(anna)).toContainText('puoi controllare il verbale?');
  });

  test('34.4 a private channel is visible only to its members', async ({ browser }) => {
    const mario = await personIn(browser, MARIO);
    await mario.getByRole('button', { name: TEAM }).click();
    const channel = mario.getByRole('form', { name: 'New channel' });
    await channel.getByLabel('Channel name').fill('Bilancio');
    await channel.getByLabel('Private').check();
    await channel.getByRole('button', { name: 'Add channel' }).click();
    await expect(mario.getByRole('heading', { name: `Bilancio · ${TEAM}` })).toBeVisible();
    const group = new URL(mario.url()).searchParams.get('channel') ?? '';
    await mario.getByLabel('Message in Bilancio').fill('Variazione di bilancio riservata');
    await mario.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(posts(mario)).toContainText('Variazione di bilancio riservata');

    const anna = await personIn(browser, ANNA);
    await anna.getByRole('button', { name: TEAM }).click();
    const channels = anna.getByRole('list', { name: `Channels of ${TEAM}` });
    await expect(channels.getByRole('button', { name: 'General channel' })).toBeVisible();
    await expect(channels.getByRole('button', { name: 'Bilancio, private channel' })).toHaveCount(
      0,
    );
    // Not even through the API.
    const read = await api(ANNA, `/api/v1/data/${ID}/posts?team=${group}`);
    expect(read.status).toBe(404);
  });
});
