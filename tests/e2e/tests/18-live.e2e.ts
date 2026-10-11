// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test } from '@playwright/test';
import { ANNA, MARIO, ORGANIZATION } from '../support/env.js';
import { openApp, signIn, unique } from '../support/shell.js';

test.describe('MK-031 Real-time channel from the kernel to the browser', () => {
  test('31.1 a change of a colleague shows at once, without reloading the page', async ({
    page,
    browser,
  }) => {
    await signIn(page, MARIO);
    await openApp(page, 'To do');
    const list = page.getByRole('list', { name: 'Items' });

    const anna = await (await browser.newContext()).newPage();
    await signIn(anna, ANNA);
    await openApp(anna, 'To do');
    const title = unique('Riunione di giunta');
    await anna.getByLabel('New item').fill(title);
    await anna.getByRole('button', { name: 'Add' }).click();
    await expect(anna.getByRole('list', { name: 'Items' })).toContainText(title);

    // Mario's page did not reload: the event of the kernel made it read the items again.
    await expect(list).toContainText(title, { timeout: 3000 });
    await anna.getByRole('button', { name: `Remove ${title}` }).click();
    await expect(list).not.toContainText(title, { timeout: 3000 });
  });

  test('31.2 a topic the person may not read is refused', async ({ page }) => {
    await signIn(page, MARIO);
    const answers = await page.evaluate(async (organization) => {
      const socket = new WebSocket(
        `ws://${location.host}/api/v1/live?organization=${organization}`,
      );
      await new Promise((resolve) => {
        socket.addEventListener('open', resolve);
      });
      const received: { type: string; topic: string }[] = [];
      socket.addEventListener('message', (event: MessageEvent<string>) => {
        received.push(JSON.parse(event.data) as { type: string; topic: string });
      });
      for (const topic of [
        'documents.dev.mosaikit.sample.todo.items',
        'documents.dev.none.items',
      ]) {
        socket.send(JSON.stringify({ type: 'subscribe', topic }));
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      socket.close();
      return received;
    }, ORGANIZATION.slug);

    expect(answers).toEqual([
      { type: 'subscribed', topic: 'documents.dev.mosaikit.sample.todo.items' },
      expect.objectContaining({ type: 'refused', topic: 'documents.dev.none.items' }),
    ]);
  });
});
