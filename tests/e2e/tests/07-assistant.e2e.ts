// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test, type Page } from '@playwright/test';
import { ANNA, MARIO } from '../support/env.js';
import { activities, api, createActivity, signIn, unique } from '../support/shell.js';

/** Asks the assistant of the home page and waits for its answer. */
async function ask(page: Page, question: string): Promise<string> {
  const assistant = page.locator('mk-assistant');
  const answers = assistant.locator('ol li.assistant');
  const before = await answers.count();
  await assistant.getByLabel('Question for the assistant').fill(question);
  await assistant.getByRole('button', { name: 'Ask' }).click();
  await expect(answers).toHaveCount(before + 1);
  return answers.last().innerText();
}

const pending = (page: Page) => page.getByRole('region', { name: 'Pending actions' });

test.describe('MK-024 Assistant on the tools of the plugins', () => {
  test('24.1 a request in Italian is answered at once with a read tool', async ({ page }) => {
    const open = await createActivity(MARIO, unique('Potare gli alberi del parco'));
    await signIn(page, MARIO);
    const answer = await ask(page, 'Quali attività sono ancora aperte?');
    expect(answer).toContain(open.title);
    await expect(pending(page)).toHaveCount(0);
  });

  test('24.2–24.3 a change waits as a draft, and Confirm runs it', async ({ page }) => {
    const activity = await createActivity(MARIO, unique('Riparare il lampione'));
    await signIn(page, MARIO);
    await ask(page, `Completa l'attività "${activity.title}".`);
    await expect(pending(page)).toBeVisible();
    expect((await activities(MARIO)).find((a) => a.id === activity.id)?.done).toBe(false);

    await pending(page).getByRole('button', { name: 'Confirm' }).first().click();
    await expect(pending(page)).toHaveCount(0);
    await expect
      .poll(async () => (await activities(MARIO)).find((a) => a.id === activity.id)?.done)
      .toBe(true);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('24.4 Reject discards the proposal and nothing changes', async ({ page }) => {
    const activity = await createActivity(MARIO, unique('Pulire la fontana'));
    await signIn(page, MARIO);
    await ask(page, `Completa l'attività "${activity.title}".`);
    await pending(page).getByRole('button', { name: 'Reject' }).first().click();
    await expect(pending(page)).toHaveCount(0);
    expect((await activities(MARIO)).find((a) => a.id === activity.id)?.done).toBe(false);
  });

  test('a title passed as an identifier is refused before it becomes a draft', async ({ page }) => {
    const activity = await createActivity(MARIO, unique('Verniciare la panchina'));
    await signIn(page, MARIO);
    const answer = await ask(page, `Completa l'attività "${activity.title}" usando il titolo.`);
    expect(answer).toContain('must be a valid uuid');
    await expect(pending(page)).toHaveCount(0);
  });

  test('a confirmed action that the plugin refuses is reported, and nothing changes', async ({
    page,
  }) => {
    // A draft for an activity that does not exist: the plugin answers 404 at the confirmation.
    const drafted = await api(
      MARIO,
      '/api/v1/ai/tools/sample-activities__complete-activity/invocations',
      {
        method: 'POST',
        body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000000' }),
      },
    );
    expect(drafted.status).toBe(202);
    await signIn(page, MARIO);
    await pending(page).getByRole('button', { name: 'Confirm' }).first().click();
    await expect(page.getByRole('alert')).toContainText('Complete an activity failed');
    await expect(page.getByRole('alert')).toContainText('Nothing was changed');
  });

  test('24.5 another person of the organization does not see the proposals', async ({ page }) => {
    const activity = await createActivity(MARIO, unique('Controllare i lampioni'));
    const drafted = await api(
      MARIO,
      '/api/v1/ai/tools/sample-activities__complete-activity/invocations',
      {
        method: 'POST',
        body: JSON.stringify({ id: activity.id }),
      },
    );
    expect(drafted.status).toBe(202);
    await signIn(page, ANNA);
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
    await expect(pending(page)).toHaveCount(0);
  });
});
