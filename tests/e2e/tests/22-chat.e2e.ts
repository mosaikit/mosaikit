// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ANNA, MARIO, type Person } from '../support/env.js';
import { api, openApp, signIn } from '../support/shell.js';

const ID = 'dev.mosaikit.app.chat';
const TODO = '/api/v1/data/dev.mosaikit.sample.todo/items';

async function inChat(browser: Browser, person: Person): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, person);
  await openApp(page, 'Chat');
  return page;
}

const messages = (page: Page) => page.getByRole('list', { name: 'Messages' });

test.describe.serial('MK-036 Chats one to one and in groups', () => {
  let chatId = '';

  test.afterAll(async () => {
    if (chatId) {
      for (const person of [MARIO, ANNA]) {
        await api(person, `/api/v1/teams/${chatId}/members/${person.user}`, { method: 'DELETE' });
      }
    }
    for (const person of [MARIO, ANNA]) {
      await api(person, '/api/v1/notifications/read', { method: 'POST', body: '{}' });
    }
  });

  test('36.1 two people exchange messages at once, and see who read them and who is typing', async ({
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

    const mario = await inChat(browser, MARIO);
    const anna = await inChat(browser, ANNA);
    const start = mario.getByRole('form', { name: 'New chat' });
    await start.getByLabel('People').fill(ANNA.user);
    await start.getByRole('button', { name: 'Start chat' }).click();
    await expect(mario.getByRole('heading', { name: ANNA.name })).toBeVisible();
    chatId = new URL(mario.url()).searchParams.get('chat') ?? '';
    expect(chatId).not.toBe('');

    await mario.getByLabel(`Message to ${ANNA.name}`).fill('Ciao Anna, hai un minuto?');
    await mario.getByLabel(`Message to ${ANNA.name}`).press('Enter');
    // Anna had the app open: the chat and its message arrive without a reload.
    await expect(anna.getByRole('navigation', { name: 'Chats' })).toContainText(MARIO.name, {
      timeout: 5000,
    });
    await anna.getByRole('button', { name: MARIO.name, exact: true }).click();
    await expect(messages(anna)).toContainText('Ciao Anna, hai un minuto?');
    await expect(mario.locator('#presence')).toHaveText(`Seen by ${ANNA.name}`, { timeout: 5000 });

    await anna.getByLabel(`Message to ${MARIO.name}`).pressSequentially('Certo');
    await expect(mario.locator('#presence')).toContainText(`${ANNA.name} is typing…`, {
      timeout: 5000,
    });
    await anna.getByRole('button', { name: 'Send' }).click();
    const sentAt = Date.now();
    await expect(messages(mario)).toContainText('Certo', { timeout: 3000 });
    // Within about a second, the time of the real-time channel (MK-031).
    expect(Date.now() - sentAt).toBeLessThan(2000);

    // The history stays: a new page reads it again.
    await mario.reload();
    await mario.getByRole('button', { name: ANNA.name, exact: true }).click();
    await expect(messages(mario).getByRole('article')).toHaveCount(2);

    const results = await new AxeBuilder({ page: mario })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test('36.2 a card of a plugin shows its fields, and its action runs with the rights of who uses it', async ({
    browser,
  }) => {
    // A plugin publishes a card in the chat, as Anna's page would: a message of the collection.
    const published = await api(ANNA, `/api/v1/data/${ID}/messages?team=${chatId}`, {
      method: 'POST',
      body: JSON.stringify({
        text: 'Una nuova attività per voi',
        card: {
          title: 'Sopralluogo in via Roma',
          fields: [
            { label: 'Quando', value: 'Lunedì alle 9' },
            { label: 'Dove', value: 'Via Roma 12' },
          ],
          actions: [
            {
              label: 'Prendo io',
              request: {
                method: 'POST',
                path: TODO,
                body: { title: 'Sopralluogo in via Roma', done: false },
              },
            },
          ],
        },
      }),
    });
    expect(published.status).toBe(201);

    const mario = await inChat(browser, MARIO);
    await mario.getByRole('button', { name: ANNA.name, exact: true }).click();
    const card = mario.getByRole('region', { name: 'Card: Sopralluogo in via Roma' });
    await expect(card).toContainText('Lunedì alle 9');
    await expect(card).toContainText('Via Roma 12');
    await card.getByRole('button', { name: 'Prendo io' }).click();
    await expect(mario.locator('mk-app-chat').getByRole('status')).toContainText('Done: Prendo io');

    // The item is Mario's, who chose the action, not Anna's, whose page published the card.
    const items = (await api(MARIO, TODO)).body as {
      id: string;
      createdBy: string;
      data: { title: string };
    }[];
    const taken = items.find((item) => item.data.title === 'Sopralluogo in via Roma');
    expect(taken?.createdBy).toBe(MARIO.user);
    if (taken) {
      await api(MARIO, `${TODO}/${taken.id}`, { method: 'DELETE' });
    }
  });
});
