# Mosaikit — Refactoring of the interface

Approved decisions to reorganize the shell, valid for the mockup (`docs/mockup`) and for the shell
(`ui/host/src/app`). Both are in English by default; the shell is also available in Italian. Goal:
whoever uses Mosaikit always knows where they are and where to find everything.

## 1. Rule: everything has a single home

- **Work**, in the sidebar: overview and apps.
- **Management of the scope**, in the sidebar, only for the Tenant Manager (the tenant) and the
  Administrator (the platform).
- **Personal**, in the person menu: Account, Notifications, Trash, Sign out.

Elsewhere only shortcuts appear that lead to the home, never a second place to change the
same thing.

## 2. Navigation

| Role | Sidebar |
|---|---|
| User | Home · the apps |
| Tenant Manager | Tenant overview · the apps · group «Tenant management»: Manage (people and groups), Plugins, Shares, Usage, Log · at the bottom: Tenant settings |
| Administrator | Platform overview · Tenants · People · Plugins · Monitoring · Log · at the bottom: System |

- **Person menu**: Account, Notifications, Trash (not for the Administrator), Sign out. Settings and
  System are only in the sidebar; the Account page has no second «Sign out».
- **Bell**: opens a panel with the latest notifications, «Mark all as read», a gear towards
  Account › Notifications and «See all» towards the Notifications page. Notifications are in the first
  version.
- **Account** (a single page, sections on the left): Profile · Sign-in and security (change of one's own
  password, second factor, sessions, personal tokens) · Notifications (what I receive, on which channel) ·
  Appearance and language (mode, contrast, language, sidebar) · My tenants (home, guest, «Leave») ·
  Usage (User and Tenant Manager: one's own usage and what is left in the tenant) · Keys (personal
  keys of outside services; not for the Administrator).
- **Help** (?) in the bar: guided tour of the page, guide, what is new in the version, shortcuts, version.

## 3. Merges

- **Manage › People**: People · Groups · Permission profiles · Pending (invitations and access
  requests, with the counter). A single «New profile».
- **Permissions of the plugins**: they are changed only on the page of the plugin of the tenant. Group ›
  Plugins and Person › Permissions are read-only summaries with «Change in the permissions of the
  plugin». No exceptions in the invitation.
- **Plugins and tenants**: the Administrator makes a plugin *available* to a tenant (Plugins › Tenants);
  the Tenant Manager turns it *on* and decides its permissions. The detail of the tenant shows the list
  with the link.
- **Log**: the same name and the same component for everybody; the Administrator also has the filter by
  tenant.
- **Appearance of the tenant or of the platform**: only in Settings or System › Identity and appearance,
  with the tabs Identity and texts · Theme and mode · Languages and formats (and, in System, Top bar). The
  palette at the top holds only the personal preferences.

## 4. Plugins: a single name

The term is **Plugin** for every role, as in the code and in the package for developers. The kind is a
label of the plugin:

| Kind | What it does | Where it shows |
|---|---|---|
| App | has pages of its own | in the sidebar and on the Home |
| Service | works behind the scenes | only in the list of the plugins |
| Extension | extends another plugin (fields, actions, tabs) | inside the plugin it extends, «Extends: Notes» |

The detail of a plugin has the **Extensions** tab (the installed ones and the available ones). Whoever
works every day sees the **Apps**.

The plugins receive **language, theme and mode** at start (handshake of the bridge) and at every change
(event), even when the matching button of the bar is hidden.

## 5. Inherited settings: three kinds

| Kind | Examples | Look at the level below |
|---|---|---|
| Managed by the platform | sign-in method and provider, quotas, available plugins, top bar | read only with a padlock and «Managed by the Administrator» |
| With a limit | password rules, session length, languages (a subset), retention | editable, «Minimum of the platform: 10»; values beyond the limit are refused |
| Customizable | identity and texts, default theme and mode, formats, keys of outside services | «Inherited» with «Customize»; then «Customized» with «Restore» |

In System a customizable setting can have the switch «Tenants may customize it».

## 6. Quotas

- **Administrator**: System › Quotas (default quotas of the new tenants and total capacity, with a warning
  if the sum of the given quotas exceeds it); in the detail of the tenant the quotas of the tenant
  (Inherited or Customized). The only place where they are changed.
- **Tenant Manager**: Usage, with the quotas of the tenant read only, trend, who uses the most,
  alerts (configurable).
- **User**: Account › Usage, one's own usage and what is left in the tenant. There are no quotas per
  person. In the sidebar only an alert near the limit, not a fixed box.

## 7. Top bar

System › Identity and appearance › **Top bar**, decided only by the Administrator and valid for every
tenant, with a preview. Switches:

