import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test'
import { DEV_PASSWORD, DEV_TENANT, type DevUserName } from './users.ts'
import { pluginUrl } from './server.ts'

/** Signs in to the shell of the development server as a test user and waits for the person menu. */
export async function signIn(page: Page, app: string, user: DevUserName, opts: { lang?: string } = {}): Promise<void> {
  await page.goto(app)
  // the shell is in English unless the test says otherwise: the labels the helpers click are English
  await page.evaluate((lang) => localStorage.setItem('msk_lang', lang), opts.lang ?? 'en')
  await page.goto(app)
  await page.getByLabel('Username').fill(user)
  await page.getByLabel('Password').fill(DEV_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: /person menu/ })).toBeVisible()
}

/** Opens the plugin in the shell and gives the frame of its UI. */
export async function openPlugin(page: Page, app: string, pluginId: string, tenant = DEV_TENANT): Promise<FrameLocator> {
  await page.goto(pluginUrl(app, pluginId, tenant))
  await expect(page.locator('iframe.plugin-frame')).toBeVisible()
  return page.frameLocator('iframe.plugin-frame')
}

/**
 * Creates an item in a page built with `mountCrud`: opens the editor with the «New» button, fills the fields by key
 * (`{ title: 'Plan' }`: the key of the field in `plugin.toml`) and saves. Returns the row of the item; the first
 * value is what the row is looked up by (`title` when there is one).
 */
export async function createItem(
  frame: FrameLocator,
  values: Record<string, string>,
  opts: { newLabel?: RegExp | string } = {},
): Promise<Locator> {
  await frame.getByRole('button', { name: opts.newLabel ?? /New/ }).first().click()
  for (const [key, value] of Object.entries(values)) {
    const field = frame.locator(`[data-key="${key}"]`).first()
    const tag = await field.evaluate((e) => e.tagName.toLowerCase())
    if (tag === 'select') await field.selectOption(value)
    else await field.fill(value)
  }
  await frame.getByRole('button', { name: 'Save' }).click()
  const row = frame.locator('.msk-item', { hasText: values.title ?? Object.values(values)[0] ?? '' }).first()
  await expect(row).toBeVisible()
  return row
}
