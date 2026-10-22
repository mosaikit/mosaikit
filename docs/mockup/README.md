<!-- SPDX-FileCopyrightText: 2026 Massimo Antonini -->
<!-- SPDX-License-Identifier: MPL-2.0 -->

# Mosaikit mockup

A static, clickable mockup of the shell of Mosaikit: the frame every installation has (top band,
sidebar, search, language, mode, help, notifications, person menu), the sign-in, the pages of people
and of the tenant, the pages of the platform administrator, and the generic dialogs. It shows what
the shell does, not how it is built: everything is fake, nothing is sent anywhere.

The layout follows [`../refactoring-ui.md`](../refactoring-ui.md): every thing has one home. Work
(the apps) and the management of the tenant or of the platform are in the sidebar; what is personal
(Account, Notifications, Trash) is in the menu of the person; elsewhere there are only links to that
home. The words are the ones of its glossary: tenant, Tenant Manager, plugin (of kind App, Service
or Extension), Account, permission profile, Tenant settings, System, log, identity provider (OIDC).

The apps are four neutral samples, **Notes**, **Activities**, **Estimates** and **Tasks**, standing
for whatever plugins an installation has. Their entries in the sidebar are greyed: their pages
belong to the apps, not to this mockup. Products built on Mosaikit keep mockups of their own
pages, in the same frame, in their own repositories.

## How to open it

Open [`index.html`](index.html) with a double click: no build and no server are needed (it also
works from any static server, for example `npx serve docs/mockup`). The only external resource is a
font.

At the top, the review bar, which is not part of the product:

- **Sign-in** and the three roles: Administrator, Tenant Manager and User. The sign-in page also
  has sample accounts, one per case.
- The **screen id** of what is on screen (click it to copy it).
- **Mark reviewed** and **Index**: the index lists every screen and dialog of the role, with its
  id, and keeps a count of the reviewed ones in this browser.
- **Notes**: what the screen is for and what the role sees.

Files: `index.html`, `mockup.css` (tokens, components, frame), `kit.js` (icons, page frames and the
marks of inherited settings), `data.js` (sample data), `screens.js` (sign-in, Home, Account and the
pages of the tenant), `platform.js` (administrator, settings, appearance), `shell.js` (frame,
menus, generic dialogs, review bar, events).

## Conventions of the pages

- **Anatomy**: breadcrumb, title with the state as a badge, one primary action on the right, the
  other actions and the change of state in «⋯».
- **Sections or tabs**: settings pages (Account, Manage, Tenant settings, System) have the list of
  sections on the left; the detail of an object (person, group, tenant, plugin) has tabs.
- **Saving**: the bar «Unsaved changes · Cancel · Save» shows only after a change.
- **Selection**: the actions on the selection show only when something is selected.
- **Inherited settings**: three marks, the same everywhere: *managed by the administrator* (lock,
  read only), *with a limit* (only stricter than the platform), *inherited from the platform* or
  *customized* (with «Customize» and «Restore»). In System each default says whether tenants may
  customize it.
- **Top bar**: the administrator decides, for everybody, whether it shows the logo and name of the
  application (without it the button of the sidebar takes the corner), the search, the language,
  the help (without it its entries go to the menu of the person) and the mode. The bell, the person
  and the switcher of tenants are always there.
- **Plugins** receive language, theme and mode when they start and at every change, also when the
  corresponding control of the band is hidden.

## Screen ids

Every screen has a stable id, `mosaikit:<screen>`; a tab or a section adds `/<tab>`. Dialogs are
`mosaikit:dlg-<name>`. A requirement cites the screens it realizes in its `ui` field, for example
`ui: [mosaikit:members/groups]` (see [`requirement.schema.json`](../../requirements/requirement.schema.json)).
Ids do not change when labels do; a screen that goes away keeps its id retired. Some ids keep an
older word (`organizations`, `modules`, `splugins`, `marketplace`, `audit`): the label is what the
glossary says.

