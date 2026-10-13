<!-- SPDX-FileCopyrightText: 2026 Massimo Antonini -->
<!-- SPDX-License-Identifier: MPL-2.0 -->

# Mosaikit mockup

A static, clickable mockup of the shell of Mosaikit: the frame every installation has (top band,
sidebar, search, appearance, help, notifications, person menu), the sign-in, the pages of people
and of the organization, the pages of the platform administrator, and the generic dialogs. It
shows what the shell does, not how it is built: everything is fake, nothing is sent anywhere.

The apps are four neutral samples, **Notes**, **Activities**, **Estimates** and **Tasks**, standing
for whatever extensions an installation has. Their entries in the sidebar are greyed: their pages
belong to the apps, not to this mockup. Products built on Mosaikit keep mockups of their own
pages, in the same frame, in their own repositories.

## How to open it

Open [`index.html`](index.html) with a double click: no build and no server are needed (it also
works from any static server, for example `npx serve docs/design/mockup`). The only external
resource is a font.

At the top, the review bar, which is not part of the product:

- **Sign-in** and the four roles: Administrator, Manager, User, and View and edit (a User with the
  View and edit profile). The sign-in page also has sample accounts, one per case.
- The **screen id** of what is on screen (click it to copy it).
- **Mark reviewed** and **Index**: the index lists every screen and dialog of the role, with its
  id, and keeps a count of the reviewed ones in this browser.
- **Notes**: what the screen is for and what the role sees.

Files: `index.html`, `mockup.css` (tokens, components, frame), `kit.js` (icons and page frames),
`data.js` (sample data), `screens.js` (sign-in, work and organization), `platform.js`
(administrator, settings, appearance), `shell.js` (frame, generic dialogs, review bar, events).

## Screen ids

Every screen has a stable id, `mosaikit:<screen>`; a tab or a section adds `/<tab>`. Dialogs are
`mosaikit:dlg-<name>`. A requirement cites the screens it realizes in its `ui` field, for example
`ui: [mosaikit:members/groups]` (see [`requirement.schema.json`](../../requirements/requirement.schema.json)).
Ids do not change when labels do; a screen that goes away keeps its id retired.

Roles: A administrator, M manager, U user, V user with the View and edit profile.

