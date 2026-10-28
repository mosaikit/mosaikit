import { expect, test } from '@playwright/test'
import { PASSWORD, NEW_PASSWORD, BASE, adminLogin, fresh, login, logout, nav, createTenant, accessible } from './support'

// People and permissions, sign-in and groups through the identity provider. Runs in order after the previous file (the state of the installation is shared).

test.describe.serial('06-people-oidc', () => {
  test('people and permissions: profiles, permissions of a plugin, access requests, every person', async ({ page }) => {
    // two sign-ins of the Administrator may wait for a new code of the second factor
    test.setTimeout(240_000)
    const note = async (title: string) =>
      page.evaluate(
        async ([base, title]) => {
          const s = await (await fetch(`${base}/api/session`)).json()
          const r = await fetch(`${base}/api/t/alfa/p/com.mosaikit.notes/r/notes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrf },
            body: JSON.stringify({ values: { title } }),
          })
          const j = await r.json()
          return { status: r.status, id: j.id as string, code: j.code as string }
        },
        [BASE, title],
      )
    // the Tenant Manager: a profile that may only open Notes, given to Anna
    await login(page, 'Alfa Municipality', 'manager', PASSWORD)
    await nav(page, 'Manage').click()
    await page.getByRole('radio', { name: /Permission profiles/ }).click()
    await expect(page.getByText('The permissions every plugin gives by default.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'New profile' }).click()
    const d = page.getByRole('dialog', { name: 'New profile' })
    await d.getByLabel('Name').fill('Reader')
    await d.getByRole('button', { name: 'Create profile' }).click()
    await expect(page.getByText('Reader', { exact: true })).toBeVisible()
    await accessible(page, 'permission profiles')
    await nav(page, 'Plugins').click()
    await page.getByRole('row', { name: /^Notes/ }).getByRole('button', { name: 'Permissions', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Access and permissions · Notes' })).toBeVisible()
    for (const perm of ['Create items', 'Delete items', 'Share items']) await page.getByRole('checkbox', { name: `Reader: ${perm}` }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Permissions saved').last()).toBeVisible()
    await accessible(page, 'permissions of a plugin')
    await nav(page, 'Manage').click()
    await page.getByRole('link', { name: 'Anna Rossi' }).click()
    await expect(page.getByRole('heading', { name: 'Anna Rossi' })).toBeVisible()
    await page.getByRole('combobox', { name: 'Permission profile' }).click()
    await page.getByRole('option', { name: 'Reader' }).click()
    await expect(page.getByText('Profile updated').last()).toBeVisible()
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Permissions' }).click()
    const notes = page.getByRole('list', { name: 'Permissions in Notes' })
    await expect(notes.getByRole('listitem').filter({ hasText: 'Create items' })).toHaveAttribute('data-granted', 'false')
    await expect(notes.getByRole('listitem').filter({ hasText: 'Use the app' })).toContainText('Profile Reader')
    await accessible(page, 'person, permissions')
    // a note of the manager, which Anna cannot see
    const budget = await note('Budget plan')
    expect(budget.status).toBe(201)
    await logout(page)

    // Anna: no new notes any more; she asks to see the note of the manager
    await login(page, 'Alfa Municipality', 'anna', NEW_PASSWORD)
    const denied = await note('Not allowed')
    expect(`${denied.status} ${denied.code}`).toBe('403 missing_permission')
    await page.goto(`./#/t/alfa/item/${budget.id}`)
    await expect(page.getByRole('heading', { name: 'You cannot see this item' })).toBeVisible()
    await page.getByLabel('Message (optional)').fill('For the meeting')
    await page.getByRole('button', { name: 'Send the request' }).click()
    await expect(page.getByText('Request sent: you will get a notification with the answer.')).toBeVisible()
    await accessible(page, 'request of access')
    await logout(page)

    // the Tenant Manager approves it from Pending
    await login(page, 'Alfa Municipality', 'manager', PASSWORD)
    await nav(page, 'Manage').click()
    await page.getByRole('radio', { name: /Pending/ }).click()
    const req = page.getByRole('table', { name: 'Access requests' }).getByRole('row', { name: /Budget plan/ })
    await expect(req).toContainText('Anna Rossi')
    await accessible(page, 'pending')
    await req.getByRole('button', { name: 'Approve' }).click()
    await expect(page.getByText('Access given').last()).toBeVisible()
    await logout(page)

    // the Administrator: every person, the tenants of Anna, a link to choose a new password
    await adminLogin(page)
    await nav(page, 'People').click()
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
    await accessible(page, 'people of the platform')
    await page.getByRole('link', { name: /Anna Rossi/ }).click()
    const tabs = page.getByRole('navigation', { name: 'Tabs' })
    await tabs.getByRole('link', { name: /Tenants/ }).click()
    await expect(page.getByRole('row', { name: /Alfa/ })).toContainText('home')
    await accessible(page, 'person, tenants')
    await tabs.getByRole('link', { name: 'Sign-in' }).click()
    await page.getByRole('button', { name: 'Send the password link' }).click()
    const link = await page.getByLabel('Link', { exact: true }).inputValue()
    await page.getByRole('button', { name: 'Done' }).click()
    await logout(page)
    await page.goto(link)
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    await page.getByLabel('New password', { exact: true }).fill('password-e2e-789')
    await page.getByLabel('Repeat the new password').fill('password-e2e-789')
    await page.getByRole('button', { name: 'Save the new password' }).click()
    await expect(page.getByText('Done: sign in with the new password.')).toBeVisible()
    await accessible(page, 'new password')
    // Anna signs in with it and now opens the note in its app
    await login(page, 'Alfa Municipality', 'anna', 'password-e2e-789')
    await page.goto(`./#/t/alfa/item/${budget.id}`)
    await expect(page).toHaveURL(/#\/t\/alfa\/p\/com\.mosaikit\.notes\//)
  })

  test('sign-in through the identity provider of a tenant (OIDC)', async ({ page }) => {
    // the test identity provider started by `cargo xtask e2e` (mosaikit-fake-idp)
    const idp = process.env.E2E_IDP_URL ?? 'http://127.0.0.1:18082'
    test.setTimeout(240_000)
    await adminLogin(page)
    await nav(page, 'Tenants').click()
    await createTenant(page, 'omega', 'City of Omega')
    await page.getByRole('link', { name: 'City of Omega' }).click()
    await page.getByRole('link', { name: 'Sign-in', exact: true }).click()
    await page.getByRole('radio', { name: /Identity provider \(OIDC\)/ }).check()
    await page.getByLabel('Address of the provider (issuer)').fill(idp)
    await page.getByLabel('Client id').fill('mosaikit')
    await page.getByLabel('Client secret').fill('fake-secret')
    await page.getByLabel('Text of the button').fill('Test provider')
    await page.getByRole('radio', { name: /Groups of the identity provider/ }).check()
    await page.getByLabel('Groups of the Tenant Managers').fill('mosaikit-managers')
    await page.getByLabel('Groups of the Users').fill('mosaikit-users')
    await page.getByRole('button', { name: 'Check the configuration' }).click()
    await expect(page.getByRole('list', { name: 'Result of the check' })).toContainText('Discovery document')
    await expect(page.getByRole('list', { name: 'Result of the check' }).getByLabel('Error')).toHaveCount(0)
    await accessible(page, 'sign-in of the tenant')
    await page.getByRole('button', { name: 'Save' }).click()
    // the first Tenant Manager is a local account: it can no longer sign in
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByText('Sign-in saved').last()).toBeVisible()
    await logout(page)

    // the sign-in page of the tenant shows the button of the provider, not the password
    await fresh(page, '#/login/omega')
    const button = page.getByRole('link', { name: 'Sign in with Test provider' })
    await expect(button).toBeVisible()
    await expect(page.getByLabel('Password')).toBeHidden()
    await accessible(page, 'sign-in through the provider')

    // Anna is in the group of the managers: Tenant Manager, account created at the first sign-in
    await button.click()
    await page.getByRole('button', { name: 'Sign in as Anna Rossi' }).click()
    await expect(page.getByRole('button', { name: /person menu/ })).toBeVisible()
    await expect(nav(page, 'Manage')).toBeVisible()
    await page.goto('./#/t/omega/account/security')
    await expect(page.getByText('Identity provider of the tenant (OIDC)')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Change password' })).toBeHidden()
    await accessible(page, 'account of a person of the provider')
    // signing out goes through the end-session endpoint of the provider and back to the sign-in
    await page.getByRole('button', { name: /person menu/ }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

    // Carla is in no allowed group: back on the sign-in page with the reason, never a code
    await fresh(page, '#/login/omega')
    await page.getByRole('link', { name: 'Sign in with Test provider' }).click()
    await page.getByRole('button', { name: 'Sign in as Carla Bassi' }).click()
    await expect(page.getByText('Your account of the provider is not in a group allowed in this tenant')).toBeVisible()
    await expect(page.getByText('oidc_no_role')).toBeHidden()
  })

  test('OIDC: groups of the provider in the tenant, a share to one of them, front-channel logout', async ({ page, context }) => {
    const idp = process.env.E2E_IDP_URL ?? 'http://127.0.0.1:18082'
    test.setTimeout(240_000)
    // the Administrator turns the mirror of the groups on for the tenant of the provider
    await adminLogin(page)
    await nav(page, 'Tenants').click()
    await page.getByRole('link', { name: 'City of Omega' }).click()
    await page.getByRole('link', { name: 'Sign-in', exact: true }).click()
    await expect(page.getByText('Front-channel logout address')).toBeVisible()
    await page.getByRole('switch', { name: /Groups of the provider in Mosaikit/ }).click()
    await expect(page.getByLabel('Only the groups starting with')).toBeVisible()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Sign-in saved').last()).toBeVisible()
    await logout(page)

    const viaProvider = async (who: string) => {
      await fresh(page, '#/login/omega')
      await page.getByRole('link', { name: 'Sign in with Test provider' }).click()
      await page.getByRole('button', { name: `Sign in as ${who}` }).click()
      await expect(page.getByRole('button', { name: /person menu/ })).toBeVisible()
    }
    // Bruno (groups mosaikit-users and staff) signs in first, then Anna, the Tenant Manager
    await viaProvider('Bruno Neri')
    await page.getByRole('button', { name: /person menu/ }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await viaProvider('Anna Rossi')
    await page.goto('./#/t/omega/manage/groups')
    const staff = page.locator('[data-slot="card"]', { hasText: 'staff' }).first()
    await expect(staff).toContainText('From the identity provider')
    await expect(staff).toContainText('Bruno Neri')
    await expect(staff).toContainText('Anna Rossi')
    // read-only: no add, no delete, no removal of a member
    await expect(page.getByRole('button', { name: 'Delete the group staff' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Remove bruno.neri from the group' })).toHaveCount(0)
    await accessible(page, 'groups of the provider')

    // a note shared with the group of the provider
    await nav(page, 'Notes').click()
    const frame = page.frameLocator('iframe.plugin-frame')
    await frame.locator('[data-key="title"]').fill('Plan of the staff')
    await frame.getByRole('button', { name: 'Save' }).click()
    await expect(frame.locator('.msk-item', { hasText: 'Plan of the staff' })).toBeVisible()
    await frame.getByRole('button', { name: 'Share…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Sharing' })
    await dialog.getByLabel('Search people or groups').fill('staff')
    await dialog.getByRole('option', { name: /staff/ }).click()
    await dialog.getByRole('button', { name: 'Share', exact: true }).click()
    await expect(dialog.getByRole('list', { name: 'Shared with' })).toContainText('staff')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: /person menu/ }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

    // Bruno sees it through the group
    await viaProvider('Bruno Neri')
    await nav(page, 'Notes').click()
    await expect(page.frameLocator('iframe.plugin-frame').locator('.msk-item', { hasText: 'Plan of the staff' })).toBeVisible()

    // front-channel logout: the provider ends its session and frames the address of Mosaikit
    const provider = await context.newPage()
    await provider.goto(`${idp}/logout`)
    await expect(provider.getByRole('heading', { name: 'Signed out' })).toBeVisible()
    const frameEl = provider.locator('iframe')
    await expect(frameEl).toHaveAttribute('src', /\/api\/auth\/oidc\/omega\/frontchannel-logout\?iss=/)
    await expect(provider.frameLocator('iframe').getByText('Signed out of Mosaikit.')).toBeVisible()
    await provider.close()
    // the session of Mosaikit is over
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

})
