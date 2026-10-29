import { expect, test } from '@playwright/test'
import { PASSWORD, adminLogin, login, logout, nav, accessible } from './support'

// Notifications: live bell, page, preferences, mail server. Runs in order after the previous file (the state of the installation is shared).

test.describe.serial('03-notifications', () => {
  test('notifications: live bell, page, preferences and the mail server', async ({ browser }) => {
    // the Tenant Manager of Alfa adds Bruno, who signs in and keeps the page open
    const mgr = await (await browser.newContext()).newPage()
    await login(mgr, 'City of Alfa', 'manager', PASSWORD)
    await nav(mgr, 'Manage').click()
    await mgr.getByRole('button', { name: 'New user' }).click()
    const d = mgr.getByRole('dialog', { name: 'New user' })
    await d.getByLabel('Username').fill('bruno')
    await d.getByLabel('Display name').fill('Bruno Bianchi')
    await d.getByLabel('Email', { exact: true }).fill('bruno@example.org')
    await d.getByLabel('Initial password').fill(PASSWORD)
    await d.getByRole('button', { name: 'Create user' }).click()
    await expect(mgr.getByRole('row', { name: /Bruno Bianchi/ })).toBeVisible()
    await logout(mgr)

    const bruno = await (await browser.newContext()).newPage()
    await login(bruno, 'City of Alfa', 'bruno', PASSWORD)
    await expect(bruno.getByTestId('bell-badge')).toBeHidden()

    // the Tenant Manager of Beta invites him: the bell of Bruno updates without reloading
    await login(mgr, 'City of Beta', 'manager', PASSWORD)
    // the answer of Anna to the invitation of an earlier test is still unread: start from an empty bell
    await expect(mgr.getByTestId('bell-badge')).toHaveText('1', { timeout: 15000 })
    await mgr.getByRole('button', { name: /^Notifications/ }).click()
    await mgr.getByRole('dialog').getByRole('button', { name: 'Mark all as read' }).click()
    await mgr.keyboard.press('Escape')
    await expect(mgr.getByTestId('bell-badge')).toBeHidden()
    await nav(mgr, 'Manage').click()
    await mgr.getByRole('radio', { name: /Pending/ }).click()
    await mgr.getByRole('button', { name: 'Invite people' }).first().click()
    const inv = mgr.getByRole('dialog', { name: 'Invite a person of another tenant' })
    await inv.getByLabel('Home tenant').fill('alfa')
    await inv.getByLabel('Username').fill('bruno')
    await inv.getByRole('button', { name: 'Send the invitation' }).click()
    await expect(bruno.getByTestId('bell-badge')).toHaveText('1', { timeout: 15000 })

    // accepted from the panel: the badge goes away, Beta is in the switcher
    await bruno.getByRole('button', { name: /^Notifications/ }).click()
    const panel = bruno.getByRole('dialog')
    await expect(panel).toContainText('invited you to City of Beta')
    await accessible(bruno, 'panel of the notifications')
    await panel.getByRole('button', { name: 'Accept' }).click()
    await bruno.keyboard.press('Escape')
    await expect(bruno.getByTestId('bell-badge')).toBeHidden()
    await expect(bruno.getByRole('button', { name: /^Tenant: / })).toBeVisible()

    // who invited is told, live too; on the page: selection and «Mark as read»
    await expect(mgr.getByTestId('bell-badge')).toHaveText('1', { timeout: 15000 })
    await mgr.getByRole('button', { name: /^Notifications/ }).click()
    await mgr.getByRole('dialog').getByRole('button', { name: 'See all' }).click()
    await expect(mgr.getByRole('heading', { name: 'Notifications' })).toBeVisible()
    const title = 'Bruno Bianchi accepted the invitation to City of Beta'
    await expect(mgr.getByText(title)).toBeVisible()
    await expect(mgr.getByRole('group', { name: 'Actions on the selection' })).toBeHidden()
    await mgr.getByRole('checkbox', { name: `Select: ${title}` }).click()
    await accessible(mgr, 'notifications page')
    await mgr.getByRole('group', { name: 'Actions on the selection' }).getByRole('button', { name: 'Mark as read' }).click()
    await expect(mgr.getByText('All read')).toBeVisible()
    await expect(mgr.getByTestId('bell-badge')).toBeHidden()
    // the filters: nothing unread, nothing shared
    await mgr.getByRole('radio', { name: /Unread/ }).click()
    await expect(mgr.getByText('Nothing to read')).toBeVisible()
    await logout(mgr)

    // what Bruno receives by email
    await bruno.getByRole('button', { name: /person menu/ }).click()
    await bruno.getByRole('menuitem', { name: 'Account' }).click()
    await bruno.getByRole('link', { name: 'Notifications', exact: true }).click()
    await bruno.getByLabel('Email address').fill('bruno@example.org')
    await bruno.getByRole('combobox', { name: 'Emails' }).click()
    await bruno.getByRole('option', { name: 'At once' }).click()
    await bruno.getByRole('checkbox', { name: 'Public links: by email' }).click()
    await accessible(bruno, 'account, notifications')
    await bruno.getByRole('button', { name: 'Save' }).click()
    await expect(bruno.getByText('Preferences saved')).toBeVisible()
    await bruno.reload()
    await expect(bruno.getByLabel('Email address')).toHaveValue('bruno@example.org')
    await expect(bruno.getByRole('combobox', { name: 'Emails' })).toContainText('At once')
    await logout(bruno)

    // the mail server of the platform: saved without showing the password; a test to a server that does
    // not answer shows its error
    await adminLogin(mgr)
    await nav(mgr, 'System').click()
    await mgr.getByRole('link', { name: 'Email', exact: true }).click()
    await expect(mgr.getByText('Not set')).toBeVisible()
    await mgr.getByLabel('SMTP server').fill('127.0.0.1')
    await mgr.getByLabel('Port', { exact: true }).fill('1')
    await mgr.getByRole('combobox', { name: 'Security' }).click()
    await mgr.getByRole('option', { name: 'None' }).click()
    await mgr.getByLabel('Password', { exact: true }).fill('secret-of-the-server')
    await mgr.getByLabel('Sender').fill('Mosaikit <noreply@example.org>')
    await accessible(mgr, 'system, email')
    await mgr.getByRole('button', { name: 'Save' }).click()
    await expect(mgr.getByText('Ready', { exact: true })).toBeVisible()
    await expect(mgr.getByLabel('Password', { exact: true })).toHaveValue('')
    await mgr.getByLabel('To', { exact: true }).fill('admin@example.org')
    await mgr.getByRole('button', { name: 'Send a test' }).click()
    // a readable reason with the address, never the text of the operating system (QA F4)
    await expect(mgr.getByRole('alert').filter({ hasText: 'The mail server refuses the connection (127.0.0.1:1)' })).toBeVisible()
    await logout(mgr)
  })

})
