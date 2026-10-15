// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
// e2e-group: B
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The page patterns of the UI kit (MK-105), in the browser: the shell defines them for the page, as
 * for the frontends of extensions, and the test mounts them as an app would.
 */
async function mount(page: Page, html: string): Promise<Locator> {
  await page.waitForFunction(() => customElements.get('mk-list-page') !== undefined);
  await page.evaluate((markup) => {
    document.getElementById('mk-105')?.remove();
    const host = document.createElement('div');
    host.id = 'mk-105';
    host.style.cssText =
      'position: fixed; inset: 0; z-index: 2147483647; display: flex; background: var(--mk-bg, #fff)';
    host.innerHTML = markup;
    document.body.append(host);
    const events: string[] = [];
    for (const name of [
      'mk-selection-clear',
      'mk-layout-change',
      'mk-clear-filters',
      'mk-retry',
      'mk-pane-resize',
    ]) {
      host.addEventListener(name, () => events.push(name));
    }
    (window as unknown as { mk105Events: string[] }).mk105Events = events;
  }, html);
  return page.locator('#mk-105');
}

function events(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { mk105Events: string[] }).mk105Events);
}

const ITEMS = Array.from({ length: 40 }, (_, i) => `<div>Note ${String(i + 1)}</div>`).join('');

const LIST = `
<mk-list-page heading="Notes" count="40" layout="rows" style="flex: 1">
  <fieldset slot="facets"><legend>Color</legend><label><input type="checkbox"> Green</label></fieldset>
  <button slot="actions" type="button">New note</button>
  <button slot="bulk-actions" type="button">Archive</button>
  ${ITEMS}
</mk-list-page>`;