| Item | When off |
|---|---|
| Logo and name of the application | the sidebar button takes the place of the logo, on the phone too |
| Search | the box and Ctrl K go away; the search inside the pages stays |
| Language | it is chosen in Account › Appearance and language (the button goes away anyway with a single language) |
| Help | tour, guide and what is new move to the person menu |
| Mode (light, dark, automatic) | the default mode applies; the person changes it in Account |

Bell, person menu and tenant switcher always stay (the switcher goes away by itself with a single
tenant).

## 8. Glossary

| Use | Instead of |
|---|---|
| Tenant | Organization |
| Tenant Manager | Manager |
| Plugin (kinds: App, Service, Extension) | Modules, Marketplace |
| Account (personal page) · Permission profile | Profile, with three meanings |
| Tenant settings · System | Config, Configuration |
| Home (User) · Tenant overview · Platform overview | three «Overview» |
| Log | Activity log, Audit log |
| Sign-in · Identity provider (OIDC) | SSO, single sign-on, Keycloak |

The screen ids of the mockup stay stable even when the labels change (README of the mockup): new
screens get new ids, removed ones stay as retired.

## 9. Pages

- Fixed structure: breadcrumb, title with the status badge, a single primary action on the right, the
  others and the change of state in the «⋯» menu.
- List of the sections on the left for the settings pages (Account, Settings, System,
  Manage); horizontal tabs for the detail of an object (person, group, tenant, plugin).
- «Unsaved changes · Cancel · Save» bar only when something changed.
- Side panel for a quick look (row of the log, service), page to change.
- Action bar on the selection only with a selection.
- The Administrator has a stable sign of being in the platform («Platform» badge in the bar).
- The actions of the overviews lead to the right home (Shares, Plugins), not to a notice.
- When the server does not answer the interface says so and tries again: never a bare HTTP status,
  never a misleading message (for example «no tenant» on the sign-in page).

## 10. To add

- Change of one's own password (Account › Sign-in and security).
- Shares: for the Tenant Manager the page with the «Public» filter and «Revoke»; for the User
  «Shared by me» on the Home.
- Detail of the tenant for the Administrator: read-only logo, «Archive» and «Delete» in a separate
  area at the bottom.

## 11. Texts to align

- Password: at least 10 characters (platform, as in the kernel); lock after 8 failed attempts in 15
  minutes (as in the kernel).
- Local accounts in Mosaikit (argon2id); OIDC for the tenants that choose it; never both.
- Administrator: local password and second factor (TOTP), never through a tenant.
- No reference to plans.
- Permission profiles in Manage, not in Settings.

## 12. Layout contract

The rules below hold on every route, for the Administrator, a Tenant Manager and a User, and on the pages of every
installed app. `tests/e2e/specs/15-layout-contract.spec.ts` checks them (the rule ids appear in the test titles);
run it before delivering any change to the shell, the headers, the lists or the navigation:
`cargo xtask e2e -- specs/15-layout-contract.spec.ts`. The routes come from the navigation itself (sidebar,
section lists, `[[nav]]` of the apps), so a new page is covered without touching the spec.

| Id | Rule |
|---|---|
| R-1 | The header (title row) and any filter row under it are fully visible, not clipped or overlapped, and pinned: they do not move when the content scrolls. |
| R-2 | No empty band between the top bar and the header (the header starts right under the top bar). |
| R-3 | A list or table page does not scroll as a whole: the list scrolls inside itself (`data-listscroll` in the host, `.msk-body` in an app), fills the remaining height, keeps its header row sticky, and loads more rows when scrolled to the end. |
| R-4 | A side navigation (Sections) does not scroll with the page; if it overflows it scrolls by itself (checked at 1280x600). |
| R-5 | The header shows the page and the open subsection: «Page › Subsection». |
| R-6 | The filter and the primary «New …» action sit on the first header row, right-aligned, the filter immediately left of the button (on a phone they wrap under the title). |
| R-7 | The header of an app page uses the same type and spacing as the header of the host (title size and weight, height, indent, border). |
| R-8 | The scrollbar of the main sidebar is hidden unless the sidebar is hovered or focused. |
| R-9 | No horizontal overflow at 390 px wide. |
| R-11 | Every table (host and plugins) has a fixed header row, only its rows scroll with their scrollbar under the header row, a filter box and sortable column titles (`aria-sort`), and loads more rows only when the end of the rows comes into view; a table that is not a scrolling list is on `TABLE_EXEMPT` of the spec with its reason (small matrices edited in place). |
| R-12 | No row is painted over or above the header row of a table, wherever the list is scrolled (sampled with `elementFromPoint` above the header row, on it and just under it, scrolled to the middle and to the end). |
| R-10 | A page or list with nothing in it shows the shared illustrated empty state (`Empty` with `art`, `emptyState` in the plugins), centred in the content area, with a title, a text and the primary action of the page repeated as a button; a filter that matches nothing shows the small plain message with «Clear filters» instead. Checked on a fresh tenant: the pages that can be empty and every app. |