| Id | Title | Roles | What it shows |
|---|---|---|---|
| `mosaikit:login` | Sign-in | all | Three steps: email, sign-in of the home organization (single sign-on, password, second factor), choice of the workspace. |
| `mosaikit:home` | Overview | U V | The launcher: one tile per installed app, items to pick up again, what is due, what concerns you, storage. |
| `mosaikit:inbox` | Notifications | A M U V | Mentions, access, due dates and alerts of every app, with filters. |
| `mosaikit:profile` | Profile | A M U V | Image, organizations of the person, how they sign in, personal access tokens, email notifications. |
| `mosaikit:trash` | Trash | M U | Deleted items, kept 30 days, restored with one click. |
| `mosaikit:space` | Overview of the organization | M | Decisions waiting (requests, invitations, integrations down), integrations, recent activity, usage. |
| `mosaikit:members/people` | People | M | People of the organization with role, profile, groups, state and sign-in. |
| `mosaikit:members/groups` | People · groups | M | Groups, their members, shares and where they come from. |
| `mosaikit:members/invitations` | People · invitations | M | Pending invitations, sent again or cancelled. |
| `mosaikit:members/requests` | People · access requests | M | Requests for access to items: approve, forward to the owner, refuse. |
| `mosaikit:person/profile` | Person · profile | M A | Details, role, profile and groups, removal from the organization and deletion of the account. |
| `mosaikit:person/sign-in` | Person · sign-in | M A | How the person signs in, second factor, tokens, sessions. |
| `mosaikit:person/permissions` | Person · permissions | M A | Effective permissions in the modules with their source, why an item is not visible, levels on items. |
| `mosaikit:person/activity` | Person · activity | M A | The latest events of the person, with a link to the log. |
| `mosaikit:person/organizations` | Person · organizations | A | Home organization and the others, role and profile in each, moving the home organization. |
| `mosaikit:person/new` | New person | A | A new person: details, required home organization, role, profile, other organizations. |
| `mosaikit:group/settings` | Group · settings | M | Name, description, where members come from, deletion. |
| `mosaikit:group/members` | Group · members | M | Members and how they joined. |
| `mosaikit:group/shared` | Group · shared items | M | Items shared with the group and their level. |
| `mosaikit:group/modules` | Group · modules | M | What the group adds to the profile of its members, module by module. |
| `mosaikit:splugins` | Modules | M | The modules the administrator enabled, turned on or off with their dependencies. |
| `mosaikit:module` | Access and permissions of a module | M | Permissions a module declares, by profile, group and person. |
| `mosaikit:usage/quotas` | Usage · quotas | M | Quotas of the plan and their use, with what happens at the limit. |
| `mosaikit:usage/trend` | Usage · trend | M | Six months of automation minutes, storage and AI credits, with a forecast. |
| `mosaikit:usage/consumers` | Usage · who uses the most | M | Consumption by automation, by group and by person. |
| `mosaikit:usage/alerts` | Usage · alerts | M | Thresholds of the alerts and who receives them. |
| `mosaikit:usage/plan` | Usage · features of the plan | M | What the plan includes, and from which plan the rest. |
| `mosaikit:activity` | Activity log | M | Events of the organization filtered by who, what, on what, period; detail of an event. |
| `mosaikit:platform` | Platform overview | A | Services, organizations by storage, to do, recent errors. |
| `mosaikit:tenants` | Organizations | A | Every organization with plan, people, storage, sign-in and state. |
| `mosaikit:tenant/details` | Organization · details | A | Name, identifier, address, registration data, contact, state and trial period. |
| `mosaikit:tenant/sign-in` | Organization · sign-in | A | Local accounts, single sign-on or both; guests; Keycloak realm and federation. |
| `mosaikit:tenant/modules` | Organization · modules | A | Apps, services and extensions on for the organization, within its plan. |
| `mosaikit:tenant/plan` | Organization · plan | A | Plan, quotas and features, with the effects of a change before applying it. |
| `mosaikit:tenant/lifecycle` | Organization · lifecycle | A | Sessions, restore of the organization, export, archive and deletion. |
| `mosaikit:gusers` | All people | A | Every person of the installation, with home organization and the others. |
| `mosaikit:gusers/administrators` | All people · administrators | A | Administrators of the platform. |
| `mosaikit:marketplace/installed` | Marketplace · installed | A | System modules and installed extensions, versions, trust, organizations. |
| `mosaikit:marketplace/updates` | Marketplace · updates | A | Updates to apply. |
| `mosaikit:marketplace/catalog` | Marketplace · catalog | A | Extensions of the repositories, to install. |
| `mosaikit:mpmod/overview` | Module · overview | A | Description, publisher, trust, versions and release notes. |
| `mosaikit:mpmod/requests` | Module · what it asks | A | What it asks of the platform, what it needs, the permissions it brings. |
| `mosaikit:mpmod/organizations` | Module · organizations | A | Where it is on, and enabling it per organization. |
| `mosaikit:mpmod/configuration` | Module · configuration | A | Settings of the module at platform level. |
| `mosaikit:monitoring/status` | Monitoring · status | A | Services with state, version, response time and errors; detail of one. |
| `mosaikit:monitoring/performance` | Monitoring · performance | A | Requests, queues, sessions and response times over a period. |
| `mosaikit:monitoring/errors` | Monitoring · errors | A | Error rates and latest errors, with a link to the audit log. |
| `mosaikit:monitoring/organizations` | Monitoring · organizations | A | Load and nearest quota per organization. |
| `mosaikit:monitoring/capacity` | Monitoring · capacity | A | Disk, storage, memory, CPU and queue left. |
| `mosaikit:monitoring/alerts` | Monitoring · alerts | A | Conditions that alert and who receives them. |
| `mosaikit:audit` | Audit log | A | Events of the whole platform, with the organization of each. |
| `mosaikit:system/email` | System · email | A | Mail server, test message, sender and footer with a preview. |
| `mosaikit:system/addresses` | System · addresses | A | Addresses of platform and organizations, sites that may embed pages. |
| `mosaikit:system/backup` | System · backup and restore | A | Schedule, retention, latest backups, restore of all, one organization or one item. |
| `mosaikit:system/security` | System · security | A | Minimum rules of local accounts, second factor, emergency access. |
| `mosaikit:system/keys` | System · keys | A | Keys of outside services the platform pays for, shared or not; AI assistant. |
| `mosaikit:system/retention` | System · retention | A | How long logs, notifications and runs are kept. |
| `mosaikit:system/maintenance` | System · maintenance | A | Maintenance mode and a notice for everybody. |
| `mosaikit:system/identity` | System · identity and texts | A | Name, logos, browser icon, sign-in page, formats of the platform. |
| `mosaikit:system/theme` | System · theme and mode | A | Default theme, themes available to organizations, mode, sidebar. |
| `mosaikit:system/languages` | System · languages and formats | A | Languages of the platform and the default one, formats. |
| `mosaikit:config/keys` | Settings · keys | M U V | Keys of the organization (manager) or of the person. |
| `mosaikit:config/security` | Settings · security | M | Rules of the organization, only stricter than the platform. |
| `mosaikit:config/profiles` | Settings · profiles | M | Profiles of the organization, permission by permission. |
| `mosaikit:config/embedding` | Settings · embedding | M | Sites of the organization that may embed its pages. |
| `mosaikit:config/identity` | Settings · identity and texts | M | Name, logos, landing page, welcome and legal notes, formats. |
| `mosaikit:config/theme` | Settings · theme and mode | M | Default theme among the ones offered, mode, sidebar. |
| `mosaikit:config/languages` | Settings · languages and formats | M | Languages of the organization and the default one. |
| `mosaikit:config/appearance` | Settings · appearance | U V | Mode, high contrast, language and sidebar for oneself. |
| `mosaikit:themeedit` | Theme editor | M A | A theme from colour, band and greys, with previews and the WCAG check. |
| `mosaikit:dlg-search` | Search and commands | all | Search across the items of the apps (people and pages for the administrator), Ctrl K. |
| `mosaikit:dlg-create` | Create | M U | One entry for each app installed in the organization. |
| `mosaikit:dlg-share` | Share | M U | Subjects (person, group, organization, link, public) and levels (view, use, edit, manage). |
| `mosaikit:dlg-invite` | Invite people | M | Email with what the platform knows of it, role, profile, groups, what they will be able to do. |
| `mosaikit:dlg-roles` | What each role can do | M A | The three roles and the profiles. |
| `mosaikit:dlg-new-group` | New group | M | Name, where members come from, first members. |
| `mosaikit:dlg-remove-person` | Remove from the organization | M | Who gets the items of the person, what happens to the account. |
| `mosaikit:dlg-confirm` | Confirmation | M A | An action that cannot be undone, with what is lost. |
| `mosaikit:dlg-new-organization` | New organization | A | Five steps, ending with what the platform prepares by itself. |
| `mosaikit:dlg-new-admin` | New administrator | A | A Keycloak account of the platform realm, with a second factor. |
| `mosaikit:dlg-move-home` | Move the home organization | A | The new home organization and what changes for the person. |