test.describe('MK-105 List page, empty and error states and resizable panes in the UI kit', () => {
  test('105.1 a list page with facets, a fixed header with the count, grid or rows, bulk actions', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const root = await mount(page, LIST);
    const list = root.locator('mk-list-page');

    await expect(root.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible();
    await expect(list.locator('.count')).toHaveText('40');
    await expect(root.getByRole('complementary', { name: 'Filters' })).toBeVisible();
    await expect(root.getByRole('checkbox', { name: 'Green' })).toBeVisible();
    await expect(root.getByRole('button', { name: 'New note' })).toBeVisible();

    // The header stays where it is while the items scroll.
    const before = await root.getByRole('heading', { name: 'Notes', exact: true }).boundingBox();
    await list.locator('.items').evaluate((items) => {
      items.scrollTop = 600;
    });
    await expect(root.getByText('Note 1', { exact: true })).not.toBeInViewport();
    const after = await root.getByRole('heading', { name: 'Notes', exact: true }).boundingBox();
    expect(after?.y).toBe(before?.y);

    // Rows, then a grid of cards.
    await expect(list.locator('.items')).toHaveAttribute('data-layout', 'rows');
    await root.getByRole('button', { name: 'Grid', exact: true }).click();
    await expect(root.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(list).toHaveAttribute('layout', 'grid');
    await expect(list.locator('.items')).toHaveCSS('display', 'grid');

    // The bulk actions of the app show only with a selection.
    await expect(root.getByRole('button', { name: 'Archive' })).toBeHidden();
    await list.evaluate((element) => {
      element.setAttribute('selected', '2');
    });
    await expect(root.getByRole('group', { name: '2 selected' })).toBeVisible();
    await expect(root.getByRole('button', { name: 'Archive' })).toBeVisible();
    await root.getByRole('button', { name: 'Clear the selection' }).click();
    expect(await events(page)).toEqual(['mk-layout-change', 'mk-selection-clear']);
  });

  test('105.2 below the medium breakpoint the facets open from a button with the active filters', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto('/');
    const root = await mount(page, LIST);
    const list = root.locator('mk-list-page');
    await list.evaluate((element) => {
      element.setAttribute('active-filters', '2');
    });

    const facets = root.getByRole('complementary', { name: 'Filters' });
    await expect(facets).toBeHidden();
    const button = root.getByRole('button', { name: 'Filters (2 active)' });
    await expect(button).toBeVisible();
    await expect(button).toContainText('2');
    await expect(button).toHaveAttribute('aria-expanded', 'false');

    await button.click();
    await expect(facets).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(root.getByRole('checkbox', { name: 'Green' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(facets).toBeHidden();

    await button.click();
    await root.getByRole('button', { name: 'Close the filters' }).click();
    await expect(facets).toBeHidden();

    // Without active filters the button says only Filters.
    await list.evaluate((element) => {
      element.removeAttribute('active-filters');
    });
    await expect(root.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
  });

  test('105.3 an empty or error state tells apart nothing yet, filtered, failed, offline and denied', async ({
    page,
  }) => {
    await page.goto('/');
    const root = await mount(
      page,
      `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; flex: 1; overflow: auto">
        <mk-empty-state kind="empty" heading="No notes yet">Notes you write show here.
          <button slot="action" type="button">New note</button></mk-empty-state>
        <mk-empty-state kind="filtered"></mk-empty-state>
        <mk-empty-state kind="failed"></mk-empty-state>
        <mk-empty-state kind="offline"></mk-empty-state>
        <mk-empty-state kind="denied"></mk-empty-state>
      </div>`,
    );
    const state = (kind: string): Locator => root.locator(`mk-empty-state[kind="${kind}"]`);

    // The title, explanation and action of the app.
    await expect(state('empty').getByRole('heading', { name: 'No notes yet' })).toBeVisible();
    await expect(state('empty')).toContainText('Notes you write show here.');
    await expect(state('empty').getByRole('button', { name: 'New note' })).toBeVisible();

    // The defaults of each kind, all different.
    for (const [kind, title] of [
      ['filtered', 'Nothing matches the filters'],
      ['failed', 'This could not be loaded'],
      ['offline', 'You are offline'],
      ['denied', 'You do not have access'],
    ] as const) {
      await expect(state(kind).getByRole('heading', { name: title })).toBeVisible();
    }
    await expect(state('denied')).toContainText('Ask the owner');
    await expect(state('failed')).toHaveAttribute('data-tone', 'problem');
    await expect(state('empty')).toHaveAttribute('data-tone', 'neutral');
    await expect(state('denied').getByRole('button')).toHaveCount(0);

    await state('filtered').getByRole('button', { name: 'Clear the filters' }).click();
    await state('failed').getByRole('button', { name: 'Try again' }).click();
    await state('offline').getByRole('button', { name: 'Try again' }).click();
    expect(await events(page)).toEqual(['mk-clear-filters', 'mk-retry', 'mk-retry']);
  });

  test('105.4 the person resizes the list pane, and the app keeps the width at the next visit', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const pane = `
      <mk-split-pane name="e2e.notes" width="300" min="160" max="640" style="flex: 1">
        <nav slot="pane" aria-label="Note list">${ITEMS}</nav>
        <article>The note</article>
      </mk-split-pane>`;
    let root = await mount(page, pane);
    const handle = root.getByRole('separator', { name: 'Resize the pane' });
    await expect(handle).toHaveAttribute('aria-valuenow', '300');
    // The width of the pane itself: a scroll bar may take some of the list inside it.
    const width = async (): Promise<number | undefined> =>
      (await root.locator('mk-split-pane .pane').boundingBox())?.width;
    expect(await width()).toBe(300);

    // With the keyboard.
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', '332');
    await page.keyboard.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', '160');
    await page.keyboard.press('ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', '176');

    // With the pointer.
    const box = await handle.boundingBox();
    if (!box) {
      throw new Error('the handle has no box');
    }
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, y, { steps: 5 });
    await page.mouse.up();
    await expect(handle).toHaveAttribute('aria-valuenow', '296');

    // The next visit.
    await page.reload();
    root = await mount(page, pane);
    await expect(root.getByRole('separator', { name: 'Resize the pane' })).toHaveAttribute(
      'aria-valuenow',
      '296',
    );
    expect(await width()).toBe(296);
  });
});
