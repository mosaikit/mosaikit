import { expect, test } from '@playwright/test'
import { colorsSettled, PASSWORD, adminLogin, login, logout, nav, accessible } from './support'

// Review round 1: tenant, people, lists, overview. Runs in order after the previous file (the state of the installation is shared).

test.describe.serial('12-review-round1-platform', () => {
  test('Review round 1, tenant and people: quotas tab, identity, plugins pills, brochure, monitoring, mail, keys, Administrators, profiles', async ({ page }) => {
    await adminLogin(page)

    // R1-T-01 and R1-T-02: tenant detail, quotas in their own tab, name and identifier editable
    await nav(page, 'Tenants').click()
    await page.getByRole('row', { name: /City of Alfa/ }).getByRole('link').first().click()
    const tabs = page.getByRole('navigation', { name: 'Tabs' })
    await expect(tabs.getByRole('link', { name: 'Quotas' })).toBeVisible()
    await expect(page.getByText('Used: ')).toHaveCount(0)
    const name = await page.getByLabel('Name', { exact: true }).inputValue()
    const slug = await page.getByLabel('Identifier', { exact: true }).inputValue()
    await page.getByLabel('Name', { exact: true }).fill(name + ' X')
    await page.getByLabel('Identifier', { exact: true }).fill(slug + '-x')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Name and identifier saved').first()).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Identifier', { exact: true })).toHaveValue(slug + '-x')
    await page.getByLabel('Name', { exact: true }).fill(name)
    await page.getByLabel('Identifier', { exact: true }).fill(slug)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Name and identifier saved').first()).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Identifier', { exact: true })).toHaveValue(slug)
    await tabs.getByRole('link', { name: 'Quotas' }).click()
    await expect(page.getByText('Used: ').first()).toBeVisible()
    // R1-T-03: what the items count
    await expect(page.getByText('Everything the people create in the apps').first()).toBeVisible()
    await accessible(page, 'tenant quotas tab')

    // R1-T-04 and R1-T-05: the Plugins tab, a pill in every row, the link to the Plugins page
    await tabs.getByRole('link', { name: 'Plugins' }).click()
    const rows = page.locator('tbody tr')
    expect(await rows.count()).toBeGreaterThan(0)
    expect(await rows.locator('td:last-child [data-slot="badge"]').count()).toBe(await rows.count())
    await page.getByTestId('to-plugins-page').click()
    await expect(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible()

    // R1-T-06: the plugin as a brochure
    await page.goto('./#/admin/plugin/com.mosaikit.notes')
    const brochure = page.getByTestId('plugin-brochure')
    await expect(brochure).toContainText('Mosaikit')
    await expect(brochure).toContainText('Apache-2.0')
    await expect(brochure).toContainText('Write notes with a title')
    const pic = page.getByTestId('plugin-gallery').locator('img').first()
    await expect(pic).toBeVisible()
    expect(await pic.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true)
    await page.getByRole('button', { name: 'Show picture 2' }).click()
    await accessible(page, 'plugin brochure')

    // R1-T-07: the monitoring figures are real: how often, how long, when last
    await nav(page, 'Monitoring').click()
    await expect(page.getByTestId('monitoring-note')).toContainText('collected every minute and kept for 8 days')
    await expect(page.getByTestId('monitoring-note')).toContainText('Last update:')

    // R1-T-08: the mail server needs an SMTP server; the test button is there
    await page.goto('./#/admin/system/email')
    await expect(page.getByTestId('mail-explain')).toContainText('needs an SMTP server')
    await expect(page.getByRole('button', { name: 'Send a test' })).toBeVisible()

    // R1-T-09: the keys are declared by the plugins
    await page.goto('./#/admin/system/keys')
    await expect(page.getByTestId('keys-explain')).toContainText('decided by the plugins')

    // R1-T-10: an Administrator edits their own data and those of another Administrator
    await page.goto('./#/admin/system/admins')
    const adminRow = page.getByRole('row', { name: /admin/ }).first()
    await adminRow.getByRole('button', { name: /Actions for/ }).click()
    await page.getByRole('menuitem', { name: 'Edit name and email' }).click()
    const dlg = page.getByRole('dialog', { name: /Data of/ })
    const mine = await dlg.getByLabel('Name').inputValue()
    await dlg.getByLabel('Name').fill(mine + ' Two')
    // the own email is changed from the Account page, with the password: not here
    await expect(dlg.getByLabel('Email')).toHaveCount(0)
    await expect(dlg).toContainText('Account')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Data saved').first()).toBeVisible()
    await expect(page.getByText(mine + ' Two').first()).toBeVisible()
    await adminRow.getByRole('button', { name: /Actions for/ }).click()
    await page.getByRole('menuitem', { name: 'Edit name and email' }).click()
    await dlg.getByLabel('Name').fill(mine)
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Data saved').first()).toBeVisible()
    await logout(page)

    // R1-T-11: permission profiles: described, renamed, readable names, compact editor
    await login(page, 'Alfa Municipality', 'manager', PASSWORD)
    await nav(page, 'Manage').click()
    await page.getByRole('radio', { name: /Permission profiles/ }).click()
    await expect(page.getByText('A permission profile is a named set of permissions')).toBeVisible()
    await expect(page.getByTestId('profile-summary').first()).toContainText('plugins')
    await expect(page.getByTestId('profile-summary').first()).not.toContainText('com.mosaikit')
    const rename = page.getByRole('dialog', { name: 'Rename the profile' })
    await page.getByRole('button', { name: 'Actions for Reader' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await rename.getByLabel('Name').fill('Viewer')
    await rename.getByLabel('Description').fill('Reads and nothing else')
    await rename.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Profile renamed').first()).toBeVisible()
    await expect(page.getByText('Reads and nothing else')).toBeVisible()
    await page.getByRole('button', { name: 'Actions for Viewer' }).click()
    await page.getByRole('menuitem', { name: 'Edit the permissions' }).click()
    const editor = page.getByTestId('profile-editor')
    await expect(editor).toContainText('Notes')
    await expect(editor).not.toContainText('com.mosaikit')
    await accessible(page, 'profile editor')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: 'Actions for Viewer' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await rename.getByLabel('Name').fill('Reader')
    await rename.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Reader', { exact: true })).toBeVisible()
  })

  test('review round 1, lists: sticky headers, thin scrollbars, sidebar, filter column, selection bar, infinite scroll, logos, avatars', async ({ page }) => {
    test.setTimeout(600_000)
    await adminLogin(page)
    /** A call of the API with the CSRF token of the session in the page. */
    const call = (method: string, path: string, body?: unknown) =>
      page.evaluate(
        async ([method, path, body]) => {
          const s = await (await fetch('api/session')).json()
          const r = await fetch(path as string, { method: method as string, headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrf }, body: body === undefined ? undefined : JSON.stringify(body) })
          return { status: r.status, json: await r.json().catch(() => null) }
        },
        [method, path, body] as const,
      )
    // more than one page of tenants
    const created: { id: string; slug: string }[] = []
    for (let n = 1; n <= 55; n++) {
      const slug = `rl-${String(n).padStart(2, '0')}`
      const r = await call('POST', 'api/admin/tenants', { slug, name: `Rl ${String(n).padStart(2, '0')}`, manager_username: 'mgr', manager_email: `mgr@${slug}.example.org`, manager_password: PASSWORD })
      expect(r.status, slug).toBe(200)
      created.push({ id: r.json.id, slug })
    }
    const sidebar = page.locator('[data-sidebar="sidebar"]').first()
    const header = page.locator('[data-tour="page-header"]')

    await test.step('R1-L-02 thin scrollbars', async () => {
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth)).toBe('thin')
    })
    await test.step('R1-L-03/04 sidebar: scrollbar only on hover, no extra space above and below the icons', async () => {
      const content = page.locator('[data-sidebar="content"]').first()
      await page.mouse.move(700, 400)
      // the thumb of the scrollbar (drawn with the webkit parts, which Edge shows as a real bar): transparent, then visible
      const thumb = () => content.evaluate((e) => getComputedStyle(e, '::-webkit-scrollbar-thumb').backgroundColor)
      const quiet = await thumb()
      await content.hover()
      const hover = await thumb()
      expect(hover).not.toBe(quiet)
      const first = await sidebar.locator('[data-sidebar="menu-button"]').first().boundingBox()
      const top = await content.boundingBox()
      expect(first!.y - top!.y).toBeLessThanOrEqual(6)
      const last = await sidebar.locator('[data-sidebar="menu-button"]').last().boundingBox()
      const bottom = await sidebar.boundingBox()
      expect(bottom!.y + bottom!.height - (last!.y + last!.height)).toBeLessThanOrEqual(10)
    })
    await test.step('R1-L-05 collapsed bar: a gap between groups', async () => {
      const toggle = page.getByRole('button', { name: 'Open or close the sidebar' }).first()
      const rail = page.locator('[data-collapsible="icon"]')
      const wasOpen = (await rail.count()) === 0
      if (wasOpen) await toggle.click()
      await expect(rail.first()).toBeAttached()
      const groups = sidebar.locator('[data-sidebar="group"]')
      // the Administrator has one group; the gap is checked with the Tenant Manager below
      if ((await groups.count()) > 1) {
        const a = await groups.nth(0).locator('[data-sidebar="menu-button"]').last().boundingBox()
        const b = await groups.nth(1).locator('[data-sidebar="menu-button"]').first().boundingBox()
        expect(b!.y - (a!.y + a!.height)).toBeGreaterThanOrEqual(8)
      }
      if (wasOpen) await toggle.click()
    })

    await page.goto('./#/admin/tenants')
    await test.step('R1-L-06 Tenants: the filter column', async () => {
      const filters = page.getByRole('complementary', { name: 'Filters' })
      await expect(filters).toBeVisible()
      await filters.getByRole('radio', { name: /Suspended/ }).click()
      await expect(page.getByText('No tenants')).toBeVisible()
      await filters.getByRole('radio', { name: /^All/ }).click()
      await page.getByRole('searchbox', { name: 'Search a tenant' }).fill('rl-07')
      await expect(page.locator('tbody tr')).toHaveCount(1)
      await filters.getByRole('button', { name: 'Reset' }).click()
      await expect(page.locator('tbody tr').nth(2)).toBeVisible()
    })
    await test.step('R1-L-07 Tenants: selection and the action bar of the header', async () => {
      await page.getByRole('checkbox', { name: 'Select Rl 01' }).check()
      await expect(header.getByText('1 selected')).toBeVisible()
      await expect(header.getByRole('button', { name: 'Suspend' })).toBeVisible()
      await header.getByRole('checkbox', { name: 'Select all' }).click()
      await expect(header.getByText(/^\d+ selected$/)).toBeVisible()
      await header.getByRole('checkbox', { name: 'Select all' }).click()
      await expect(header.getByText(/selected$/)).toHaveCount(0)
    })
    await test.step('R1-L-12 Tenants: logo of the tenant (initials by default)', async () => {
      await expect(page.locator('tbody tr').first().locator('span.rounded-md').first()).toBeVisible()
    })
    await test.step('R1-L-09 infinite scroll', async () => {
      await expect(page.getByText(/^50 of \d+$/)).toBeVisible()
      // the page does not scroll: the list does, and its foot loads the next page as it comes into view
      await page.evaluate(() => {
        const l = document.querySelector('[data-listscroll]')!
        l.scrollTop = l.scrollHeight
      })
      await expect(page.getByText(/^(\d+) of \1$/)).toBeVisible({ timeout: 15_000 })
    })
    await test.step('R1-L-01 headers and filters stay in sight while the page scrolls', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      const box = await header.boundingBox()
      expect(box!.y).toBeGreaterThanOrEqual(45)
      expect(box!.y).toBeLessThanOrEqual(56)
      const aside = await page.getByRole('complementary', { name: 'Filters' }).boundingBox()
      expect(aside!.y).toBeGreaterThanOrEqual(90)
      expect(aside!.y).toBeLessThanOrEqual(140)
    })
    await test.step('R1-L-14 the logo (initials) next to the name in the tenant header', async () => {
      await page.goto(`./#/admin/tenants/${created[0].id}`)
      await expect(header.locator('span.size-10')).toBeVisible()
    })
    await test.step('R1-L-15 Italian: Organizzazioni; English: Tenants', async () => {
      await expect(page.getByRole('link', { name: 'Tenants', exact: true }).first()).toBeVisible()
      await page.evaluate(() => localStorage.setItem('msk_lang', 'it'))
      await page.goto('./#/admin/tenants')
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Organizzazioni' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Organizzazioni', exact: true }).first()).toBeVisible()
      await page.evaluate(() => localStorage.setItem('msk_lang', 'en'))
      await page.reload()
    })
    await test.step('R1-L-08 hierarchical list indented (System)', async () => {
      await page.goto('./#/admin/system')
      const nav = page.getByRole('navigation', { name: 'Sections' })
      const heading = await nav.getByText('Platform', { exact: true }).boundingBox()
      const link = await nav.getByRole('link', { name: 'Administrators' }).locator('span').first().boundingBox()
      expect(link!.x).toBeGreaterThan(heading!.x + 8)
    })
    await test.step('R1-L-13 avatars in the list of people', async () => {
      await page.goto('./#/admin/people')
      await expect(page.locator('tbody tr').first().locator('span.rounded-full').first()).toBeVisible()
    })
    // clean up: the tenants of this test
    for (const c of created) expect((await call('POST', `api/admin/tenants/${c.id}/delete`, { confirm: c.slug })).status, c.slug).toBe(200)
    await logout(page)

    await login(page, 'Alfa', 'manager', PASSWORD)
    await test.step('R1-L-10/13 Manage › People: a row opens the person; avatars', async () => {
      await page.goto('./#/t/alfa/manage')
      const row = page.locator('tbody tr').first()
      await expect(row.locator('span.rounded-full').first()).toBeVisible()
      await row.locator('td').nth(4).click()
      await expect(page).toHaveURL(/#\/t\/alfa\/person\//)
    })
    await test.step('R1-L-11 Plugins: the button is called Permissions', async () => {
      await page.goto('./#/t/alfa/plugins')
      await expect(page.getByRole('button', { name: 'Permissions' }).first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Access and permissions' })).toHaveCount(0)
    })
    await test.step('R1-L-16 sidebar tree: nested pages indented, flyout with the collapsed bar', async () => {
      const nav = page.locator('[data-sidebar="sidebar"]').first()
      const toggle = page.getByRole('button', { name: 'Open or close the sidebar' }).first()
      // start from the open sidebar
      if ((await page.locator('[data-collapsible="icon"]').count()) > 0) await toggle.click()
      await expect(page.locator('[data-collapsible="icon"]')).toHaveCount(0)
      await nav.getByRole('button', { name: 'Open the pages of Notes' }).click()
      const parent = await nav.getByRole('link', { name: 'Notes', exact: true }).first().locator('span').first().boundingBox()
      const child = await nav.getByRole('link', { name: 'Mine', exact: true }).locator('span').first().boundingBox()
      expect(child!.x).toBeGreaterThanOrEqual(parent!.x)
      await toggle.click()
      await expect(page.locator('[data-collapsible="icon"]').first()).toBeAttached()
      // R1-L-05 for the Tenant Manager: a gap between the groups of the collapsed bar
      const groups = nav.locator('[data-sidebar="group"]')
      expect(await groups.count()).toBeGreaterThan(1)
      const g0 = await groups.nth(0).locator('[data-sidebar="menu-button"]').last().boundingBox()
      const g1 = await groups.nth(1).locator('[data-sidebar="menu-button"]').first().boundingBox()
      expect(g1!.y - (g0!.y + g0!.height)).toBeGreaterThanOrEqual(8)
      await page.getByRole('button', { name: 'Open the pages of Notes' }).click()
      await expect(page.getByRole('menuitem', { name: 'Mine' })).toBeVisible()
      await page.keyboard.press('Escape')
      await toggle.click()
    })
    await logout(page)
  })
  test('Review round 1, overview: widgets of the Home, of the Tenant Manager and of the Administrator; filter column and selection bar of the Manager', async ({ page }) => {
    test.setTimeout(300_000)
    /** A call of the API with the CSRF token of the session in the page. */
    const call = (method: string, path: string, body?: unknown) =>
      page.evaluate(
        async ([method, path, body]) => {
          const s = await (await fetch('api/session')).json()
          const r = await fetch(path as string, { method: method as string, headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrf }, body: body === undefined ? undefined : JSON.stringify(body) })
          return { status: r.status, json: await r.json().catch(() => null) }
        },
        [method, path, body] as const,
      )
    /** The page in light, dark and high contrast without serious violations; then the phone without a horizontal scroll. */
    const everywhere = async (where: string) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.emulateMedia({ colorScheme: 'light' })
      await accessible(page, `${where}, light`)
      await page.emulateMedia({ colorScheme: 'dark' })
      await colorsSettled(page)
      await accessible(page, `${where}, dark`)
      await page.emulateMedia({ colorScheme: 'light' })
      await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'more'))
      await accessible(page, `${where}, high contrast`)
      await page.evaluate(() => document.documentElement.removeAttribute('data-contrast'))
      await page.setViewportSize({ width: 390, height: 800 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${where}: phone`).toBe(true)
      await page.setViewportSize({ width: 1280, height: 800 })
    }

    await adminLogin(page)
    await test.step('R1-O-03 Administrator: figures, services, to do, tenants by storage, requests, notifications, recent errors', async () => {
      await page.goto('./#/admin')
      await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible()
      for (const name of ['Services', 'To do', 'Tenants by storage used', 'Requests', 'For you', 'Recent errors']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
      await expect(page.getByText('Figures of every tenant as of')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()
      await everywhere('administrator overview')
    })
    await test.step('R1-O-05 Italian titles of the widgets', async () => {
      await page.evaluate(() => localStorage.setItem('msk_lang', 'it'))
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Errori recenti', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Organizzazioni per spazio usato', exact: true })).toBeVisible()
      await page.evaluate(() => localStorage.setItem('msk_lang', 'en'))
      await page.reload()
    })
    // a tenant of its own, so that the test also runs alone
    expect((await call('POST', 'api/admin/tenants', { slug: 'ovw', name: 'Overview Tenant', manager_username: 'mgr', manager_email: 'mgr@ovw.example.org', manager_password: PASSWORD })).status).toBe(200)
    await logout(page)

    // a person of the tenant, for the Home of the User
    await login(page, 'Overview Tenant', 'mgr', PASSWORD)
    expect((await call('POST', 'api/t/ovw/manage/members', { username: 'ov-user', display_name: 'Ov User', email: 'ov-user@ovw.example.org', password: PASSWORD, role: 'user' })).status).toBe(200)

    await test.step('R1-O-02 Tenant Manager: waiting for you, active people, recent activity, notifications, usage, compact apps', async () => {
      await page.goto('./#/t/ovw')
      await expect(page.getByRole('heading', { name: 'Tenant overview' })).toBeVisible()
      for (const name of ['Waiting for you', 'Active people', 'Recent activity', 'For you']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
      const strip = page.getByRole('navigation', { name: 'Your apps' })
      await expect(strip.getByRole('button', { name: 'Notes' })).toBeVisible()
      // compact: chips, not cards
      expect((await strip.boundingBox())!.height).toBeLessThan(80)
      await expect(page.getByRole('heading', { name: 'Your space' })).toBeVisible()
      await everywhere('tenant manager overview')
    })

    await test.step('R1-O-07 Manage › People: the sections and the filters in the filter column, the selection in the header', async () => {
      await page.goto('./#/t/ovw/manage')
      const facets = page.getByRole('complementary', { name: 'Filters' })
      await expect(facets.getByRole('radiogroup', { name: 'Show' })).toBeVisible()
      await page.getByRole('searchbox', { name: 'Search by name or username' }).fill('ov-user')
      await expect(page.locator('tbody tr')).toHaveCount(1)
      await page.locator('tbody tr').first().getByRole('checkbox').click()
      const bar = page.getByRole('group', { name: 'Actions on the selection' })
      await expect(bar.getByText('1 selected')).toBeVisible()
      await expect(bar.getByRole('button', { name: 'Make Tenant Manager' })).toBeVisible()
      await accessible(page, 'manage people with a selection')
      await facets.getByRole('radio', { name: /^Groups/ }).click()
      await expect(page).toHaveURL(/manage\/groups/)
      await expect(page.getByRole('searchbox', { name: 'Search a group' })).toBeVisible()
    })
    await test.step('R1-O-08 Shares and Trash: filter column and selection bar', async () => {
      await page.goto('./#/t/ovw/shares')
      const facets = page.getByRole('complementary', { name: 'Filters' })
      await expect(facets.getByRole('radio', { name: /^All items/ })).toBeVisible()
      await facets.getByRole('radio', { name: /^All items/ }).click()
      await expect(page.getByRole('group', { name: 'Actions on the selection' })).toBeAttached()
      await page.goto('./#/t/ovw/trash')
      await expect(page.getByRole('complementary', { name: 'Filters' }).getByRole('searchbox', { name: 'Search in the trash' })).toBeVisible()
      await accessible(page, 'trash with the filter column')
    })
    await test.step('R1-O-09 Trash, Shared by me, Invitations and the log of the widgets come in pages from the server', async () => {
      const shared = await call('GET', 'api/t/ovw/me/shared?limit=1')
      expect(shared.json).toHaveProperty('total')
      expect(shared.json).toHaveProperty('next')
      const trash = await call('GET', 'api/t/ovw/trash?limit=1')
      expect(trash.json).toMatchObject({ items: expect.any(Array), total: expect.any(Number) })
      expect(trash.json.items.length).toBeLessThanOrEqual(1)
      const inv = await call('GET', 'api/t/ovw/manage/invitations?limit=1')
      expect(inv.json).toMatchObject({ items: expect.any(Array), total: expect.any(Number), pending: expect.any(Number) })
      const log = await call('GET', 'api/t/ovw/manage/log?limit=2')
      expect(log.json.events.length).toBeLessThanOrEqual(2)
    })
    await logout(page)

    await login(page, 'Overview Tenant', 'ov-user', PASSWORD)
    await test.step('R1-O-01 User: Home with the apps as chips, pick up, due soon, for you, recent activity and shared by me', async () => {
      await page.goto('./#/t/ovw')
      await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Your apps' })).toBeVisible()
      for (const name of ['Pick up where you left off', 'Due soon', 'For you']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Shared by me' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Waiting for you' })).toHaveCount(0)
      await everywhere('user home')
    })
    await logout(page)
  })
})
