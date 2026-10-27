# Mosaikit — Architecture

Reference document for whoever develops Mosaikit, the kernel or the plugins.
It describes the multi-tenant model, data security, the plugin system,
development and release. The choices described here replace the initial PoC
(std-only kernel, JSON persistence, trusted `ui.js`).

## Contents

1. [Principles](#1-principles)
2. [Overview](#2-overview)
3. [Tenants, users and roles](#3-tenants-users-and-roles)
   - [3.1 Settings on three levels](#31-settings-on-three-levels)
   - [3.2 People and permissions](#32-people-and-permissions)
   - [3.3 Sign-in through an identity provider (OIDC)](#33-sign-in-through-an-identity-provider-oidc)
   - [3.4 Quotas and usage](#34-quotas-and-usage)
   - [3.5 Lifecycle of the tenants](#35-lifecycle-of-the-tenants)
4. [Resources, ownership and sharing](#4-resources-ownership-and-sharing)
   - [4.1 Trash](#41-trash)
   - [4.2 Log](#42-log)
5. [Public links](#5-public-links)
   - [5.1 Notifications](#51-notifications)
   - [5.2 Search, help and themes of the shell](#52-search-help-and-themes-of-the-shell)
6. [KPIs](#6-kpis)
7. [Database: PostgreSQL and SQLite](#7-database-postgresql-and-sqlite)
8. [Plugins](#8-plugins)
   - [8.8 Plugins in the tenants](#88-plugins-in-the-tenants)
   - [8.9 Extensions](#89-extensions)
   - [8.10 Settings, updates, uninstall](#810-settings-updates-uninstall)
9. [Web security: origins, cookies, CSP](#9-web-security-origins-cookies-csp)
10. [Configuration and data dir](#10-configuration-and-data-dir)
   - [10.1 Backup and restore](#101-backup-and-restore)
   - [10.2 Maintenance mode](#102-maintenance-mode)
   - [10.3 Monitoring](#103-monitoring)
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
| **Administrator** | installation | account of the system tenant (`core.users.is_system_admin`) | create/suspend tenants, appoint or replace their Tenant Managers and reset passwords (users and roles, never the contents), every person of the installation (add to a tenant, role and profile, suspension, move of the home tenant, links to choose a new password; §3.2), install/turn on plugins, cross-tenant KPIs, theme and top bar of the platform, manage the Administrator accounts (at least one always stays active; whoever is disabled has their sessions closed) |
| **Tenant Manager** | a tenant | `core.memberships.role = 'tenant_manager'` | users, invitations, groups, permission profiles and permissions of the plugins, access requests, suspension of a membership, metadata of the resources, reassignment of ownership, KPIs, policies and theme of the tenant |
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

**Keys of outside services** at three levels, `core.service_keys`. The services are the ones the
installed plugins declare in their manifests (`[[service_keys]]`, §8.2): no fixed list. Plugins that
declare the same service share its keys (the first, by plugin id, gives label and kind; the scopes add
up); a key whose service no installed plugin declares any more is listed as not used, can only be
removed, and is never read. Whoever has a key of their own uses it; otherwise the tenant's
if shared (not shared: only its Tenant Managers); otherwise the platform's if shared. The value is
encrypted with ChaCha20-Poly1305 by the kernel (`crates/kernel/src/secret.rs`), bound to its place
(associated data: scope, owner, service), with the key of the installation (`secret_key`, §10): the
database alone does not reveal it. It never goes back to the browser: the pages see the last four
characters (the address of a self-hosted model shows whole). APIs: `/api/admin/keys`,
`/api/t/<t>/manage/keys`, `/api/t/<t>/me/keys` (`PUT` with `value` and/or `shared`, `DELETE`;
`404 service_unknown` for a service no installed plugin declares at that level); the kernel reads the
key in use with `keys::key_in_use`, the logic of a plugin with the host operation `key.get` (SDK:
`ctx.service_key("id")`), only for the services its manifest declares. The key never reaches a UI.

**Own profile.** A person changes their display name (`PUT /api/me/profile`; not for the accounts of
an identity provider, whose name comes from the provider: `profile_from_provider`) and picture (`PUT`
raw / `DELETE /api/me/picture`, checked like the logos). The picture is kept in
`<data_dir>/blobs/identity/<home tenant>/people/<user>` (so it travels with the export of the tenant),
its type and version in `core.users.picture_type` / `picture_v`; `/api/session` carries the version;
`GET /api/people/<id>/picture` serves it, sandboxed, to the person, the Administrators and whoever
shares a tenant with them. The email stays with the Tenant Manager of the home tenant.

### 3.2 People and permissions

**Permissions in the plugins** (kernel module `access`). Every plugin has the standard permissions
of the kernel, enforced by the kernel itself, and the ones its manifest declares
(`[[user_permissions]]`, §8.2), enforced by the plugin:

| Permission | Enforced on |
|---|---|
| `use` | every operation of the plugin (CRUD, commands, files, contents, notifications); without it the plugin is not in the context of the tenant, so not in the sidebar |
| `create` | CRUD create, new folders, uploads and copies of files |
| `delete` | CRUD delete, deletion of files and folders |
| `share` | grants on an item (`PUT …/resources/{id}/grants`) and public links |

A refusal is `403` with code `missing_permission`. The permissions never widen what a person sees:
the access to the items stays the one of the ACL (§4). The logic of the plugin receives the
permissions of the caller in `ctx.perms` (`Ctx::can` in the SDK); the UI in the handshake of the
bridge (`perms`, `msk.can(key)`), to hide what the person may not do. Items created by the WASM logic
itself (`resource.create`) are the plugin's choice and are not gated by `create`.

What a person may do in a plugin of a tenant:

- a Tenant Manager: everything;
- otherwise the **permission profile** of the membership (`core.memberships.profile_id`) or, without
  one, the default profile of the tenant (`core.permission_profiles.is_default`): for every plugin the
  keys it lists, or the defaults of the plugin (the standard ones and the declared ones with
  `default = true`) when it does not list it, so a plugin installed later works at once;
- plus the **grants** of the plugin to the person and to their groups (`core.plugin_grants`): they
  only add.

Every tenant has the profile *Standard* (default) from its creation; the migration gave it to the
existing ones. An invitation may name the profile the person gets on accepting.

**Memberships.** A membership may be **suspended** (`core.memberships.status`): the person keeps
account, items and groups but cannot work in the tenant (`caller` refuses it, `core.is_member` on
PostgreSQL and its SQLite expansion do not count it, so the database shows them nothing). The only
active Tenant Manager of a tenant cannot be suspended. The last sign-in of every account is kept
(`core.users.last_sign_in_at`).

**Access requests** (`core.access_requests`). A member who cannot see an item (or only read it)
asks to see or to edit it (`POST /api/t/{t}/resources/{id}/request`, from `#/t/<t>/item/<id>`).
The owner of the item, or a Tenant Manager, approves (a grant to the person, never lowering one
they already have), refuses, or (the manager) forwards the decision to the owner; the people
involved get a notification (kind `share`). A Tenant Manager sees the titles of the items of others
only if the tenant allows it (`managers_see_titles`).

**Links to choose a new password** (`core.password_resets`). The Administrator (any account that is
not an Administrator) or the Tenant Manager of the home tenant creates a one-time link valid 48
hours (`#/reset/<token>`; only its hash is stored). It replaces the previous one; it is shown once to
whoever created it and queued by email when the account has an address. Using it sets the password
(with the rules of the home tenant) and closes the sessions of the person. A new person created by the
Administrator without an initial password gets one at once.

**The Administrator and the people.** `GET /api/admin/people` lists every account with its tenants
(role, profile, status); the Administrator adds a person to a tenant at once (no invitation), changes
role, profile and suspension there, removes them from a tenant that is not their home (their items go
to a new owner), moves the home tenant to another tenant they are a member of (the old one stays as a
tenant where they are a guest; sessions closed), disables or reactivates the account. Administrators
are handled in System › Administrators.

**Detail of a person.** For the Tenant Manager (`/api/t/{t}/manage/members/{id}…`) and the
Administrator (`/api/admin/people/{id}…`): profile, sessions (closed one by one or all; the manager
only for the accounts whose home is their tenant), the latest events, and for the manager the
permissions in every plugin with their sources and the explanation of why the person does or does not
see an item (`…/why?resource=<id>`: account, membership, `use` of the plugin, owner, shares).

### 3.3 Sign-in through an identity provider (OIDC)

A tenant signs in **either** with local accounts **or** with its identity provider (OpenID Connect:
Keycloak, Entra ID, the IdP of the customer), never both. The Administrator decides it on the page of
the tenant (Tenants › a tenant › Sign-in); the Tenant Manager sees it read-only in Managed by the
platform. Administrators always sign in with their local password and second factor.

**Configuration** (`core.tenant_oidc`, one row per tenant, `/api/admin/tenants/{id}/sign-in`): issuer,
client id, client secret (encrypted with the secret key of the installation, §10; only the last four
characters go back to the browser), scopes (with `openid`), text of the button, where the roles come
from, the groups of the Tenant Managers and of the Users, the mirror of the groups of the provider
(below), the names of the claims (username, name, email, groups). The page shows the addresses to
register in the provider: return address `<url>/api/auth/oidc/<tenant>/callback`, back-channel logout
`<url>/api/auth/oidc/<tenant>/backchannel-logout`, front-channel logout
`<url>/api/auth/oidc/<tenant>/frontchannel-logout` (with "session required"), address after the
sign-out `<url>/`. **Check the configuration** (`POST /api/admin/oidc/check`) reads the discovery
document and the keys as a sign-in would and says what is missing (PKCE S256, keys RS256 or ES256,
end-session endpoint, back-channel and front-channel logout). Addresses of a provider must be `https`, plain
`http` only on this computer (development and tests).

**Flow** (authorization code with PKCE):

1. `GET /api/auth/oidc/<tenant>/start` reads the discovery document (cached one hour), creates
   `state`, `nonce` and the PKCE verifier and keeps them in an encrypted cookie `msk_oidc`
   (`HttpOnly; SameSite=Lax`, 10 minutes, path `/api/auth/oidc/`): the flow is bound to the browser
   that started it, nothing is stored on the server. `Lax` because the return from the provider is a
   top-level navigation from another site, which a `Strict` cookie would not survive.
2. The provider authenticates the person and sends the browser back with `code` and `state`
   (and `iss`, RFC 9207, checked when present).
3. `GET …/callback` checks `state` against the cookie, exchanges the code at the token endpoint
   (client secret with HTTP Basic, or in the body if the provider asks so, plus the PKCE verifier) and
   checks the ID token: signature RS256 or ES256 with the keys of `jwks_uri` (an unknown `kid` fetches
   the keys again: rotation; not again for 30 s after that, so the provider is not hammered), `iss`,
   `aud` (and `azp` with several audiences), `exp` and `iat` (one minute of tolerance), `nonce`, `sub`.
   `alg: none`, HMAC and other curves are refused.
4. The person is found by **tenant, issuer and `sub`** (`core.user_identities`), never by the email.
   At the first sign-in the account is created in the tenant (username from the claim, made unique;
   no local password). Name and email follow the provider at every sign-in.
5. The session is the same as a local sign-in (`msk_session`, length and "remember me" of the tenant);
   the browser lands on `#/t/<tenant>`. On any error it goes back to `#/login/<tenant>` with
   `?oidc_error=<code>` (`oidc_state`, `oidc_token`, `oidc_provider`, `oidc_denied`, `oidc_no_role`,
   `oidc_disabled`), which the sign-in page translates.

**Roles, one source per tenant.** *Mosaikit*: the provider only says who the person is; everybody
starts as User and the Tenant Manager gives roles. *Groups of the provider*: at every sign-in the
groups claim decides — a group of the Tenant Managers gives Tenant Manager, otherwise a group of the
Users (or any group, if that list is empty) gives User, otherwise the sign-in is refused
(`oidc_no_role`). When a tenant moves to its provider, its local accounts (the first Tenant Manager
too) can no longer sign in: with roles in Mosaikit the Administrator gives the Tenant Manager role to a
person of the provider after their first sign-in.

**Groups of the provider in Mosaikit** (`sync_groups`, optional, independent of where the roles come
from). At every sign-in the groups of the token (the groups claim; only those starting with
`group_prefix` when it is set; at most 100) become groups of the tenant to share items with
(`core.groups.source = 'idp'`, `external_name` = the name in the provider): a group is created the first
time it appears — with the name of the provider, or "<name> (identity provider)" when a group of
Mosaikit already has it — and the person joins the groups of the token and leaves the other groups of
the provider. They are **read-only in Mosaikit** (`group_from_idp` on delete or a change of members;
Manage marks them "From the identity provider"): only the provider changes them. A group the provider
no longer sends loses its members as they sign in again; it is **never deleted**, so the items shared
with it keep their grants and come back to whoever joins it again.

**Local features turned off** in an OIDC tenant: local sign-in (`oidc_tenant`), creation of people
with a password, change and reset of passwords, password links, moving the home tenant of an account
of the provider. Guests from other tenants sign in with their own tenant, as before.

**Sign-out and revocation.** `POST /api/auth/logout` answers `end_session` for a person of the provider:
the shell sends the browser to the end-session endpoint (`client_id`, `post_logout_redirect_uri`).
The provider closes sessions with the **back-channel logout** (`POST …/backchannel-logout`,
`logout_token`): signature, `iss`, `aud`, `iat` within 10 minutes, the back-channel event, no `nonce`,
`jti` used once; with `sid` it closes that session of the provider (kept in `core.sessions.oidc_sid`),
with `sub` every session of the person. With the **front-channel logout** (OpenID Connect Front-Channel
Logout 1.0) the provider loads `GET …/frontchannel-logout?iss=…&sid=…` in an iframe of its own logout
page: the issuer must be the one of the tenant and the sessions with that `sid` close. A third-party
iframe may not carry the cookies of Mosaikit, so the session is found by `sid`, never by cookie; the
page is never cached and only the origin of the provider may frame it (`frame-ancestors`).

**Implementation.** A small client on `ring` and `reqwest`, already in the tree (`crates/kernel/src/oidc`),
rather than a general OIDC library: Mosaikit needs one flow and two signature algorithms, and every check
is in one module next to its tests. **Test provider**: `mosaikit-fake-idp`
(`crates/server/src/fake_idp.rs`), started by the tests in-process and by `cargo xtask e2e`; for manual
tests `cargo run -p mosaikit-server --bin mosaikit-fake-idp` (port 5556, client `mosaikit`, secret
`fake-secret`). It has no passwords: never in production. Its session is a cookie of its own; its
logout page frames the front-channel logout address of the client (`--frontchannel-logout-uri`, or the
return address with `/callback` replaced by `/frontchannel-logout`) and then goes back to the client.

**Errors inside the plugin UIs.** The bridge answers a failed request with the text in the language of
the host *and* the stable `code`, the HTTP status and the untranslated message of the server
(`BridgeError.code`, `.status`, `.serverMessage` in `@mosaikit/plugin-api`). `errorText(e)` (and
`mountCrud`) keeps the text the host translated, and translates the codes plugin UIs meet most
(`missing_permission`, `plugin_off`, `base_off`, `quota_exceeded`, `maintenance`, …) when an older host
sent them untranslated. The errors of the logic of a plugin carry `plugin_error`, so their own message
reaches the person instead of the generic text of `bad_request`.

### 3.4 Quotas and usage

Kernel module `quotas`; decisions in docs/refactoring-ui.md §6. Three quotas, the ones the kernel can
measure exactly:

| Quota | Measured as | At the limit |
|---|---|---|
| `storage` | the sum of `size_bytes` of the items of the tenant (files, contents) | uploads and copies that add bytes are refused; a replaced file counts only the difference |
| `people` | the active memberships of the tenant (guests included, suspended ones excluded) | new people (Tenant Manager, Administrator, OIDC first sign-in), invitations and their acceptance, reactivations are refused |
| `items` | the items (resources) of every plugin | CRUD create, new folders, copies, items created by the logic of a plugin are refused |

There are no quotas per person, and none for automation minutes or AI credits: nothing in the kernel
consumes them yet.

- **Who sets them.** The Administrator only: System › Quotas holds the quotas of new tenants and the
  capacity of the platform (settings of the system tenant, `quota.defaults` and `quota.capacity`;
  `null` is no limit). On the page of a tenant (Details) a quota of its own replaces the one of the
  platform (settings of the tenant, `quota.<metric>.limit`; a metric not listed is inherited, `null`
  is "no limit of its own"). For the Tenant Manager they are managed by the platform: Usage and Tenant
  settings › Managed by the platform show them read only. System › Quotas also sums what is given to
  the tenants that are not suspended and warns when it is more than the capacity (or tenants have no
  limit while a capacity is set).
- **Measure.** Always from the data with aggregate queries, never with counters that could drift. An
  item in the trash still counts until it is deleted for good (it takes its space), so restoring it is
  never refused; the usage figures (Usage, Home, Account › Usage) show the total with «of which in the
  trash».
- **Enforcement.** `quotas::check` runs before what adds storage, people or items and refuses it with
  `409` and code `quota_exceeded`; existing data is never deleted. The check reads the usage before the
  change: two additions at the same instant may go slightly beyond the limit (a soft limit, never a
  loss of data). A static site is checked on the size of its zip before it is unpacked.
- **Trend.** `core.quota_usage` keeps the usage of each tenant at the end of each day (UTC), for 400
  days; the background work (every 10 minutes, with the queue of the emails) and the Usage page update
  the row of today. The forecast is the pace of the last 30 days: the days until the limit.
- **Alerts.** At 80 %, at 100 % and on the forecast (the limit within 30 days), each one switchable by
  the Tenant Manager, to the Tenant Managers and/or chosen people and groups of the tenant. They are
  notifications of the kind `system` (code `quota.alert`, translated by the shell; email according to
  the preferences of each person). Each threshold warns once per crossing: `core.quota_alerts` keeps the
  ones sent, and a threshold is re-armed when the usage goes back below it. They are checked after
  every addition (in the background) and by the periodic work.
- **Who sees what.** Tenant Manager: Usage (Quotas, Trend, Who uses the most by person, group and app,
  Activity, Alerts) and the Usage panel of the tenant overview. Every member: Account › Usage (their
  own items and storage, what is left in the tenant) and an alert in the sidebar when a quota passes
  80 % (no fixed widget).

API: `GET|PUT /api/admin/quotas`, `GET|PUT /api/admin/tenants/{id}/quotas` (Administrator);
`GET /api/t/{t}/manage/quotas`, `GET /api/t/{t}/manage/usage/{trend,consumers}`,
`GET|PUT /api/t/{t}/manage/usage/alerts` (Tenant Manager); `GET /api/t/{t}/usage/{mine,near}` (every
member).

### 3.5 Lifecycle of the tenants

Kernel modules `tenancy::lifecycle` and `transfer`; the Administrator only. The system tenant is never
archived, exported or deleted.

| State | What it is | How it ends |
|---|---|---|
| Trial | `trial_until` on the tenant. A week and a day before, its Tenant Managers and the Administrators get a notification (`tenant.trial_ending`, once each); at the end the tenant is **suspended** (`tenant.trial_ended`), nothing is deleted | the Administrator extends or removes the trial; reactivating forgets a trial already over |
| Suspended | nobody of the tenant signs in (also guests); data and public links stay but links do not open | Reactivate |
| Archived | suspended and marked `archived_at`: kept as it is, it can still be exported | Reactivate (clears the mark) |
| Deleted | everything, for good, with the address of the tenant typed as confirmation | — |

**Deletion** (`purge_tenant`): the items of the tenant go (the rows of the plugins follow through their
foreign keys, the contents and the logos from `<data_dir>/blobs`), then the people whose home is the
tenant, then the tenant (memberships, groups, settings, log, quotas… by cascade). Items its people own
as guests in other tenants pass to the first active Tenant Manager of each of those tenants; if a tenant
has none the deletion is refused (`tenant_delete_blocked`). The event `tenant.delete` stays in the log of
the platform.

**Export and import.** An export is a zip (`<data_dir>/exports`, kept 7 days):

```text
manifest.json                   format "mosaikit-tenant-export", version, backend, tenant, plugins
core/<table>.json               the rows of the tenant in the tables of the kernel
plugins/<plugin>/<table>.json   the rows of the tenant in the tables of each plugin
blobs/…  identity/…             its contents and its logos
```

Rows are JSON objects with the columns of the table (on PostgreSQL the types of extensions, e.g. PostGIS
geometries, travel as their text form). With the people go their preferences (`notification_prefs`,
`person_prefs`: high contrast, guided tours seen); the themes made for the tenant are in its settings;
the searchable text of the items travels with them, the search words (`search_vec`) are computed again. The import recreates the tenant with the **same ids** (contents,
links and bookmarks keep working), only the columns the table still has (an export of an older version
gets the defaults of the new columns), in the order of the foreign keys; the tables of a plugin that
refer to each other are tried again until they go in. The tenant must not exist (`tenant_exists`) unless
it is replaced; the plugins with rows must be installed (`export_plugins_missing`); the export must come
from the same kind of database (`export_backend`). Guests of other tenants come back only if they still
exist; an item of a missing owner goes to the first Tenant Manager; the authors of past events are
forgotten. Secrets travel encrypted (the OIDC client secret of the tenant, its keys): they work only
with the same key (`secret.key`).

API: `GET /api/admin/tenants/{id}/impact`, `PUT …/trial`, `POST …/archive`, `POST …/delete`
(`{"confirm": "<slug>"}`), `POST …/export` then `GET /api/admin/exports/{file}`,
`POST /api/admin/tenants/import[?replace=true]` (the zip as the body, up to 4 GB).

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

**Shares page** (Tenant Manager): every item of the tenant shared with people, groups or a public link,
with filters (owner, app, «Public and links», title) and **Revoke** for one or many items at once: every
grant is removed and every link revoked, the owner keeps the item (`POST /api/t/<t>/manage/resources/revoke`,
or `POST /api/t/<t>/resources/<id>/revoke-all` for whoever manages the item). **Shared by me** on the Home
lists the items of the person with grants or active links (`GET /api/t/<t>/me/shared`).

### 4.1 Trash

Deleting a resource (CRUD of a plugin, files, `resource.delete` of the WASM logic) **moves it to the
trash**: `core.resources.deleted_at` and `deleted_by` are set on the resource, nothing else changes.

- **Invisible to everybody.** The level of a resource in the trash, or inside one (an ancestor is in the
  trash), is 0 in `core.level_for` and `core.level_of` (PostgreSQL) and in the level templates of
  sql-guard (SQLite): it disappears from `core.visible_resources`, from the tables of the plugins (RLS),
  from search, KPIs, overviews, Shares, and public links stop working. `core.in_trash(id)` tells it to the
  queries of the kernel.
- **Restore** (`POST /api/t/<t>/trash/<id>/restore`): clears the mark; grants, public links, the rows of
  the plugin and the contents on disk come back as they were. An item inside another item of the trash is
  restored with that one (`trash_parent_deleted`). The `after_delete` hook of the plugin ran when the item
  went to the trash; no hook runs on restore or purge.
- **Who.** Whoever owns the item or deleted it; the Tenant Manager for the whole tenant (titles under the
  policy `managers_see_titles`). The Administrator has no trash.
- **Purge.** «Delete for good» (`DELETE /api/t/<t>/trash/<id>`), «Empty the trash» (what one owns or
  deleted, `POST /api/t/<t>/trash/empty`) and the background work, every 10 minutes, for what has been in the
  trash longer than `trash.retention_days` (platform setting, default **30**, 1–365): the rows are deleted
  (the tables of the plugins follow through their foreign keys) and the contents on disk removed.

### 4.2 Log

`core.events` records every operation of the kernel: who (`user_id`), where (`tenant_id`), on what
(`plugin_id`, `resource_id`), the action, details, the **outcome** (`ok`: refused sign-ins, blocked
sign-ins and wrong second-factor codes are recorded as failures) and the **address and browser** of the
request (the server runs every request inside `events::with_request`).

- **Log page.** The same component for everyone: the Tenant Manager sees the events of the tenant
  (`/api/t/<t>/manage/log`), never those of other tenants; the Administrator the whole platform with the
  tenant of each event (`/api/admin/log?tenant=`). Filters: who, kind of event (sign-in, items, sharing,
  people and groups, plugins, settings — fixed SQL, never built from the request), app, item, group,
  period, only failures, search; pages of 50 (`before` cursor); detail of an event in a side pane with
  «Only <person>» and «Only this item».
- **CSV.** `…/log.csv` with the same filters, or `ids=` for a selection, at most 10 000 events; cells that a
  spreadsheet would read as a formula start with `'`.
- **Activity.** The Activity tab of a person and of a group is the Log with a fixed filter.
- **Retention.** Events older than `log.retention_days` (platform setting, default **365**, 30–3650) are
  purged by the background work.

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

### 5.2 Search, help and themes of the shell

**Search** (kernel module `search`, `GET /api/t/{t}/search?q=`, the box of the top bar). It finds the
items of the plugins the caller can see, with the rules of every other list of the kernel: the tenant of
the caller, never the trash, only plugins on in the tenant where the caller has `use` (§3.2, §8.8), and
the level of the caller on the item (owner, grants, groups, parent items: `core.level_for`); a Tenant
Manager does not see private items through it either. It looks into the title and the **searchable
fields** of each `[[resources]]` declaration: `search = true | false` on a field; without it the visible
`text` fields are searchable. The kernel keeps their text in `core.resources.search_text`, written after
every create and update of the CRUD (outside the transaction of the plugin: the index follows the data a
moment later); items without it (created by the logic, or before the search existed) are indexed by the
background worker of the kernel, a batch every 15 seconds, read with the rights of their owner.

- PostgreSQL: full text on `search_vec` (a generated `tsvector`, configuration `simple`: no stemming, the
  same rules for every language, accents kept), every word of the query as the beginning of a word
  (`insp` finds `inspection`), plus the title anywhere (`ilike`); ranked by `ts_rank`, then by date.
- SQLite: every word (anywhere) in the title or in the searchable text, with `like` (case-insensitive
  for ASCII letters only), by date.
- At most five words of at least two characters; up to 300 items read, 20 per plugin in the answer,
  with the count, a piece of the text around the first word when it is not in the title, the owner.
- A plugin may add results with a command of its logic (`[search] command = "find"`): the kernel calls
  it with `{ "q": "..." }` as the person searching; it answers `{ "results": [{ "id", "snippet" }] }` and
  the kernel keeps only the items of that plugin the person can see.
- The Administrator finds tenants (name, identifier) and people (name, username, email):
  `GET /api/admin/search?q=`.
- The shell groups the results by app with a pill each (All, Pages, Apps, one per app, Tenants), opens an
  item at `#/t/<tenant>/item/<id>`, and remembers the last six searches in the browser, per person. It
  opens with Ctrl K or `/`, unless the Administrator turned the search off in the top bar.

**Help** (shell, `help.ts` and `HelpLayer.tsx`): a guided tour of Home, Manage, Plugins and System,
whose steps point at elements marked `data-tour` (a step whose element is not on the page is skipped);
a tour seen to the end or skipped is remembered with the person, so the dot on the help button goes
away on every device. The guide is the address of `identity.guide_url` (Identity and texts) or, empty,
the guides of `docs/guide` (user, Tenant Manager, Administrator; `docs/guide/it` in Italian) built into
the shell and drawn as React elements by `GuideText.tsx` (a small Markdown reader: nothing in a text runs),
opening on the guide of the role of the person. What is new shows the section of the current version of
`CHANGELOG.md` (English) or `CHANGELOG.it.md` (Italian), shipped with the build; a test keeps the two in
step. Keyboard shortcuts, outside the fields where one types: Ctrl K
and `/` (search), `?` (the list), `g h` (Home), `g n` (notifications), `g a` (account), `g t` (trash).

**Preferences of a person** (`core.person_prefs`, `GET/PUT /api/me/prefs`, also in `/api/session` as
`me`): high contrast and the tours seen; they follow the person on every tenant and device (the mode and
the language stay with the browser). **High contrast** (Account › Appearance and language, and the mode
menu of the top bar) puts `data-contrast="more"` on `<html>`: on top of every theme, built-in or made with
the editor, secondary texts as strong as the main text, visible borders and fields, a thick focus ring,
underlined links. Plugins receive it in the context (`contrast`, below).

**Theme editor** (System › Identity and appearance › Theme and mode for the platform; Tenant settings ›
Identity and appearance › Theme and mode for a tenant, when the theme is not locked by the Administrator):
from a main colour, the style of the top band (in the main colour, dark, light) and the greys (neutral,
warm, cool) the shell generates the CSS variables of the theme, light and dark, as the mockup does; the
previews follow at once; the contrast of the pairs that must read is checked (WCAG 2.1 AA, 4.5: text,
secondary text, links on the page, main button, top band, search field, sidebar, active item, icon bar)
and «Fix it for me» darkens or lightens the colours until they read; Save stays off while a check fails.
The main button is checked also under the pointer (12 % darker in light mode, 12 % lighter in dark mode,
as the buttons of the shell do).
The kernel (`tenancy::themes`) checks again what it stores: only the variables of the themes, colours only
(`#rgb[a]`, `#rrggbb[aa]`, `rgb()`/`rgba()`), the same contrast checks with the hover of the main button
(code `theme_contrast`), at most 20
themes per scope. The themes of the platform live in the settings of the system tenant (`themes`), the
ones of a tenant in its settings; ids `c-<hex>`. `themes_allowed` (System › Theme and mode, «Themes
tenants may use») limits what tenants choose (absent: every theme; the theme of the platform always); a
tenant using a theme no longer offered, or deleted, goes back to the one of the platform. The shell gets
the custom themes from the session, the context of the tenant and, for the sign-in page,
`GET /api/auth/themes` (the themes of the platform and the ones in use by active tenants: colours only),
and puts their CSS in a `<style>` of the page.

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

**Snapshot of the platform KPIs.** The figures of every tenant read every item and every event of the
month (about 10 s for 1,000,000 items). The worker of the kernel computes them every 10 minutes into
`core.kpi_snapshots` (scope `platform`: the whole `GlobalKpi` as JSON, `computed_at`, `took_ms`), and
`GET /api/admin/kpi` and the totals of the Administrator's overview (items, space, people active in 30
days) read the last snapshot, with its time (`computed_at`, `figures_at`): the pages show "as of
<time>" and a Refresh button (`?refresh=true`, computes now and stores). A snapshot is used only when
computing took at least 300 ms: on a small installation (and the desktop, the tests) the figures are
always computed live and exact.

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
| `core.levels_for(user, tenant)`, `core.ctx_levels()` | what a person sees in a tenant, as a set with the level (owned, shared to them or their groups, and the descendants through the GIN index on `ancestors`); `ctx_levels()` reads the context like `level_of()` (public links included) and is what the view is built on. Same rules as `level_of()`, without one call per item ([performance](reports/performance.md)) |
| `core.trashed(tenant)` | the items in the trash (deleted, or under a deleted folder) as a set, for counts and KPIs |

For every table of a plugin the host creates the policies:

```sql
create policy msk_select on t for select
  using (resource_id in (select l.id from core.ctx_levels() l where l.level >= 1));
create policy msk_insert on t for insert with check (core.can_access(resource_id, 2)
                                                    and tenant_id = core.ctx_tenant());
create policy msk_update on t for update using (core.can_access(resource_id, 2));
create policy msk_delete on t for delete using (core.can_access(resource_id, 3));
```

The read policy is a **set**: `core.ctx_levels()` (what the person of the context sees in the current
plugin, public links included, the same rules as `can_access()`) is computed once per statement and
the rows are kept by key, instead of one `can_access()` call per row (a third of the time of a list).
The writes keep the check per row: they touch one row, or few. The role of every plugin may execute
`ctx_levels()` (the function reads only the context, it takes no argument). The equivalence of the two
rules is checked on the data of the load test (`xtask/perf/check_rls.sql`) and by the tests of the
database (`reads_as_sets_follow_the_rules`, on both backends). Worst case: a single-item read of a
person who sees very many items pays for the whole set (a few ms on the data of the load test).

**Large lists are paged by key** (keyset): `?limit=N` (default 50, at most 500) returns a page with `total` (rows matching the filters) and `next` (`items` in the lists of the
shell, `rows` in the plugin lists), and `&cursor=<next>` the following page; the order
is fixed (e.g. latest changed first, then the id) and the cursor is the key of the last row, so a page
costs the same wherever it is and does not skip or repeat rows when others are added. The filters and
the search are applied by the server (`q`, and the filters of each list). Paged: the plugin lists
(`crud.list` with `limit`/`cursor`, `mountCrud` asks 100 rows at a time), the Administrator's tenants and
people, the Tenant Manager's people, groups and items/shares; the notifications and the Log were
already paged. Without `limit` the old answers are unchanged (whole lists, for the dialogs that choose
among all the members). **Select all**: on a page where every shown row is selected the shell offers
"Select all N"; it asks `?ids=true` (the ids of every row matching the filters, at most 10,000, in the
order of the list) and the bulk action then applies to all of them; changing the filters clears the
selection.

**Search in the Log** (`q`): on PostgreSQL with the `pg_trgm` extension (installed by the migration
when the cluster has it; trusted, so the app role can create it) a trigram GIN index on the action,
details and address of the events, and one on the username and name of the people, serve the
`ilike '%words%'`; without the extension the same query reads the Log of the tenant (documented
fallback, correct but slower). SQLite: `like` on the same fields.

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

Every transaction that may write is `BEGIN IMMEDIATE` (serialized writes, no deadlocks from
lock promotion), and the writers queue in the process (a fair async semaphore with one place) before
asking SQLite for the lock, so they wait in turn instead of polling against the `busy_timeout`; a
`SQLITE_BUSY` on `BEGIN IMMEDIATE` (another process on the same file) is retried with backoff for up
to 60 s. The reads that never write (lists, get, files) open a deferred transaction with
`begin_read()`/`begin_plugin_read()` and do not wait for the writers (WAL); for this reason `plugin.call` (§8.6) and the plugins with
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
kind = "app"             # app | service | extension (absent: from [extends] and [ui])
icon = "notebook-pen"    # icon of the shell (Lucide); unknown names: a default icon

[contribution]
icon = "📝"              # emoji, for older hosts
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

[[user_permissions]]     # optional: permissions of the people beyond the standard ones (§3.2)
key = "export"
label = "Export"
description = "PDF of what they can see"
default = true           # given by the profiles that do not say otherwise

[[service_keys]]         # optional: keys of outside services it uses (§3.1)
id = "translate"         # shared with the plugins that declare the same id
label = "Translation service"
description = "Translation of the notes"
address = false          # true: the value is an address (a self-hosted model), shown whole
scopes = ["platform", "tenant", "personal"]   # where a key may be set (default: everywhere)

[[config]]               # optional: settings at platform level (§8.10)
key = "endpoint"
label = "Address of the service"
kind = "text"            # text | number | bool | choice (with options) | secret
default = "https://example.com"

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
[i18n.it.permissions.export]
label = "Esportare"
```

**Kinds.** An **app** has pages of its own and appears in the sidebar and in the Home; a
**service** works behind the scenes (logic, hooks, KPIs); an **extension** adds fields and
actions to another plugin (§8.9) and needs `[extends]`. People who work see the apps; the
Administrator and the Tenant Managers see every plugin with its kind. `icon` names an icon of
the set of the shell; the shell draws only the names it knows (a manifest cannot load an image).

Field kinds: `text` (`multiline` too), `number`, `bool`, `date`, `choice`. A choice
field may give display labels to its values (`option_labels = { work = "Work" }`); the
stored value stays the option. `search = false` keeps a text field out of the search of the shell
(`search = true` puts another kind in); `[search] command = "<name>"` adds results from the logic (§5.2).

**Languages.** The texts of the manifest are English. `[i18n.<lang>]` (two or three
lower-case letters, not `en`) translates the name, the description, the label of the
contribution, the labels of resources and fields, the labels of the choice values, and
label and columns of the KPIs, label and description of the user permissions, the labels of the
fields and actions of an extension (`extension = { fields = {…}, actions = {…} }`) and of the settings
(`config.<key>`); every key is optional and falls back to English, and the
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
const { rows, next } = await msk.crud('notes').list({ filter: 'rome', limit: 100 })  // next page: { cursor: next }
await msk.call('notes.count_by_tag', {})
await msk.share(rows[0].id)                  // share dialog of the host
```

API of the bridge: `crud(name).list/get/create/update/delete`, `call`,
`files.*` (if `files`), `content.upload/ticket` (if `content`),
`resource.meta`, `share`, `toast`, `notify` (§5.1), `theme`,
`extensions(name).list/values/set/action/mountTab` (§8.9), and in the page of a tab
`tab` and `tabClient()` (§8.9). The theme variables include `--on-acc` and `--on-err`, the text on the
accent and on the colour of errors (the buttons of `mountCrud`).

```ts
await msk.notify({ title: 'Due today', body: 'Site visit', at: `notes/${id}`, resource: id })
msk.at                                       // the place, when the page opens from a notification
```

**Language, theme and mode.** The handshake carries `context`: `lang` (`it`, `en`…),
`preset` (theme of the host), `mode` (`light` or `dark`, the one in use),
`preference` (`light`, `dark` or `auto`), `contrast` (high contrast chosen by the person; absent with
older hosts) and `theme` (CSS variables, high contrast included). At every
change the host sends the `context` event with the new values (and, for the plugins
written before, the `theme` event with the variables only). `connect()` applies them
to `<html>` (`lang`, `data-mode`, `data-preset`, `data-contrast`, `color-scheme`, variables);
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

A version may carry `notes` (what changes, plain text: `cargo xtask` takes them from the
`RELEASE.md` of the plugin), `kind` and `extends`: the Updates list of the Administrator shows
the notes of the versions newer than the installed one.

### 8.8 Plugins in the tenants

A plugin installed and on in the platform reaches the people of a tenant when:

1. the Administrator made it **available** to the tenant (Plugin › Tenants: one switch per tenant,
   plus the default for the tenants without a choice, `core.plugins.available_default`, true);
2. the Tenant Manager turned it **on** (Plugins of the tenant; on unless turned off);
3. for an extension, the plugin it extends is on in the tenant with at least `extends.min_version`.

Choices in `core.tenant_plugins` (`available` null = the default, `enabled`). Every operation of a
plugin goes through `access::require`, which refuses a plugin that is not on with `404` and the
code `plugin_off`; the permissions (§3.2) count only the plugins that are on, so the context of the
tenant, the sidebar and the KPIs forget the others; the public links of a plugin turned off stop
working and come back when it is turned on. Turning a plugin off turns off its extensions with it;
an extension cannot be turned on before its plugin (`base_off`). When the availability of a plugin
changes the Tenant Managers of the tenant receive a notification. The data of a plugin turned off
stay: turning it on again gives them back.

### 8.9 Extensions

An extension (`kind = "extension"`, `[extends] plugin = "…", min_version = "…"`) adds to the
resources of the plugin it extends:

```toml
[[extension.fields]]     # fields on the items of a resource of the extended plugin
resource = "notes"
key = "reviewed"
label = "Reviewed"
kind = "bool"            # the kinds of the fields of the resources

[[extension.actions]]    # actions on the items
resource = "notes"
key = "mark_reviewed"
label = "Mark as reviewed"
set = { reviewed = true, reviewed_by = "$user" }   # or: command = "<command of its logic>"
```

The contract is narrow on purpose. An extension **never reads the tables** of the plugin it
extends; the kernel keeps the values of its fields, one set per item and extension
(`core.extension_values`, removed with the item and with the extension), and checks them with the
**permissions of the item**: who sees the item sees the values, who can edit it changes them and
runs the actions. A `set` action writes the given values (`$user` is the name of the person,
`$today` the date); a `command` action calls the logic of the extension with
`{ resource, resource_id, item, values }` (the item as the person sees it) and writes what it
answers in `{ "set": { … } }`. Every value is checked against the declared fields. The extension
must be on in the tenant and the person must have `use` on it (permission profiles, §3.2).

The UI of the extended plugin reads them through the bridge
(`msk.extensions('notes').list()`, `.values(ids)`, `.set(id, extension, values)`,
`.action(id, extension, key)`); `mountCrud` shows them by itself: the fields as columns and in the
detail (not the fields declared `hidden = true`, kept for the extension only), the actions as buttons.
REST: `/api/t/{t}/p/{plugin}/ext/{resource}` (list), `…/values` (POST of the ids), `…/{id}/{extension}`
(PUT of the values), `…/{id}/{extension}/{action}`. The sample is `com.mosaikit.note-review` in
mosaikit-plugins: two fields, an action and a tab.

**Tabs of an extension.** An extension with a UI can add a tab to the detail of the items:

```toml
[ui]
entry = "index.html"

[[extension.tabs]]
resource = "notes"
key = "review"
label = "Review"          # translated in [i18n.<lang>] extension.tabs
icon = "clipboard-check"  # optional, a Lucide name
page = "tab.html"         # an .html page of its UI (default: the entry)
```

The extended plugin keeps a place for it in the detail (`msk.extensions('notes').mountTab(el, id,
extension, key)`; `mountCrud` shows the tabs next to the detail by itself). The host checks that the
extension is on and offered to the person and that the item is visible to them, then draws the page of
the extension in a frame of its own, placed over that place and kept in step with it (position, size,
visibility); the page asks for its height (`tabClient().autoResize()`), the place follows. The frame is
**sandboxed without `allow-same-origin`**: its origin is opaque, so neither the extended plugin nor the
extension can reach into the other's page, storage or cookies (the files of the UIs are served with
`Access-Control-Allow-Origin: *` for its module scripts, which are public anyway; its pages cannot use
`localStorage`). The bridge accepts only that frame and limits it to the extension and to that one item:
`msk.tab` says where it is (`base`, `resource`, `item`, `key`, `level`); `tabClient()` reads the item as
the person sees it (`item()`), reads and changes the values of the extension on it (`values()`,
`set(values)`, `action(key)`) — the kernel checks the level of the person on every call — and the other
calls are the ones of the extension itself (its resources, its commands). After a change the extended
plugin receives the `ext.changed` event (`mountCrud` reads the values again). An extension with a UI is
not an app: the shell does not list it in the sidebar nor on the Home.

### 8.10 Settings, updates, uninstall

**Settings.** `[[config]]` declares settings chosen by the Administrator for the whole platform
(Plugin › Configuration): `text`, `number`, `bool`, `choice`, `secret`. The values are in
`core.plugins.config`; the secrets are encrypted with the secret key of the installation (§10) in
`core.secrets` (`plugin:<id>:<key>`), never go back to the browser and are removed with the
plugin. The logic receives both in `ctx.config` (SDK: `ctx.setting("key")`).

**Updates.** Installing a newer version of an installed plugin (from a file or from the catalog)
keeps its state, its settings and the choices of the tenants; its migrations run in the same
transaction as the update. A downgrade is refused.

**Uninstall.** The Administrator sees first what goes away (`GET /api/admin/plugins/{id}/impact`:
items, tenants, extensions that stop working), then the schema, the items, the files, the settings
and the secrets of the plugin are removed.

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
- **One origin per plugin (optional)**: with a wildcard host, `plugin_url =
  "https://*.plugins.example.org"`, every plugin UI has a host of its own,
  `<plugin>.plugins.example.org` (its id with `.` as `-`, e.g. `com-mosaikit-notes`), and the contents
  and public links are on `public.plugins.example.org`. The untrusted listener serves the UI of a
  plugin only on its host and contents and links only on the public one (404 otherwise, by the `Host`
  header); the CSP of a plugin UI allows scripts only from its own folder on its own host, the host
  frames each plugin from the address the server gives (`ui_url` of the plugin views), and the bridge
  checks that exact origin. A malicious or broken plugin then cannot frame and script the UI of another
  plugin nor read its storage. It needs a wildcard DNS record and a wildcard certificate (Docker and
  Kubernetes notes in `deploy/`); the reverse proxy must keep the `Host` header. In development
  `http://*.localhost:<port>` works without DNS (browsers resolve `*.localhost` to the computer);
  `MOSAIKIT_E2E_WILDCARD=1 cargo xtask e2e` runs `e2e/tests/wildcard.spec.ts` that way.
- **SVG images** (logos, browser icon) pass an allow-list check (`kernel::svg`: drawing elements and
  attributes only, references inside the document only, no DTD) and are served with
  `default-src 'none'; sandbox`.
- **Archives an Administrator imports or restores** (exports of tenants, backups) are read within the
  limits of `[archives]` (unpacked bytes, entries, one table read into memory), counted as the entries
  inflate, not as the zip declares (`archive_too_big`).
- **Paths inside packages and archives** refuse, on every platform, `..`, absolute paths, control
  characters and the names Windows reserves (`CON`, `NUL`, `COM1`, `LPT1`… with any extension, names
  ending with a dot or a space).
- **`secret.key`** is created readable by its owner only from the start (mode `0600` on Unix; on Windows
  the inherited permissions are removed and only the owner and the system keep access) and appears
  under its name in one step.
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

### 10.1 Backup and restore

Kernel module `ops::backup` (System › Backup and restore). A backup is a zip in `<data_dir>/backups`:

```text
manifest.json        format "mosaikit-backup", backend, kernel version, tenants, `whole`
README.txt           how to restore it
database/            the whole database: mosaikit.pgdump (pg_dump, custom format) or mosaikit.db (SQLite, VACUUM INTO)
blobs/               the contents and logos of every tenant
plugins/             the installed packages
tenants/<slug>/      the export of each tenant (§3.5) without contents (they are in blobs/)
```

- **Schedule**: once a day at the hour chosen (UTC), default 02:00, `backup.enabled`, `backup.hour`,
  `backup.keep` (default 7: the older ones are deleted) in the settings of the system tenant. Run now
  starts one in the background; one at a time; a backup interrupted by a stop is marked failed at the
  next start.
- **pg_dump**: looked for in `database.pg_bin`, `pgsql/bin` next to the executable, `MOSAIKIT_PG_BIN`,
  `PGBIN` and the PATH. It must be of the same major version as the server or newer: otherwise (or
  without it) the backup is made without the dump — `whole: false`, "tenants only" with the reason —
  and every tenant can still be restored; the note of the backup carries the message of `pg_dump`
  (e.g. "server version mismatch", with both versions). The Docker image includes the PostgreSQL client
  of the newest major version the releases support (`PG_CLIENT_MAJOR`, default 17, from the PostgreSQL
  apt repository; `MOSAIKIT_PG_BIN` points to it): its backups are complete for servers up to that
  version. For a newer server rebuild the image with `--build-arg PG_CLIENT_MAJOR=<major>`.
- **Never inside**: the key of the secrets (`<data_dir>/secret.key` or `secret_key`). Keep it apart:
  without it the encrypted values (keys of outside services, OIDC secrets, the password of the mail
  server) cannot be read after a restore.
- **Restore everything** is an offline step (README.txt): stop the server, `pg_restore --clean
  --if-exists --no-owner` (or replace the SQLite file), put back `blobs/` and `plugins/`, keep the same
  key, start.
- **Restore one tenant**, in the running installation: Restore a tenant on a backup imports its
  `tenants/<slug>/` with the contents of `blobs/` (replacing the tenant if it exists).
- **Restore one item** (module `ops::backup_item`), in the running installation: Restore an item on a
  backup looks for the items of a tenant in its `tenants/<slug>/` (by title, app, owner; the first 200,
  with their state now: no longer in the tenant, in the trash, in the tenant) and brings one back with
  what is under it (the items of a folder), its rows in the tables of its plugin, the values of the
  extensions and its files from `blobs/`. On request also its shares, only to people and groups that
  still exist; public links never come back (a revoked link stays revoked). Under its parent if the
  parent is still there, otherwise at the top; an owner who no longer exists gives way to the first
  Tenant Manager; the quotas do not stop it.
  - an item no longer in the tenant comes back with its id;
  - an item still there (also in the trash) is never overwritten silently (`409`, code `item_exists`):
    the Administrator chooses `copy` (a new item with new ids, next to the current one) or `replace`
    (the current version, with what is under it, is deleted for good and the backup one takes its id).

  The owner receives a notification (`backup.item_restored`) and the log the event
  `backup.restore_item`. The trash stays the quick way back for recent deletions.
- A failed backup notifies every Administrator (`backup.failed`) and raises the alert «Backup failed».

API: `GET|POST /api/admin/backups`, `GET|PUT /api/admin/backups/settings`,
`GET /api/admin/backups/{id}/file`, `GET …/tenants`, `POST …/restore` (`{"slug", "replace"}`),
`GET …/tenants/{slug}/items?q=&plugin=&owner=`, `POST …/tenants/{slug}/items/{id}/restore`
(`{"mode": "copy" | "replace", "shares": bool}`), `DELETE /api/admin/backups/{id}`.

### 10.2 Maintenance mode

Kernel module `ops::maintenance` (System › Maintenance; settings of the system tenant, `maintenance`).
While it is on, only the Administrators work: the requests of everybody else (shell and plugins) are
refused with `403` and the code `maintenance` — the shell goes back to the sign-in page, which shows the
notice — and so are the sign-in of the tenants (also through OIDC) and the public links and contents of
the plugin origin (a page that says so). Signing out stays possible. A **planned** maintenance shows its
notice to everybody in advance (`/api/brand` carries `maintenance` for the sign-in page and the band of
the shell, read again every minute) and turns the mode on by itself at the planned time. The state is
read at every request and kept 5 seconds.

### 10.3 Monitoring

Kernel modules `ops::metrics` and `ops::monitor`; pages Monitoring › Status, Performance, Errors,
Tenants, Capacity, Alerts (Administrator).

- **Metrics**: the server counts every request (time, outcome, tenant of `/api/t/<slug>/…`; the live
  streams are left out); every minute a snapshot goes into `core.metrics` (requests, server errors,
  p50/p95/p99 of the latency on a sample of 2000, open sessions, emails waiting and failed, time of a
  trivial query, requests per tenant), kept 8 days. The charts aggregate them in buckets (1 hour: per
  minute; 12 hours: 10 minutes; 7 days: 2 hours).
- **Status** of the services: database (version, time), storage of the contents (write and read of a
  probe), emails (queue, failures, configured or not), background work (last run of the workers),
  plugin runtime (active, blocked), backups (last result), the identity providers of the OIDC tenants
  (discovery document, checked at most every 5 minutes).
- **Capacity**: disk of the data folder, memory of the server and of the process (`sysinfo`), size of the
  database, of the contents and of the backups.
- **Tenants**: requests of the last hour and day, people, items, space and the quota nearest to its
  limit (§3.4).
- **Alerts** (settings of the system tenant, `alerts`): free disk under a percentage (10), server errors
  over a percentage of the last 15 minutes with at least 20 requests (5), emails failed in an hour (3),
  a failed backup, a service not answering; recipients chosen among the Administrators (none: all of
  them). Checked every minute; `core.alerts` keeps the state, so a crossing is notified **once**
  (`alert.raised`) until the condition clears (`alert.cleared` in the log).
- **Prometheus**: `GET /metrics` exists only with `MOSAIKIT_METRICS_TOKEN` (at least 16 characters) and
  `Authorization: Bearer <token>`; `GET /api/admin/metrics` gives the same text to an Administrator.
- **Background work**: a worker of the operations runs every minute (snapshot, alerts, planned
  maintenance, scheduled backup) and every 10 minutes the trial periods, next to the worker of the
  emails, the retention and the quotas; both stop with the kernel and are off with `no_background`.

API: `GET /api/admin/monitoring/{status,performance,errors,tenants,capacity,alerts}`
(`?period=1h|12h|7d`), `PUT /api/admin/monitoring/alerts`, `GET|PUT /api/admin/maintenance`.

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
| `cargo xtask test-report` | [tests/results/test-results.md](../tests/results/test-results.md) from the latest results in `tests/results/raw` (`test`, `ci` and `e2e` run it at the end) |
| `cargo xtask perf` | load test at scale (`--scale full`: 200 tenants, 1M items, 5M events; `--backend sqlite --scale desktop`), `--reuse`, `--no-build`, `--clean`; results in `.dev/perf/`, see [reports/performance.md](reports/performance.md) |

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

**Results of the automated tests.** Every suite leaves a machine-readable file in
`tests/results/raw/` (git-ignored): JUnit of nextest (profiles `pg` and `sqlite` in `.config/nextest.toml`), the
libtest output of `cargo test` (doc tests, plugin workspaces, distribution tests), the JSON reporter of
vitest for every npm workspace with a vitest `test` script, the JSON reporter of Playwright for the e2e.
`cargo xtask test`, `ci` and `e2e` run every suite even when one fails, then regenerate
[tests/results/test-results.md](../tests/results/test-results.md): totals per suite, every test with its result and duration, the
failures with their message, the commit of each run. Every phase, and every change that adds or changes
tests, commits the regenerated file. [tests/README.md](../tests/README.md) lists every suite.

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

### 14.1 Layouts and style

The look of the shell has three independent levels: the **theme** (colours), the **style** (shapes, density,
font, tabs, buttons, band image) and the **layout** (where the slots sit). Each is a setting on the three
levels of the platform (`tenancy/levels.rs`): `layout` and `style.*` are customizable by the tenants;
`layout.allowed` (the layouts the tenants may choose, none ticked = all) is managed by the Administrator.
There is no personal choice of layout.

- **Slots.** The shell draws brand, tenant switcher, navigation, search, actions, breadcrumb and content
  (`ui/host/src/app/slots.tsx`); a layout only arranges them (`frames.tsx`: sidebar, drawer, launcher,
  areas, tabs; `Shell.tsx`: the rail of Teams). Landmarks (`header`, `nav`, `main#main`), the «Skip to the
  content» link and the keyboard order are the shell's in every layout.
- **Built-in layouts** (`tenancy/layouts.rs`): `teams` (rail, the default) and `console` (sidebar as a card,
  breadcrumb, tenant switcher in the navigation). Other layouts come from plugins of kind `layout`.
- **Navigation tree.** An app declares `[[nav]]` entries (`id`, `label`, `icon`, `place`, `parent`,
  `permission`; two levels, at most 40, labels translated in `[i18n.<lang>.nav]`). The context endpoint
  filters them by permission and drops groups whose children are all hidden. A page opens the app at
  `#/t/<tenant>/p/<plugin>/<place>`; `msk.at` tells the plugin UI the place.
- **Layout package** (kind `layout`, no resources, UI, KPIs or search): `layout/layout.toml` (pattern
  `rail|sidebar|drawer|launcher|areas|tabs`; `band` brand, breadcrumb, search `center|wide`, tenant
  `band|nav`; `nav.card`; `phone.nav` `drawer|launcher`; style defaults), `layout/layout.css`,
  `layout/images/*.png`. No JavaScript.
- **CSS check** (`mskp::layout::scope_css`). Only allowlisted properties; `display`, `visibility`,
  `position`, `content`, `z-index`, `@import`, `@font-face`, escapes and `<` are refused; `url()` only to
  the images of the package. Rules are scoped under `.mskl-<id>` (dots become dashes), so a layout styles
  the classes of the slots (`msk-band`, `msk-nav`, `msk-nav-item`, `msk-tab-item`, `msk-launcher-tile`,
  `msk-main`…) and nothing else.
- **Style** reaches the page as `data-style-radius|density|font|tabs|buttons` on `<html>`; the Layout and
  Style panels preview a change (`previewStyle`) before it is saved.
- **Band image.** PNG, at most 512 KB, from the layout package or from the Style of the platform or the
  tenant (the Style wins; the tenant inherits the platform's). The band colour is laid over it as a scrim
  from 0.30 to 0.85 (step 0.05) until the brightest cell of a 16×4 grid gives 4.5:1 with the band text.
  The kernel decodes the PNG (`png` crate) and refuses an image too bright even at 0.85
  (`band_image_contrast`); the client measures the same with a canvas and applies the scrim at runtime.
- **API.** `GET /api/layouts` (layouts, allowed, platform), `GET /api/layouts/{id}/layout.css`
  (`nosniff`), `GET /api/layouts/{id}/images/{name}`; `brand` carries style, band image and layout;
  `/brand/band` and `/api/auth/tenants/<slug>/logo/band` serve the image of the Style. A layout plugin
  that is turned off or removed falls back to `teams`; tenants never see layout plugins in their plugin
  lists. The sign-in page follows the style of the platform.
- **Official layouts** (`mosaikit-plugins`): `layout-workspace` (sidebar that opens and closes),
  `layout-suite` (launcher grid), `layout-project` (areas, with a band image), `layout-tabs` (tabs).

## 15. Known limits and next steps

- **Subdomains per plugin** are optional (a wildcard `plugin_url`, §9): with a single `plugin_url` all
  the plugin UIs share the untrusted origin.
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
