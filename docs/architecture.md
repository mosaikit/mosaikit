# Mosaikit — Architecture

Reference document for whoever develops Mosaikit, the kernel or the plugins.
It describes the multi-tenant model, data security, the plugin system,
development and release. The choices described here replace the initial PoC
(std-only kernel, JSON persistence, trusted `ui.js`).

## Contents

1. [Principles](#1-principles)
2. [Overview](#2-overview)
3. [Tenants, users and roles](#3-tenants-users-and-roles)
4. [Resources, ownership and sharing](#4-resources-ownership-and-sharing)
5. [Public links](#5-public-links)
   - [5.1 Notifications](#51-notifications)
6. [KPIs](#6-kpis)
7. [Database: PostgreSQL and SQLite](#7-database-postgresql-and-sqlite)
8. [Plugins](#8-plugins)
9. [Web security: origins, cookies, CSP](#9-web-security-origins-cookies-csp)
10. [Configuration and data dir](#10-configuration-and-data-dir)
11. [Repository layout](#11-repository-layout)
12. [Development](#12-development)
13. [Release](#13-release)
14. [Distributions and brand](#14-distributions-and-brand)
15. [Known limits and next steps](#15-known-limits-and-next-steps)

---

## 1. Principles

- **Domain-agnostic kernel.** The kernel does not know what a map or a note is:
  it knows tenants, users, resources, permissions and plugins. Every domain lives in a
  plugin.
- **Security in the right place.** Access controls on data are enforced
  by the data layer, not by the code of the plugins: Row-Level Security on
  PostgreSQL, query rewriting and triggers on SQLite. A plugin cannot
  forget a filter because it does not write the filters.
- **Isolation of the plugins.** Logic in sandboxed WebAssembly, UI in an iframe
  on a separate origin, data in a dedicated PostgreSQL schema with a dedicated
  role (on SQLite: only its own tables, enforced by the translation and by the
  authorizer). A plugin sees neither the session token, nor the data of the other
  plugins, nor the tables of the kernel; it can only call the commands of the plugins it
  declares (§8.6).
- **Verifiable packages.** Plugins are distributed as signed `.mskp`
  (ed25519) and checked before installation.
- **A single command to develop and release.** `cargo xtask …` works on
  Windows, Linux and macOS without bash scripts.
- **English by default.** Code, comments, documentation and the default language of the
  interface are English; the interface is also available in Italian.

## 2. Overview

```
 Browser ─────────────────────────────────────────────────────────────────────
  ┌───────────────────────────────┐        ┌───────────────────────────────┐
  │ Shell (React)    app origin   │ post-  │ Plugin UI (iframe)            │
  │ sign-in, sidebar, Account,    │ Message│ plugin origin (separate)      │
  │ tenant and platform management│◀──────▶│ @mosaikit/plugin-api          │
  └──────────────┬────────────────┘ bridge └───────────────────────────────┘
                 │ REST + HttpOnly cookie + X-CSRF-Token
 Server (mosaikit-server, a single executable) ────────────────────────────────
  ┌──────────────▼────────────────────────────────────────────────────────┐
  │ axum: app listener (:8080)  ·  untrusted listener (:8081)             │
  │       API, host UI              plugin UIs, user contents, /p/{link}  │
  ├───────────────────────────────────────────────────────────────────────┤
  │ kernel: identity · tenancy · acl · links · kpi · plugins · blobs      │
  │ runtime: wasmi (fuel, memory limit, new instance per call)            │
  │ sql-guard: whitelist of the SQL statements of the plugins             │
  └──────────────┬─────────────────────────────┬──────────────────────────┘
                 │ app role                    │ one pool per plugin, role plg_*
 PostgreSQL ─────▼─────────────────────────────▼───────────────────────────────
   core schema (tenants, users, resources, grants, links, events)   plg_* schemas (RLS)
 or SQLite (one file) ─ core_* tables · plg_*__* (rewritten queries, triggers)
 Disk ─── data dir: blobs/ (file and site contents) · plugins/ (code) · backups/
```

**The shell** (`ui/host`, served by the origin of the app) follows the mockup (`docs/mockup`) and the
rules of [refactoring-ui.md](refactoring-ui.md): everything has a single home (work and management in
the sidebar, what is personal in the person menu). shadcn/ui components on Radix (accessible),
Tailwind v4 with the themes as sets of CSS variables (`data-preset`: `mosaikit`, `italia`, `tessera`),
data with TanStack Query, languages with i18next (English by default, the key is the English phrase;
the Italian translation is in `src/app/locales/it.ts`). The errors of the API carry a stable `code`
(`wrong_credentials`, `password_too_short`, `forbidden`…) that the shell translates; the message stays
for the logs. When the server does not answer (network error, 502/503/504 of a proxy, an error body that
is not the JSON of Mosaikit) the client raises `server_unavailable`: the sign-in page says so and tries
again (3 s, growing up to 15 s), the other pages show one notice and TanStack Query retries; a bare HTTP
status is never shown. The theme is chosen by the Administrator for the platform and by the Tenant
Manager for the tenant; the mode (light, dark) and the language are everyone's own. Tests: vitest for
the units, Playwright with axe (`cargo xtask e2e`) for the flows and accessibility.

## 3. Tenants, users and roles

| Role | Scope | Where | Can do |
|---|---|---|---|
| **Administrator** | installation | account of the system tenant (`core.users.is_system_admin`) | create/suspend tenants, appoint or replace their Tenant Managers and reset passwords (users and roles, never the contents), install/turn on plugins, cross-tenant KPIs, theme and top bar of the platform, manage the Administrator accounts (at least one always stays active; whoever is disabled has their sessions closed) |
| **Tenant Manager** | a tenant | `core.memberships.role = 'tenant_manager'` | users, invitations, groups, metadata of the resources, reassignment of ownership, KPIs, policies and theme of the tenant |
| **User** | a tenant | `core.memberships.role = 'user'` | create resources, share them, use the shared ones |

The same user can be User in a tenant and Tenant Manager in another one.

- **Administrator: platform account.** It exists only in the system tenant
  (`system`), which **is not a workspace**: no membership, no
  resource, no guest (`caller` never resolves it). Being an account of
  `system` is being an Administrator: the role is not given to the users of the
  tenants, so it never overlaps with the roles in the tenants. Whoever is
  also Tenant Manager or User of a tenant has a second, distinct account there
  (`system/anna` and `alfa/anna` are two identities). A manager cannot
  invite, reset or disable an Administrator.
- **Sign-in of the Administrators.** A page of its own (`#/admin`,
  `POST /api/auth/admin/login`), **always local**: it does not depend on the IdPs of the
  tenants (even when they use OIDC, §15). With `admin_totp` (default) the
  TOTP second factor (RFC 6238) is required: the password opens a *pending* session
  (`core.sessions.pending`, 10 minutes, valid only for `/api/auth/totp/*`); at the
  first sign-in the app is registered (QR code) and 10 single-use recovery codes are
  given (stored as sha256); a code already used does not work a second time
  (`totp_last_step`). Once the second factor is done the token is renewed.
  Emergency access from the machine: `reset-password --user` and `reset-totp`.
- **Sign-in page of the users.** Drop-down menu of the active tenants
  (`GET /api/auth/tenants`: slug, name, sign-in method, theme in use, logos, texts of the sign-in
  page, languages and whether «remember me» is allowed), hidden if there is only one tenant;
  `#/login/<tenant>` preselects it. The form of the tenants refuses the system tenant. The page
  takes the identity, theme, languages and top bar of the platform (`GET /api/brand`, public) and,
  as soon as the tenant is known (address, only tenant, choice), the ones of that tenant
  (logos: `GET /api/auth/tenants/<slug>/logo/<logo_light|logo_dark>`).
- **No tenant without a manager.** At least one active Tenant Manager always stays
  per tenant: even when a user is disabled from their home
  tenant, if they are the only manager of another tenant the operation is
  refused. The Administrator can always appoint a new one.

- **Home tenant.** Every user has a `home_tenant`. They sign in
  **always** there (login with `tenant + username + password`; in the future OIDC per
  tenant, see §15). The `system` tenant holds only the Administrators.
- **Invitations.** The manager of tenant B invites a user of A with a role. The user
  accepts after signing in on A and gets a membership in B. A user can
  belong to several tenants with different roles.
- **Active tenant.** The session holds the identity and the tenant one is
  working on. The APIs are `/api/t/{tenant}/…`; at every request the server checks
  the membership.
- **Leaving.** Removing a user from a tenant requires naming the new
  owner of their resources (§4). Disabling the user in the home
  tenant invalidates the sessions and, in fact, all their memberships.
- **Overview.** The start page after sign-in
  (`GET /api/t/{tenant}/overview`), with data that depend on the role:
  - for every user: their own resources per plugin, the shares made and
    received, the active public links and their visits, the recent activity (titles
    only of the resources still accessible);
  - for the Tenant Manager, in addition: the aggregates of the tenant (§6);
  - for the Administrator, who has no active tenant, an overview of their own
    (`GET /api/admin/overview`): the aggregates of the system (tenants, users,
    Administrators, resources, space, plugins, active users).

### 3.1 Settings on three levels

The platform (the settings of the `system` tenant) sets a value for everybody; a tenant may change it
within what the platform allows ([refactoring-ui.md](refactoring-ui.md) §5,
`crates/kernel/src/tenancy/levels.rs`). Every setting has a kind:

| Kind | Settings | The tenant |
|---|---|---|
| managed | top bar, sign-in method | sees it with a padlock |
| with a limit | `security.password_min` (min), `security.lock_attempts`, `security.session_hours`, `security.remember_days` (max), `security.lock_minutes` (min), `lang.enabled`, `embed.sites` (subset) | may only be stricter; the stricter value is always in use, also when the platform changes later |
| customizable | `identity.*` (name, logos, welcome text, footer, privacy and legal links, landing page), `theme`, `appearance.mode`, `lang.default`, `format.locale` | replaces the value of the platform and can restore it, unless the Administrator turned off «tenants may customize it» (`cust` in the settings of the platform) |

Name and logos of a tenant are its own (without them: the tenant name and its initials); the other
customizable values are inherited. Values live in `core.tenants.settings` under `cfg` (the theme
and the top bar keep `theme` and `band`); a change is logged (`platform.settings`,
`tenant.config`), never with secret values. APIs: `GET/PUT /api/admin/settings` (values and
`customizable` switches), `GET/PUT /api/t/<t>/manage/config`; the values in use go to the shell in
`/api/session` (home tenant, or platform) and `/api/t/<t>/context` (`config`).

The kernel enforces them: the minimum length of passwords of the home tenant of the account
(never below `MIN_PASSWORD_LEN`, 10) when an account is created and when a password changes; the
lock after the failed attempts of the tenant (the address follows the platform's); the length of the
session and, with «remember me», of the days the tenant allows (`max_age` of the cookie).

**Images of the identity** (logos for light and dark backgrounds, browser icon of the platform):
`PUT/DELETE /api/admin/identity/<slot>` and `/api/t/<t>/manage/identity/<slot>`, the type comes from
the bytes (SVG, PNG, WebP; ICO for the icon), at most 512 KB; an SVG with scripts, event handlers,
embedded documents or external references is refused, and every image is served with
`Content-Security-Policy: … sandbox` and `nosniff`. Files: `<data_dir>/blobs/identity/<platform|tenant>/`.
The logos of the platform take the place of the brand (`/brand/logo`, `/brand/logo-dark`,
`/brand/favicon`).

**Keys of outside services** (AI providers, text messages, push, translation, document recognition)
at three levels, `core.service_keys`: whoever has a key of their own uses it; otherwise the tenant's
if shared (not shared: only its Tenant Managers); otherwise the platform's if shared. The value is
encrypted with ChaCha20-Poly1305 by the kernel (`crates/kernel/src/secret.rs`), bound to its place
(associated data: scope, owner, service), with the key of the installation (`secret_key`, §10): the
database alone does not reveal it. It never goes back to the browser: the pages see the last four
characters (the address of a self-hosted model shows whole). APIs: `/api/admin/keys`,
`/api/t/<t>/manage/keys`, `/api/t/<t>/me/keys` (`PUT` with `value` and/or `shared`, `DELETE`);
the kernel reads the key in use with `keys::key_in_use`.

## 4. Resources, ownership and sharing

A **resource** is any object declared by a plugin: a file, a
folder, a map, a static site, a note. Every resource has tenant,
plugin, kind, owner and, optionally, a parent (hierarchy, e.g.
folders).

**Levels**, cumulative:

| Level | Value | Allows |
|---|---|---|
| read | 1 | seeing the resource and its content |
| write | 2 | read + changing the content, creating children |
| manage | 3 | write + sharing, revoking, public links, moving, deleting |

- The owner always has the manage level.
- Grants are given to **users** or **groups** of the same tenant (guests
  included). There is no direct sharing between tenants: one invites.
- **Inheritance.** The effective level is the highest between the resource and its
  ancestors: sharing a folder shares its content; the
  owner of a folder also manages the files others put in it.
- **Manager of the tenant**: sees the **metadata** (kind, owner, title,
  size, dates, number of shares) and the KPIs, **never the content**. With the
  policy `managers_see_titles = false` they do not even see the titles.
- **System administrator**: the same rule, over every tenant.
- **Reassignment.** The manager, removing a user, chooses the new
  owner of all their resources in the tenant. The existing grants stay,
  the ones of the user who leaves are removed. Everything is recorded in the events.

The share dialog belongs to **the host**: plugins open it with
`msk.share(resourceId)` and never reimplement the checks.

## 5. Public links

- Whoever has the manage level creates them. They are **read only**, with expiry
  and an optional password; the token is stored only as a hash.
- Policy of the tenant: `public_links_enabled`, `public_link_max_days`.
- URL: `{public_url}/p/{token}` on the **untrusted origin**. If the resource has
  folder content (static site) it is served as it is; otherwise the
  public viewer of the plugin opens (`public_view` in the manifest), which receives
  only the data of that resource (and of its children).
- Every visit increments `view_count` and is an event (KPI).

### 5.1 Notifications

What the kernel and the plugins tell a person (`core.notifications`, kernel module `notify`).

- **Producers of the kernel**: an invitation to another tenant (to the person invited, with the buttons
  to accept or decline; the answer closes it and tells who invited), an item shared with a person or a
  group (to the people who now see it, only when the grant is new), a public link created on an item by
  somebody else (to its owner). A failure to notify never makes the operation fail.
- **Plugins** send their own with `msk.notify({ title, body, at, resource })`
  (`POST /api/t/{t}/p/{plugin}/notify`). The plugin names no recipient: without `resource` the
  notification reaches only the person using the plugin; with an item of the same plugin and tenant, on
  which that person can **write**, it reaches the people who can **see** the item (owner and grants, also
  through groups and parent items: `core.level_for`), never the sender. Plain text (title ≤ 160, body ≤
  600 characters); `at` (≤ 200 characters, letters, digits and `/ _ - . = & ? % :`) is a place inside the
  plugin: opening the notification opens `#/t/<tenant>/p/<plugin>/<at>` and the plugin finds it in
  `msk.at`. At most 30 notifications a minute per person and plugin.
- Every notification has the English `title` and `body` (also the text of the emails) and in `data` the
  `code` and parameters of the text, which the shell shows in the language of the person.
- **Reading** (only one's own): `GET /api/me/notifications` (filters `unread`, `kind`, `days`, `q`,
  pages with `before`), `/count`, `POST /read` (`ids`, `read`), `/read-all`, `/delete`.
- **Live**: `GET /api/me/stream` (server-sent events) sends at once the number of unread notifications,
  then every new notification and every change of the number; the bell updates without reloading.
- **Preferences** (`/api/me/notifications/prefs`, Account › Notifications): the email address, the mode of
  the emails (`immediate`, `digest` or `off`; without a choice the default of the setting
  `notify.email_mode`, customizable by the tenants) and the kinds sent by email. In the app everything
  arrives.
- **Email** (kernel module `mail`): the mail server of the platform (System › Email: host, port, STARTTLS,
  TLS or none, user, password encrypted with the secret key of the installation in `core.secrets`, sender,
  footer, a test message sent at once). Messages wait in `core.mail_outbox`; a worker of the kernel sends
  them every 15 seconds and retries a failure after 1, 5, 30 minutes, 2 and 12 hours, then marks it
  failed. The **daily digest** goes out once a day from the hour `notify.digest_hour` (UTC) with the
  unread notifications not emailed yet.
- **Retention**: notifications older than `notify.retention_days` (default 90) are deleted; sent and
  failed emails after 30 days.

## 6. KPIs

**Kernel KPIs** (always available): resources per plugin and kind, bytes
used, users and members, shares, active public links, events of the
last 30 days.

**Plugin KPIs**: SQL views `kpi_*` in the migrations of the plugin, with a required
`tenant_id` column, declared in the manifest:

```sql
create view kpi_maps_by_layers as
  select tenant_id, count(*) as maps, sum(layers) as layers
  from maps group by tenant_id;
```

| Who | Endpoint | Scope |
|---|---|---|
| Manager | `GET /api/t/{tenant}/manage/kpi` | their tenant only |
| System admin | `GET /api/admin/kpi` | every tenant, grouped |
| External BI | role `<prefix>_reporting` | read only on the KPI views |

KPI views are aggregates and the plugin itself cannot read them (it does not see the
other tenants). That they expose no contents (e.g. a `group by title`) is a point
of review of the plugin before its publication in the registry.

## 7. Database: PostgreSQL and SQLite

Two backends with the same rules, behind a single API (`mosaikit-db`:
`query`/`query_scalar`, transactions with context, operations on resources,
SQL of the plugins, schemas of the plugins):

- **PostgreSQL ≥ 15**: server and Docker, distributions with extensions (PostGIS).
  The rules are in the database: roles, RLS, `SECURITY DEFINER` functions (§7.1-7.5).
- **SQLite** (included in the executable, default of the desktop version): a single
  file; the same rules enforced by the data layer (§7.6).

SQL of the kernel and of the plugins is written for PostgreSQL; on SQLite it is
translated (or, rarely, the kernel gives a variant with `.sqlite(...)`).
The test suites of database, kernel and server run on both.

Applied migrations are never edited (sqlx checks their checksums on PostgreSQL): a change, even of
the texts of the messages, goes in a new migration (e.g. `0004_english_messages.sql`).

### 7.1 Schemas and roles

| Object | Owner | Content |
|---|---|---|
| schema `core` | app role | tenants, users, memberships, invitations, sessions, groups, plugins, resources, grants, links, events, preferences |
| schema `plg_<id>` | app role | tables of the plugin (RLS) |
| role `<prefix>_p_<id>` | — | login of the plugin: only DML on its own schema, no access to `core` except through functions |
| role `<prefix>_reporting` | — | read only on the KPI views |

The app role must have `CREATEROLE` (it creates the roles of the plugins). The prefix of the
roles derives from the name of the database, so several databases can live in the
same cluster (e.g. the tests).

### 7.2 Security context

Every operation on the data of a plugin happens in a transaction on a
connection **authenticated as the role of the plugin**:

1. the host runs `core.set_ctx(secret, user, tenant, plugin, link)`. The function
   is `SECURITY DEFINER`, checks a secret the plugins cannot read and
   stores the context tied to the current backend and transaction;
2. it runs the statements (generic CRUD, WASM commands, hooks);
3. commit, or rollback if something fails.

The context holds **only in that transaction**. The plugin cannot forge it
(it does not know the secret) nor leave its own role (the connection was born with
that role: there is no more privileged role to go back to).

### 7.3 Row-Level Security

`core` functions (all `SECURITY DEFINER`, fixed `search_path`):

| Function | Use |
|---|---|
| `core.can_access(resource_id, level)` | access rule: membership, ownership, inherited grants, public link |
| `core.level_of(resource_id)` | effective level (0–3), for the UI |
| `core.create_resource(kind, title, parent, meta)` | creates a resource of the current plugin, owner = user of the context |
| `core.update_resource`, `core.move_resource`, `core.delete_resource` | changes with a check of the level |
| view `core.visible_resources` | metadata of the resources of the current plugin visible to the user |

For every table of a plugin the host creates the policies:

```sql
create policy msk_select on t for select using (core.can_access(resource_id, 1));
create policy msk_insert on t for insert with check (core.can_access(resource_id, 2)
                                                    and tenant_id = core.ctx_tenant());
create policy msk_update on t for update using (core.can_access(resource_id, 2));
create policy msk_delete on t for delete using (core.can_access(resource_id, 3));
```

### 7.4 Migrations of the plugins

The migrations (`migrations/NNN_name.sql`) are applied by the host
at installation and update:

1. every statement goes through **sql-guard**: allowed `CREATE TABLE/INDEX/VIEW`,
   `ALTER TABLE`, `DROP TABLE/INDEX/VIEW`, `INSERT/UPDATE/DELETE`, `COMMENT`;
   forbidden functions, triggers, policies, `GRANT`, `SET`/`RESET`, `DO`, `COPY`,
   references to other schemas;
2. the statements run with the role of the plugin (`SET LOCAL ROLE`), so they
   cannot touch `core` nor other plugins;
3. then the host, with the app role: refuses the views that use objects outside the
   schema of the plugin (PostgreSQL checks the privileges of views only when used:
   a view on `core.users`, handed to the app role, would expose them); transfers
   the ownership of the objects to the app role; checks that **every table** has
   `resource_id uuid not null` and
   `tenant_id uuid not null`; adds the FK to `core.resources` with
   `on delete cascade`; turns on RLS and creates the policies; sets
   `security_invoker` on the normal views; grants the `kpi_*` views only to the
   reporting role;
4. if a check fails the installation is rolled back (one transaction).

The tables of the `[[resources]]` declared in the manifest (generic CRUD) are
generated by the host with the same process.

The extensions required by the manifest (`[requires] extensions`) must be
installed in the database (with the `postgis/postgis` image or, in development, in the
template of the cluster); the schema of the extension (e.g. `public`) is added
to the `search_path` of the role of the plugin after its own schema.

### 7.5 SQL of the plugins at runtime

The queries the WASM logic sends (`ctx.db().query(...)`) go through
**sql-guard** (only `SELECT/INSERT/UPDATE/DELETE`, `WITH` too; a single
statement; no `SET`, system functions, other schemas) and run
as prepared statements with the `statement_timeout` of the role. The guard is a
second defence: the first are role and RLS.

### 7.6 SQLite: the same rules without RLS

SQLite has no schemas, roles or Row-Level Security. Mosaikit replaces them:

| PostgreSQL | SQLite |
|---|---|
| schema `core` | tables `core_*` (the same columns; uuids and instants as text, instants RFC 3339 with milliseconds, sortable, jsonb/arrays as JSON, bool 0/1) |
| schema `plg_<id>` | tables `plg_<id>__<name>`; the normal views of the plugin are stored in `core_plugin_views` and expanded at every use; the `kpi_*` views are real views |
| `core.set_ctx` + context table | context of the transaction on the Rust side of the connection, read by the functions `core_ctx_user()/tenant()/plugin()/link()/active()`: SQL cannot change it |
| `core.level_of`, `core.can_access`, `core.level_for`, `core.is_member` | expanded by the translation into subqueries on the core tables (the same logic: active membership, own ownership or of an ancestor, direct or group grants, read-only public link) |
| `core.visible_resources` | filtered subquery with the same columns |
| policy `msk_select` | every read of a protected table (with `resource_id`) becomes `(SELECT * FROM plg_x__t WHERE level >= 1) AS t` |
| policies `msk_update`, `msk_delete` (`USING`) | condition on the level added to the `WHERE` of UPDATE and DELETE |
| `WITH CHECK` of insert and update | `BEFORE INSERT/UPDATE/DELETE` triggers on the tables of the plugin, active in the transactions of the plugins: `RAISE(ABORT, 'mosaikit[42501]: ...')` |
| role of the plugin | the SQL written by the plugin may name only its tables, its views and `core.visible_resources` (check on the AST); in addition the SQLite **authorizer** denies writes outside its prefix, reads of secrets/sessions/passwords, PRAGMA, ATTACH, `load_extension` |
| `core.create/update/move/delete_resource` | the same checks implemented in Rust in the transaction |

The translation (`mosaikit_sql_guard::sqlite`) works on the sqlparser AST:
names, casts, `now()`, intervals and `make_interval`, `= ANY(...)` and `<> ALL(...)`
(on JSON arrays), `ILIKE`, `json_build_object`, `string_agg`, `EXTRACT`,
common `to_char`/`date_trunc`, `FOR UPDATE`, placeholders `$n` -> `?n`. The
constructs without a safe equivalent are refused with a clear message
(`json_agg` of whole rows, `DISTINCT ON`, regular expressions, `ALTER COLUMN
TYPE`). The SQL templates evaluate their arguments in a subquery without
tables: an unqualified column of the calling SQL is not resolved by
mistake on the core tables inside them.

Every transaction is `BEGIN IMMEDIATE` (serialized writes, no deadlocks from
lock promotion); for this reason `plugin.call` (§8.6) and the plugins with
`[requires] database = "postgres"` are not available on SQLite.

## 8. Plugins

### 8.1 Layout

The official plugins are in `../mosaikit-plugins`, the ones of a distribution
in its folders (§14), each with its own Cargo and npm workspace.

```
mosaikit-plugins/notes/
├── plugin.toml          manifest v3
├── Cargo.toml           (if there is logic) depends on mosaikit-plugin-sdk
├── src/lib.rs           WASM logic: commands and hooks
├── migrations/          SQL of the plugin (tables, kpi_* views)
└── ui/                  UI (Vite + TypeScript) → ui/dist
    └── public/          (optional) viewer for the public links
```

### 8.2 Manifest (`plugin.toml`)

```toml
id = "com.mosaikit.notes"
name = "Notes"
version = "0.3.0"
abi = 1
min_kernel = "1.0.0"
description = "Personal and shared notes"

[contribution]
icon = "📝"
label = "Notes"

[[resources]]            # generic CRUD: table generated by the host
name = "notes"
title_field = "title"    # field used as the title of the resource
fields = [
  { key = "title", label = "Title", kind = "text", required = true },
  { key = "body",  label = "Text",  kind = "text", multiline = true },
  { key = "tag",   label = "Tag",   kind = "choice", options = ["personal", "work"] },
]

[ui]
entry = "index.html"     # inside ui/dist
public_view = "public.html"   # optional

[permissions]
hooks = ["notes"]        # WASM hooks on the resources
files = false            # file/folder API with content on disk
content = false          # folder content from a zip (sites)
network = []             # origins reachable by http.fetch
frame_src = []           # origins the UI may embed
calls = []               # plugins whose commands the logic calls (§8.6)

[requires]               # optional
database = "postgres"    # uses PostgreSQL functions: it does not install on SQLite
extensions = ["postgis"] # they must be installed in the database

[[kpi]]
view = "kpi_notes_by_tag"
label = "Notes by tag"
columns = { notes = "Notes" }   # optional labels of the columns of the view

[i18n.it]                # optional: the texts in another language
name = "Note"
label = "Note"
[i18n.it.resources.notes]
label = "Note"
fields = { title = "Titolo", body = "Testo" }
options.tag = { personal = "personale", work = "lavoro" }
[i18n.it.kpi.kpi_notes_by_tag]
label = "Note per tag"
columns = { notes = "note" }
```

Field kinds: `text` (`multiline` too), `number`, `bool`, `date`, `choice`. A choice
field may give display labels to its values (`option_labels = { work = "Work" }`); the
stored value stays the option.

**Languages.** The texts of the manifest are English. `[i18n.<lang>]` (two or three
lower-case letters, not `en`) translates the name, the description, the label of the
contribution, the labels of resources and fields, the labels of the choice values, and
label and columns of the KPIs; every key is optional and falls back to English, and the
installation refuses a translation that names a resource, field, value or view the
manifest does not have. The shell sends its language with every request
(`Accept-Language`): the context of the tenant, the lists of the CRUD (fields and
choice labels, which reach the UI of the plugin through the bridge), the KPIs, the
administration of the plugins and the public page of a record answer in that language.
The values stay identifiers: a plugin that translates stored values converts them with a
migration.

### 8.3 WASM logic (ABI v1)

The runtime uses **wasmi** (pure Rust interpreter): a new instance for every
call, instruction limit (fuel), memory limit, no WASI (no
files, network, clock except through the host).

| Side | Symbol | Signature |
|---|---|---|
| plugin export | `msk_alloc(len) -> ptr` | allocation in the memory of the guest |
| plugin export | `msk_call(ptr, len) -> i64` | incoming JSON message, answer `(ptr << 32) \| len` |
| host import | `msk.host_call(ptr, len) -> i32` | JSON request to the host, returns the length of the answer (<0 error) |
| host import | `msk.host_read(ptr)` | copies the pending answer into the guest |
| host import | `msk.log(ptr, len)` | log |

Messages: `{"abi":1,"kind":"command","name":…,"args":…,"ctx":…}` or
`{"abi":1,"kind":"hook","hook":"before_create"|"before_update"|"after_delete",…}`;
answer `{"ok":…}` or `{"err":"…"}`. Host operations: `db.query`, `db.exec`,
`resource.create`, `resource.delete`, `http.fetch` (only towards `network`),
`plugin.call` (only towards `calls`, §8.6).

With the **`mosaikit-plugin-sdk`** crate the plugin does not see the ABI:

```rust
use mosaikit_plugin_sdk::prelude::*;

fn before_create(ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
    let mut v = hook.values.clone();
    if v.str("tag").is_empty() { v.set("tag", "personal"); }
    ctx.log("default tag applied");
    Ok(Some(v))
}

fn count_by_tag(ctx: &Ctx, _args: Value) -> Result<Value> {
    ctx.db().query("select tag, count(*) as n from notes group by tag", &[])
}

mosaikit_plugin_sdk::plugin! {
    hooks: { "notes.before_create" => before_create },
    commands: { "notes.count_by_tag" => count_by_tag },
}
```

Hooks and commands run **in the same transaction** as the operation: an error
rolls back everything.

### 8.4 UI

- Served by the **untrusted origin** (`{plugin_url}/ui/{id}/…`) in an iframe with
  `sandbox="allow-scripts allow-same-origin allow-forms allow-popups
  allow-downloads allow-modals"`. Being another origin, it cannot read
  cookies, storage or DOM of the host.
- It talks only with the **postMessage bridge** (`@mosaikit/plugin-api`).
  The host checks that the message comes from the current iframe, translates it into
  a REST call **limited to that plugin** and runs it with the session.

```ts
import { connect, mountCrud } from '@mosaikit/plugin-api'

const msk = await connect()                 // handshake: language, theme, mode, user, tenant
mountCrud(document.getElementById('app')!, msk, 'notes', { title: 'Notes' })
// or by hand:
const rows = await msk.crud('notes').list({ filter: 'rome' })
await msk.call('notes.count_by_tag', {})
await msk.share(rows[0].id)                  // share dialog of the host
```

API of the bridge: `crud(name).list/get/create/update/delete`, `call`,
`files.*` (if `files`), `content.upload/ticket` (if `content`),
`resource.meta`, `share`, `toast`, `notify` (§5.1), `theme`.

```ts
await msk.notify({ title: 'Due today', body: 'Site visit', at: `notes/${id}`, resource: id })
msk.at                                       // the place, when the page opens from a notification
```

**Language, theme and mode.** The handshake carries `context`: `lang` (`it`, `en`…),
`preset` (theme of the host), `mode` (`light` or `dark`, the one in use),
`preference` (`light`, `dark` or `auto`) and `theme` (CSS variables). At every
change the host sends the `context` event with the new values (and, for the plugins
written before, the `theme` event with the variables only). `connect()` applies them
to `<html>` (`lang`, `data-mode`, `data-preset`, `color-scheme`, variables);
to react, for example changing the labels:

```ts
msk.context?.lang                          // at start
msk.onContext((c) => render(c.lang))       // at every change
```

The plugin receives them even when the Administrator hides the language or
mode buttons from the top bar. `mountCrud` speaks English, or Italian when the host is in Italian,
and follows the changes.

### 8.5 `.mskp` v3 package and signature

A zip with `plugin.toml`, `logic.wasm` (optional), `ui/**`, `migrations/**`,
plus:

- `MANIFEST.sha256`: hash of every file of the package;
- `SIGNATURE`: ed25519 signature of `MANIFEST.sha256` (key of the publisher).

At installation the host computes the hashes again (no file more or less),
checks the signature with the trusted keys of the configuration and checks the
blocklist. With `allow_unsigned = true` (development only) it accepts unsigned
packages, flagging them.

### 8.6 Calls between plugins

A plugin never reads the tables of another one. It can however call its commands:
`ctx.call_plugin("com.example.data", "data.list", args)`, if the
called plugin is declared in `[permissions] calls`. The called command:

- runs with **the same user and tenant**, in a **transaction of its own** and with its
  role: it applies its own rules (a shared dashboard shows each
  person only the data they can see);
- can in turn call other plugins, up to 3 levels;
- if it fails, the caller receives the error and decides (e.g. a "failed" job).

Requires PostgreSQL (§7.6).

### 8.7 Registry (`registry/index.json`)

Catalog of the plugins the installation trusts: for every plugin the versions,
the path or URL of the package, the sha256, the publisher and the **blocklist** of
the revoked versions. It serves to: install from a trusted source instead of from
any file, check integrity, show updates, revoke
compromised versions. The release includes a copy of it for offline
installations. With a single installation and internal plugins only the signature is enough.

## 9. Web security: origins, cookies, CSP

| Origin | Listener | Content |
|---|---|---|
| app (`url`) | `listen` (default: port of `url`) | host UI, API, brand |
| untrusted (`plugin_url`, default the next port) | `plugin_listen` | plugin UIs, contents uploaded by users, public links |

Both origins can have a **base path** (e.g.
`http://127.0.0.1:8080/mosaikit`): the routers are mounted under the path,
`<base>` redirects to `<base>/`, the host UI uses relative paths and the cookies
are limited to the path.

- **Session**: cookie `msk_session` `HttpOnly; SameSite=Strict; Path=<base>/`
  (`Secure` with HTTPS). The token is stored in the DB only as a hash.
- **CSRF**: every request that changes data requires `X-CSRF-Token`, obtained from
  `GET /api/session` (same-origin). A custom header forces the CORS preflight,
  which the server does not allow for other origins.
- **CORS** closed (no external origin).
- **CSP** of the host: `default-src 'self'`, `frame-src` limited to the untrusted
  origin, `frame-ancestors 'none'`.
- **User contents** (static sites, previews): always with
  `Content-Security-Policy: sandbox …` without `allow-same-origin` (opaque
  origin), `nosniff`, `Referrer-Policy: no-referrer`.
- **Passwords**: argon2id, at least 10 characters (the platform and the tenants may ask for more,
  §3.1). Sign-in with a limit of failed attempts per account and per address (default 8 in 15
  minutes, settings of the platform and of the tenant).
- **Embedding**: the host UI is never embedded (`frame-ancestors 'none'`); the public pages of a
  tenant (public links) may be embedded only by the sites in `embed.sites` of the tenant, a subset
  of the platform's (`frame-ancestors <sites>`, otherwise `'none'`).
- In production the two origins are two hostnames behind the reverse proxy
  (e.g. `app.example.com` and `plugins.example.com`), with HTTPS.
- **Social preview**: the server writes `og:image`, `twitter:image` and `og:url` of the page as
  absolute URLs from the public address of the app (`url`); with the Vite development server they
  stay relative.

## 10. Configuration and data dir

Configuration: `mosaikit.toml` + environment variables `MOSAIKIT_*` (which take
precedence). Every property is described in `mosaikit.example.toml`, which is
also a test (the file must stay valid).

```toml
url = "http://127.0.0.1:8080/mosaikit"   # the only required address
# plugin_url = "https://plugins.example.com/mosaikit"   # default: next port
# listen = "0.0.0.0:8080"                # default: from the port of url
data_dir = "data"
trusted_keys = ["<base64 ed25519 public key>"]
registry = "registry/index.json"
brand = "branding"

[database]
backend = "sqlite"      # or "postgres"; default: postgres if there is url or embedded
# url = "postgres://mosaikit_app:***@127.0.0.1:5432/mosaikit"
# embedded = true       # desktop: local PostgreSQL in the data dir
```

```
<data_dir>/
├── plugins/<id>/<version>/    code of the installed plugins (read only)
├── blobs/<tenant>/<resource>/ contents: files (file) and sites (site/...)
├── blobs/identity/            logos and browser icon of the platform and of the tenants
├── secret.key                 key that encrypts the keys of outside services (without `secret_key`)
├── mosaikit.db                SQLite (with -wal and -shm), if the backend is SQLite
├── pg/                        desktop with PostgreSQL only: embedded cluster and generated credentials
├── logs/mosaikit.log          desktop only
└── credenziali-iniziali.txt   only if passwords were generated at the first start (the name is kept
                               for the existing installations)
```

The contents of deleted resources are removed at once; at start a cleanup
removes possible leftovers (folders without a resource, older than one hour).
A backup is a dump of the database plus the `blobs/` folder and `secret.key` (without it the keys
of outside services cannot be read: they have to be entered again); in the
desktop version copying the whole data dir with the server stopped is enough. With several
servers on the same database, set the same `secret_key` (or `MOSAIKIT_SECRET_KEY`) on all of them.

The structured data are all in the database. At the first start the
`system` tenant and the Administrator `admin` are created: the password is `MOSAIKIT_ADMIN_PASSWORD`
or it is generated and written in `credenziali-iniziali.txt`. With
`initial_tenant` (desktop release: `"locale"`) the first start also creates a
work tenant, with the name of the product, and its Tenant Manager `utente`
(generated password, in the same file; with `initial_password`, desktop release:
`"mosaikit"`, both accounts have that one, even if shorter than the
policy, which holds again when it is changed): on the desktop one works at once, without
going through the administration. The migration `0003_admins`
brings the previous installations to the current model: an Administrator of another
tenant becomes an account of `system` with the same password (with the
suffix `-<tenant>` if the name is already taken), the original account stays without
the role; the other accounts of `system` are disabled and the memberships that
involve `system` removed; every session is closed.

## 11. Repository layout

```
mosaikit/
├── Cargo.toml               workspace
├── crates/
│   ├── mskp/                package format, manifest v3, signature
│   ├── sql-guard/           SQL whitelist (sqlparser) and translation to SQLite
│   ├── db/                  data API: PostgreSQL (migrations, RLS, roles) and SQLite (schema, filters, triggers)
│   ├── runtime/             wasmi
│   ├── kernel/              services: identity, tenancy, acl, links, kpi, overview, brand, plugins, blobs
│   │                        (tenancy/: tenants, administrators, members, invitations, groups, settings, directory)
│   ├── server/              axum, two listeners, embedded host UI
│   ├── desktop/             mosaikit.exe (Windows): without a console, icon in the notification area
│   └── plugin-sdk/          crate for the plugins (guest side)
├── ui/
│   ├── host/                the shell (React + Vite, Tailwind v4, shadcn/ui, TanStack Query, i18next):
│   │                        src/app (pages, kit, languages), src/components (PluginFrame, ui/ of shadcn)
│   └── plugin-api/          @mosaikit/plugin-api (bridge, mountCrud)
├── branding/                brand of Mosaikit (documented brand.toml)
├── distribution.toml        "Mosaikit" distribution (§14)
├── mosaikit.example.toml    every configuration property
├── e2e/                     tests in the browser (Playwright)
├── deploy/                  Dockerfile, compose.yml, compose.dev.yml, k8s/
├── xtask/                   dev, db, plugin, test, e2e, ci, release
│   ├── templates/plugin/    skeleton for `cargo xtask plugin new`
│   └── mosaikit.dev.toml    configuration of `cargo xtask dev`
├── docs/                    architecture, mockup, refactoring-ui.md, ui-plan.md, logo
../mosaikit-plugins/         official plugins (notes, tasks, contacts, maps, static-site, files)
../<product>/                possible distributions (§14): they refer to mosaikit
```

## 12. Development

| Command | What it does |
|---|---|
| `cargo xtask db up` | starts a development PostgreSQL (local binaries or Docker) |
| `cargo xtask dev` | DB + plugin build + server in dev mode + Vite of the host, with hot reload |
| `cargo xtask plugin new <name>` | creates a plugin from the template |
| `cargo xtask plugin pack <dir>` | builds and packs (signs with the development key) |
| `cargo xtask test` | Rust tests on PostgreSQL and on SQLite, tests of the plugins and of the distribution, UI tests |
| `cargo xtask ci` | fmt, clippy `-D warnings`, tests, lint and UI build |

Every command accepts `--dist <folder>` (§14).

**Hot reload in development** (plugin folders from `MOSAIKIT_DEV_PLUGINS`,
set by `cargo xtask dev` with the plugins of the distribution):

| Change | Effect |
|---|---|
| `<plugin>/src/**` | wasm rebuilt in the workspace of the plugin; the server reloads the module (instance per call: no restart) |
| `<plugin>/ui/**` | `vite build --watch`; the host reloads the iframe of the plugin |
| `<plugin>/migrations/**`, `plugin.toml` | new migrations applied, manifest reloaded, rail updated |
| `ui/host/**` | Vite HMR |
| `crates/**` | server rebuilt and restarted (on Windows stopped before the build: a running executable cannot be replaced); the sessions stay (they are in the DB) |

The plugins in development are read from the folder, there is no need to pack them; the
dev mode exists only in debug builds.

**Build speed.** The repository configures what is the same for everybody; the rest is per machine:

| What | Where | Effect |
|---|---|---|
| `rust-lld` as linker on Windows | `.cargo/config.toml` | links the many test binaries in about half the time of `link.exe` |
| line tables only for our crates, no debug info for dependencies | `[profile.dev]` in `Cargo.toml` | faster builds, `target/` about a tenth of the size; backtraces keep file and line |
| `cargo-nextest` | installed by the developer; `.config/nextest.toml` | `cargo xtask test` runs the tests through it when present (doctests apart); slow tests are reported after 60 s |
| `sccache` | the developer's `~/.cargo/config.toml` (`rustc-wrapper`), `SCCACHE_DIR`, `SCCACHE_CACHE_SIZE` | dependencies compiled once are reused by every checkout and worktree |

On Windows, excluding the source folders, `~/.cargo` and `~/.rustup` from the antivirus real-time
scan speeds up Cargo and npm noticeably (a choice of whoever owns the machine).

## 13. Release

| Release | Command | Content |
|---|---|---|
| Desktop | `cargo xtask [--dist ..] release desktop` | zip with the executable (name, icon and description of the brand), commented configuration, signed plugins, registry, `START.txt`; SQLite or embedded PostgreSQL (`[desktop] database`) |
| Server | `cargo xtask [--dist ..] release docker` | Docker image of the distribution (temporary context: mosaikit, plugin folders and distribution, from distribution.toml) and a folder ready to use: saved image, `compose.yml` with PostgreSQL (or PostGIS), `.env`, `initdb/`, `README.md`; plus the Kubernetes folder |
| Kubernetes | `cargo xtask [--dist ..] release k8s` | kustomize manifests from `deploy/k8s`: namespace, PostgreSQL (StatefulSet), app (`Recreate` Deployment, `/data` volume), Ingress with two hostnames, ConfigMap and Secret from `config.env`/`secret.env`, `README.md`; checked with `kubectl kustomize` |
| All | `cargo xtask [--dist ..] release all` | desktop, Docker and Kubernetes (without Docker running: desktop and Kubernetes) |

The releases go to `<distribution>/dist` (`mosaikit/dist` for Mosaikit).
The desktop version has **a single executable**: without arguments it starts the app with
the icon in the notification area; from a terminal it runs the administration commands
(`migrate`, `reset-password`, `reset-totp`, `config`) in its console.

In CI a `v*` tag produces the releases (see `.github/workflows/release.yml`).
Operational details in the `README.md`.

## 14. Distributions and brand

A **distribution** is a product based on Mosaikit, described by
`distribution.toml`:

- `[product]`: id, name, version and name of the executable;
- `[brand] dir`: brand folder;
- `[plugins]`: plugin folders (`roots`) and included plugins (`include`);
- `[desktop]`: database and port;
- `[docker]`: image of the app and PostgreSQL image;
- `[tests] cargo`: integration tests of its own.

Mosaikit itself is the default distribution. `cargo xtask --dist <folder>`
uses it for development, tests and release. The kernel does not change: brand and
plugins change.

**Brand** (`brand.toml`): name, version, phrase and message of the sign-in
page, footer, support address, logo, favicon, `.ico` icon and colours of the
theme (`#rrggbb` only, turned into CSS variables). How it applies:
- **server**: injects title and colours into the page; exposes `/api/brand`
  (public, with the theme and the top bar of the platform) and `brand/logo|favicon|icon` (with CSP `sandbox`);
- **host UI**: uses it in sign-in, sidebar and status bar; the plugin UIs
  receive the same colours with the theme of the bridge;
- **desktop app**: shows it in the notification area;
- **desktop release**: embeds name, version and icon in the executable.

The dependency goes one way only: the distribution refers to Mosaikit
(SDK, `@mosaikit/plugin-api`, kernel for the tests, xtask for build and release),
Mosaikit refers to no distribution.

## 15. Known limits and next steps

- **OIDC per tenant** (Keycloak or the IdP of the customer): not implemented yet;
  today the sign-in of the tenants is local (argon2id). The sign-in page
  already receives the method of every tenant (`auth`). To define: configuration
  per tenant (issuer, client, encrypted secret, claims), external identities
  (issuer + `sub`, never linked by email), creation at the first sign-in, a
  single source of the roles per tenant (Mosaikit or groups of the IdP), revocation
  (back-channel logout) and local functions to turn off in the OIDC tenants. The
  Administrators always stay local.
- **Subdomains per plugin**: all the plugin UIs share the untrusted
  origin; a subdomain per plugin would also isolate the plugins from each other.
- **S3 storage** for the blobs: today the filesystem only.
- **Signing of the packages with a production key**: the release uses the key
  given in `MOSAIKIT_SIGNING_KEY` / `MOSAIKIT_SIGNING_KEY_FILE`; in development
  a local key that is not committed (`.dev/signing.key`).
- **Automatic backup before plugin updates**: not implemented yet; the
  migrations run in a transaction (an error rolls back everything).
- **UI bridge**: no progress during uploads (counted per file),
  no recursive statistics of the folders.
- **SQLite**: no `plugin.call` nor extensions; serialized writes (suited
  to the desktop and to small installations); `ILIKE` becomes `LIKE`, which is
  case-insensitive only for ASCII characters.
- **The remaining interface work** is planned in [ui-plan.md](ui-plan.md).