Roles: A administrator, M Tenant Manager, U user.

| Id | Title | Roles | What it shows |
|---|---|---|---|
| `mosaikit:login` | Sign-in | all | Two doors. People: the tenant from a list (hidden with one tenant, or when the address names it), then username and password or the identity provider of the tenant (OIDC). Administrators (`#/admin`): local password and second factor (TOTP), the first time with the registration of the app and the recovery codes. |
| `mosaikit:home` | Home | U | The launcher: one tile per app, items to pick up again, what is due, what concerns you, what you shared. |
| `mosaikit:inbox` | Notifications | A M U | Mentions, access, due dates and alerts of every app, with filters. The bell opens the latest ones. |
| `mosaikit:account/profile` | Account · profile | A M U | Image and details of the person. |
| `mosaikit:account/security` | Account · sign-in and security | A M U | How one signs in, the change of one's own password (local accounts and administrators), the second factor, sessions, personal access tokens. |
| `mosaikit:account/notifications` | Account · notifications | A M U | What one receives, in the app and by email, and how often. |
| `mosaikit:account/appearance` | Account · appearance and language | A M U | Mode, high contrast, language and sidebar, for oneself. |
| `mosaikit:account/tenants` | Account · your tenants | M U | Home tenant and the ones one is a guest in, with «Leave». |
| `mosaikit:account/usage` | Account · usage | M U | One's own use this month and what is left of the quotas of the tenant (there are no quotas per person). |
| `mosaikit:account/keys` | Account · keys | M U | Keys of outside services of the person. |
| `mosaikit:profile` | — | — | Retired: it is Account (`mosaikit:account/profile`). |
| `mosaikit:trash` | Trash | M U | Deleted items, kept 30 days, restored with one click. |
| `mosaikit:space` | Tenant overview | M | Decisions waiting (requests, invitations, services down, public shares), each opening where it is decided; services, recent activity, usage. |
| `mosaikit:members/people` | Manage · people | M | People of the tenant with role, permission profile, groups, state and sign-in. |
| `mosaikit:members/groups` | Manage · groups | M | Groups, their members, shares and where they come from. |
| `mosaikit:members/profiles` | Manage · permission profiles | M | Permission profiles of the tenant, permission by permission. |
| `mosaikit:members/pending` | Manage · pending | M | Access requests to decide and invitations not accepted yet. |
| `mosaikit:members/invitations` | — | — | Retired: in Manage · pending. |
| `mosaikit:members/requests` | — | — | Retired: in Manage · pending. |
| `mosaikit:person/profile` | Person · details | M A | Details, role, permission profile and groups, removal from the tenant and deletion of the account. |
| `mosaikit:person/sign-in` | Person · sign-in | M A | How the person signs in, second factor, tokens, sessions. |
| `mosaikit:person/permissions` | Person · permissions | M A | Effective permissions in the plugins with their source (read only), why an item is not visible, levels on items. |
| `mosaikit:person/activity` | Person · activity | M A | The latest events of the person, with a link to the log. |
| `mosaikit:person/organizations` | Person · tenants | A | Home tenant and the others, role and profile in each, moving the home tenant. |
| `mosaikit:person/new` | New person | A | A new person: details, required home tenant, role, profile, other tenants. |
| `mosaikit:group/settings` | Group · settings | M | Name, description, where members come from, deletion. |
| `mosaikit:group/members` | Group · members | M | Members and how they joined. |
| `mosaikit:group/shared` | Group · shared items | M | Items shared with the group and their level. |
| `mosaikit:group/modules` | Group · plugins | M | What the group adds to the profile of its members, plugin by plugin (read only). |
| `mosaikit:splugins` | Plugins | M | The plugins the administrator made available, by kind, turned on or off with their dependencies; what each extension extends. |
| `mosaikit:module` | Permissions of a plugin | M | Permissions a plugin declares, by profile, group and person: the only place where they are given. |
| `mosaikit:shares` | Shares | M | Every share of the tenant, public items and links first, with «Revoke». |
| `mosaikit:usage/quotas` | Usage · quotas | M | Quotas of the tenant (read only: set by the administrator) and their use, with what happens at the limit. |
| `mosaikit:usage/trend` | Usage · trend | M | Six months of automation minutes, storage and AI credits, with a forecast. |
| `mosaikit:usage/consumers` | Usage · who uses the most | M | Consumption by automation, by group and by person. |
| `mosaikit:usage/alerts` | Usage · alerts | M | Thresholds of the alerts and who receives them. |
| `mosaikit:usage/plan` | — | — | Retired: there are no plans. |
| `mosaikit:activity` | Log | M | Events of the tenant filtered by who, what, on what, period; detail of an event. |
| `mosaikit:platform` | Platform overview | A | Services, tenants by storage, to do, recent errors. |
| `mosaikit:tenants` | Tenants | A | Every tenant with people, storage, sign-in and state. |
| `mosaikit:tenant/details` | Tenant · details | A | Name, identifier, address, registration data, contact, the logo (read only), quotas of the platform or of the tenant, state and trial period, archive and delete. |
| `mosaikit:tenant/sign-in` | Tenant · sign-in | A | Local accounts or an external identity provider (OIDC), never both; issuer, client and button; where roles come from (Mosaikit or the groups of the provider); accounts and guests. Administrators never sign in through a tenant. |
| `mosaikit:tenant/modules` | Tenant · plugins | A | Plugins available to the tenant and whether its Tenant Manager turned them on, with a link to each plugin. |
| `mosaikit:tenant/plan` | — | — | Retired: there are no plans; quotas are in the details. |
| `mosaikit:tenant/lifecycle` | — | — | Retired. |
| `mosaikit:gusers` | People | A | Every person of the installation, with home tenant and the others. |
| `mosaikit:gusers/administrators` | People · administrators | A | Administrators of the platform: accounts of their own, local password and second factor. |
| `mosaikit:marketplace/installed` | Plugins · installed | A | Built-in and installed plugins, by kind (App, Service, Extension), versions, trust, tenants. |
| `mosaikit:marketplace/updates` | Plugins · updates | A | Updates to apply. |
| `mosaikit:marketplace/catalog` | Plugins · catalog | A | Plugins of the repositories, to install. |
| `mosaikit:mpmod/overview` | Plugin · overview | A | Description, kind, what it extends, publisher, trust, versions and release notes. |
| `mosaikit:mpmod/requests` | Plugin · what it asks | A | What it asks of the platform, what it needs, the permissions it brings. |
| `mosaikit:mpmod/extensions` | Plugin · extensions | A | The extensions of the plugin, installed and in the catalog. |
| `mosaikit:mpmod/organizations` | Plugin · tenants | A | To which tenants it is available, and whether each one turned it on. |
| `mosaikit:mpmod/configuration` | Plugin · configuration | A | Settings of the plugin at platform level. |
| `mosaikit:monitoring/status` | Monitoring · status | A | Services with state, version, response time and errors; detail of one. |
| `mosaikit:monitoring/performance` | Monitoring · performance | A | Requests, queues, sessions and response times over a period. |
| `mosaikit:monitoring/errors` | Monitoring · errors | A | Error rates and latest errors, with a link to the log. |
| `mosaikit:monitoring/organizations` | Monitoring · tenants | A | Load and nearest quota per tenant. |
| `mosaikit:monitoring/capacity` | Monitoring · capacity | A | Disk, storage, memory, CPU and queue left. |
| `mosaikit:monitoring/alerts` | Monitoring · alerts | A | Conditions that alert and who receives them. |
| `mosaikit:audit` | Log | A | Events of the whole platform, with the tenant of each. |
| `mosaikit:system/email` | System · email | A | Mail server, test message, sender and footer with a preview. |
| `mosaikit:system/addresses` | System · addresses | A | Addresses of platform and tenants, sites that may embed pages. |
| `mosaikit:system/backup` | System · backup and restore | A | Schedule, retention, latest backups, restore of all, one tenant or one item. |
| `mosaikit:system/security` | System · security | A | Minimum rules of local accounts, second factor, administrator access. |
| `mosaikit:system/keys` | System · keys | A | Keys of outside services the platform pays for, shared or not; AI assistant. |
| `mosaikit:system/retention` | System · retention | A | How long the log, notifications and runs are kept. |
| `mosaikit:system/maintenance` | System · maintenance | A | Maintenance mode and a notice for everybody. |
| `mosaikit:system/quotas` | System · quotas | A | Quotas of new tenants and capacity of the platform, with how much is given to the tenants. |
| `mosaikit:system/identity` | System · identity and appearance · identity and texts | A | Name, logos, browser icon, sign-in page. |
| `mosaikit:system/theme` | System · identity and appearance · theme and mode | A | Default theme, themes available to tenants, mode, sidebar, and whether tenants may customize each. |
| `mosaikit:system/languages` | System · identity and appearance · languages and formats | A | Languages of the platform and the default one, formats. |
| `mosaikit:system/topbar` | System · identity and appearance · top bar | A | What the band shows, for everybody, with a preview. |
| `mosaikit:config/security` | Tenant settings · security | M | Rules of the tenant, only stricter than the platform. |
| `mosaikit:config/keys` | Tenant settings · keys | M | Keys of the tenant. |
| `mosaikit:config/embedding` | Tenant settings · embedding | M | Sites of the tenant that may embed its pages, next to the ones of the platform. |
| `mosaikit:config/platform` | Tenant settings · managed by the platform | M | What the administrator decides for the tenant (sign-in, quotas, plugins available, top bar), to read. |
| `mosaikit:config/identity` | Tenant settings · identity and appearance · identity and texts | M | Name, logos, landing page, welcome and legal notes. |
| `mosaikit:config/theme` | Tenant settings · identity and appearance · theme and mode | M | Default theme among the ones offered, mode, sidebar: inherited or customized. |
| `mosaikit:config/languages` | Tenant settings · identity and appearance · languages and formats | M | Languages of the tenant (a subset of the platform) and the formats, inherited or customized. |
| `mosaikit:config/profiles` | — | — | Retired: permission profiles are in Manage (`mosaikit:members/profiles`). |
| `mosaikit:config/appearance` | — | — | Retired: it is Account (`mosaikit:account/appearance`). |
| `mosaikit:themeedit` | Theme editor | M A | A theme from colour, band and greys, with previews and the WCAG check. |
| `mosaikit:dlg-search` | Search | all | A drop-down under the search field of the band (click or Ctrl K): pills to filter by group (All, one per group, with the number of results) and the results; arrows and Enter to open, Esc or a click outside to close. Not there when the administrator hides the search. |
| `mosaikit:dlg-create` | Create | M U | One entry for each app of the tenant. |
| `mosaikit:dlg-share` | Share | M U | Subjects (person, group, tenant, link, public) and levels (view, use, edit, manage). |
| `mosaikit:dlg-invite` | Invite people | M | Email with what the platform knows of it, role, permission profile, groups, what they will be able to do. |
| `mosaikit:dlg-roles` | What each role can do | M A | The three roles and the permission profiles. |
| `mosaikit:dlg-new-group` | New group | M | Name, where members come from, first members. |
| `mosaikit:dlg-remove-person` | Remove from the tenant | M | Who gets the items of the person, what happens to the account. |
| `mosaikit:dlg-confirm` | Confirmation | M A | An action that cannot be undone, with what is lost. |
| `mosaikit:dlg-new-organization` | New tenant | A | Four steps (tenant, sign-in, Tenant Manager, summary), ending with what the platform prepares by itself. |
| `mosaikit:dlg-new-admin` | New administrator | A | An account of the platform, with a local password and the second factor. |
| `mosaikit:dlg-move-home` | Move the home tenant | A | The new home tenant and what changes for the person. |
