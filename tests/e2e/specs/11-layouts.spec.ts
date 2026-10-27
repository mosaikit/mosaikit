import path from 'node:path'
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { PASSWORD, adminLogin, login, logout, appearanceTab, nav, accessible } from './support'

// Layouts, pages of an app, layout from a file. Runs in order after the previous file (the state of the installation is shared).

test.describe.serial('11-layouts', () => {
  test('layouts: every layout with its slots, keyboard, phone, dark mode and contrast; the pages of an app; a layout installed from a file', async ({ page }) => {
    test.setTimeout(600_000)
    /** A call of the API with the CSRF token of the session in the page. */
    const call = (method: string, path: string, body?: unknown) =>
      page.evaluate(
        async ([method, path, body]) => {
          const s = await (await fetch('api/session')).json()
          const r = await fetch(path as string, { method: method as string, headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrf }, body: body === undefined ? undefined : JSON.stringify(body) })
          return r.status
        },
        [method, path, body] as const,
      )
    /** The slots of the shell: the skip link first, then band, navigation and content. */
    async function slots(where: string) {
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: 'Skip to the content' })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.locator('#main')).toBeFocused()
      await expect(page.locator('header.msk-band')).toBeVisible()
      await expect(page.locator('.msk-nav').first()).toBeVisible()
      await accessible(page, where)
    }

    await adminLogin(page)
    // System › Identity and appearance › Layout: the two built-in layouts and the four official plugins
    await nav(page, 'System').click()
    await appearanceTab(page, 'Layout')
    const cards = page.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio')
    await expect(cards).toHaveCount(6)
    await accessible(page, 'System › Layout')

    for (const id of ['console', 'com.mosaikit.layout-workspace', 'com.mosaikit.layout-suite', 'com.mosaikit.layout-project', 'com.mosaikit.layout-tabs']) {
      expect(await call('PUT', 'api/admin/settings', { values: { layout: id } })).toBe(200)
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.emulateMedia({ colorScheme: 'light' })
      await page.goto('./#/admin')
      await page.reload()
      await expect(page.locator(`.msk-shell[data-layout="${id}"]`)).toBeAttached()
      await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible()
      await slots(`${id}, light`)
      // the pages are reachable in every layout (Suite: in the launcher)
      if (id === 'com.mosaikit.layout-suite') {
        await page.getByRole('button', { name: 'All apps and pages' }).click()
        await page.getByRole('dialog', { name: 'All apps and pages' }).getByRole('link', { name: 'Tenants', exact: true }).click()
      } else {
        await page.locator('.msk-nav').getByRole('link', { name: 'Tenants', exact: true }).click()
      }
      await expect(page).toHaveURL(/#\/admin\/tenants/)
      // dark mode
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.waitForTimeout(600) // the colours transition
      await accessible(page, `${id}, dark`)
      // the phone: the navigation in a drawer (or the launcher), no horizontal scroll
      await page.emulateMedia({ colorScheme: 'light' })
      await page.setViewportSize({ width: 400, height: 800 })
      await page.getByRole('button', { name: 'Open the navigation' }).click()
      const drawer = id === 'com.mosaikit.layout-suite' ? page.getByRole('dialog', { name: 'All apps and pages' }) : page.getByRole('dialog', { name: 'Navigation' })
      await expect(drawer.getByRole('link', { name: 'People', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    await page.setViewportSize({ width: 1280, height: 800 })

    // high contrast with a layout of a plugin (Workspace)
    expect(await call('PUT', 'api/admin/settings', { values: { layout: 'com.mosaikit.layout-workspace' } })).toBe(200)
    await page.goto('./#/admin')
    await page.reload()
    await page.getByRole('button', { name: 'Mode' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'High contrast' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitemcheckbox', { name: 'High contrast' })).toBeHidden()
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more')
    await accessible(page, 'Workspace, high contrast')
    await page.getByRole('button', { name: 'Mode' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'High contrast' }).click()
    await page.keyboard.press('Escape')

    // a layout installed from a file: Tabs uninstalled, then installed again from its package
    expect(await call('DELETE', 'api/admin/plugins/com.mosaikit.layout-tabs')).toBe(200)
    await page.goto('./#/admin/plugins')
    const dir = path.join(process.cwd(), '..', '.dev', 'e2e', 'registry', 'plugins')
    const pkg = fs.readdirSync(dir).find((f) => f.includes('layout-tabs'))!
    await page.locator('input[type="file"]').first().setInputFiles(path.join(dir, pkg))
    await expect(page.getByRole('row', { name: /Tabs/ })).toBeVisible()
    await page.getByRole('row', { name: /Tabs/ }).getByRole('link').first().click()
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'What it contains' }).click()
    await expect(page.getByText('Arrangement of the slots')).toBeVisible()
    await expect(page.getByText('Apps and pages as tabs')).toBeVisible()
    await accessible(page, 'What it contains')

    // Console for the platform, the tenants may not choose Tabs
    expect(await call('PUT', 'api/admin/settings', { values: { layout: 'console', 'layout.allowed': ['console', 'teams'] } })).toBe(200)
    await logout(page)

    // the Tenant Manager of Alfa in Console: the pages of Notes from its manifest, a page opens the app there
    await login(page, 'Alfa', 'manager', PASSWORD)
    await expect(page.locator('.msk-shell[data-layout="console"]')).toBeAttached()
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    const side = page.locator('nav.msk-nav')
    await side.getByRole('button', { name: 'Open the pages of Notes' }).click()
    await side.getByRole('link', { name: 'Mine', exact: true }).click()
    await expect(page).toHaveURL(/#\/t\/alfa\/p\/com\.mosaikit\.notes\/mine/)
    await expect(page.frameLocator('iframe.plugin-frame').getByRole('heading', { name: 'My notes' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Mine')
    // Tenant settings › Layout: inherited; Tabs is not offered
    await side.getByRole('link', { name: 'Tenant settings', exact: true }).click()
    await appearanceTab(page, 'Layout')
    await expect(page.getByText('Inherited').first()).toBeVisible()
    await expect(page.locator('[data-layout-card="com.mosaikit.layout-tabs"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Customize' }).first().click()
    await page.locator('[data-layout-card="teams"]').click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.msk-shell[data-layout="teams"]')).toBeAttached()
    // the Style of the tenant
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Style', exact: true }).click()
    await accessible(page, 'Tenant settings › Style')
    await logout(page)

    // back to the default for the tests that follow
    await adminLogin(page)
    expect(await call('PUT', 'api/admin/settings', { values: { layout: null, 'layout.allowed': null } })).toBe(200)
    await logout(page)
  })

})