Contrast and ARIA stay with `accessible()` (axe) of the other specs; the contract does not repeat them.

Sizes: 1440x900, 1280x600 and 390x844, light theme (dark on a few routes). A rule that an unfinished piece of work
still breaks is listed in `PENDING` at the top of the spec and runs as `test.fixme`; delete its row when the work has
merged, so that the rule becomes a hard check again.

### Tables (one pattern)

Every list of the host is a `ListTable` (`ui/host/src/app/ListTable.tsx`); the plugins draw the same table with
`gridTable` (`ui/plugin-api/src/grid.ts`, CSS `.msk-grid`). The page does not scroll: the header row is fixed and only the
rows scroll (the `tbody` is the scroller, with its 10 px scrollbar under the header row; `thead`, `tbody` and `tr` share the
columns of `--cols` by subgrid, and explicit table roles keep the semantics). A table wider than its card scrolls
sideways inside the card. The filter box lives in the header of the page next to the primary action (`FilterBox`; a table
that is not the whole page draws its own above it, `searchLabel`) and searches every visible field; the column titles
sort (ascending, descending, the order of the server, numbers as numbers). More rows load as the foot, the last row of the
scrolling rows, comes into view (`IntersectionObserver` rooted in the `tbody`); the button «Load more» stays for the
keyboard. Lists paged by the server keep their cursor: the filters stay on the server and the sort applies to the rows
loaded. A table among other content (a tab, a card) uses `fit="inline"`: as high as its rows up to 30 rem, then it scrolls.
Left as plain tables on purpose: the permission matrices (checkbox per permission), the matrix of notification kinds,
the capacity table of the quotas (inputs), the daily series «Show as a table», the previews of the CSV import, the results
of a bulk run, the list of extensions of a plugin (no header) and the key tables of the guide and of the help.

The installed plugins also have a card view (the default), `PluginSummary` of the brochure drawn small, with the same
filter, a sort menu (`SortMenu`), selection, and infinite scroll (`CardGrid`); the choice is kept in the browser
(`msk_plugins_view`, `useView`/`ViewSwitch`). Updates and Catalog offer both views too.

### Empty states (rule)

Nothing in a page or a list is never a bare line («No items»). It is the illustrated empty state, the same in the host
(`Empty` with `art` in `ui/host/src/app/kit.tsx`, pictures in `EmptyArt.tsx`) and in the plugins (`emptyState` of the
plugin API, `ui/plugin-api/src/empty-state.ts`): soft rounded tiles of the colours of the theme, tilted and overlapping,
with a white symbol on the big one (`documents`, `maps`, `notes`, `tasks`, `contacts`, `apps`, `people`, `plugins`,
`inbox`, `trash`, `shares`, `usage`, `generic`); a bold title; one short grey line; and the buttons of what to do, among
them the primary action of the page (the header keeps its own). It is centred in the content area and never makes it
scroll. When the list is empty only because of a filter it is not an empty state: `Empty filtered` /
`filteredEmpty` show a small plain message with «Clear filters». Errors and pages that are reserved to a role keep the
plain box. `mountCrud` shows it by default (option `empty: { art, title, text, actions }`; the defaults are a generic
picture, «Nothing here yet», «Create the first one to get started.» and the «new» button). Every text is translatable
(English, Italian and Spanish: host `it.ts` and `lang-es`, the plugins their own `it.ts`/`TEXTS`). The layout
contract checks it (R-10).

Converted: the apps Documents (Files), Maps, Apps (static sites), Contacts, Tasks and Notes (`mountCrud` and the plugins' own
pages) and the pages of the host: Tenants, Plugins (installed, updates, catalog; administrator and tenant), Groups, Access requests, Shares, Trash and Notifications. The tenants, shares, trash and log lists show the small
plain message with «Clear filters» when a filter is the reason. The layout contract checks the host pages a fresh tenant leaves
empty together with the apps (R-10). Where the header and the empty state both carry the primary action the specs name the
first one (`.first()`). Left plain on purpose: errors and reserved pages (`Empty` without `art`), sections inside a detail page
or a card (overview widgets, usage, backups, members of a group, the two lists of Manage › Pending) and the tables that show «No result» for a filter.

### Panel next to a list

A page made with `mountCrud` and `views` (Contacts, Tasks, Notes) shows the detail panel only while an item is open or a new
one is being written (`panel: 'selected'`, the default; `'always'` keeps it): otherwise the list has the whole width.
Clicking another item switches the panel; Cancel, Escape and the delete close it (Save too, except where the plugin reads
the item in the panel with `reader`: then the saved item stays open for reading). The panel is a named region, the focus
goes into it when it opens and back on the item when it closes; on a phone it is a sheet over the list. The inspector of
Files (details of the selection) is a preview, not an editor, and stays as it is. Layout contract R-3 checks that the list
takes the whole width while no panel is open.
