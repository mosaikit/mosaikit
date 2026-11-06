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
   - [8.12 The developer profile](#812-the-developer-profile)
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

**Calling an outside service from a plugin** (example: Notes, command `notes.translate`, «Translate» in the
detail of a note). The manifest declares the key and, for a self-hosted or configurable endpoint, a second
service with `address = true` (`translate-endpoint`, scopes platform and tenant):

```toml
[[service_keys]]
id = "translate"
label = "Translation service"
[[service_keys]]
id = "translate-endpoint"
label = "Translation service address"
address = true
scopes = ["platform", "tenant"]
```

The logic calls `ctx.http().fetch_with_key("POST", &url, Some(&body), "translate")`
(`http.fetch` with `"key": "translate"`): the host adds `Authorization: Bearer <key in use>` itself, so the
logic never holds the secret, and fails with «no key of the service … is set» when there is none. The
address may be an origin of `permissions.network` or the one in use for an address service the plugin
declares (so the Administrator, not the manifest, chooses the server). Every plugin request goes through
`webfetch::request`, the same guard as the page probe: http and https only, public addresses only (a
private or loopback address needs `allow_private_fetch`, development and tests only, or an exact `host:port` in
`allow_private_fetch_hosts`, see below), the connection pinned
to the address checked, redirects followed only for a GET, answer cut at 4 MB. A command answers a missing
key or address with `{ ok: false, reason }` (`no_key`, `no_endpoint`, `key_rejected`, `service_error`,
`unreachable`) so its UI says what to do. In tests a double server records the request (see
`a_plugin_calls_a_service_with_its_key_and_only_where_allowed` in `crates/kernel/tests/plugin_lifecycle.rs`);
no test calls a real service.

**Internal services (`allow_private_fetch_hosts`).** A deployer who runs a service on the private network (a
translation engine, say) lists it in `mosaikit.toml`: `allow_private_fetch_hosts = ["translate.internal:5000"]`
(env `MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS`, comma separated). Only exact `host:port` entries are accepted (no
wildcards, no CIDR ranges, no scheme or path): a malformed entry stops the start with a clear error. An entry
lifts the public-address rule only for a plugin whose manifest lists that origin in `[permissions] network`
(the permission check runs first, so another plugin, another port or another host stays refused); the name is
resolved and the connection pinned to the address as for any other destination, and every redirect hop is
checked again. The same exact entries also lift the rule for the page probe of Sites (New site > Web address): an
address whose `host:port` is listed is looked at, any other private address or port stays refused, and a redirect to
an unlisted private host is refused at that hop. `allow_private_fetch` (everything, development and tests only) is unchanged. Test:
`deployer_allow_list_of_private_destinations` in `crates/kernel/tests/plugin_lifecycle.rs`.

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
- Policy of the tenant: `public_links_enabled`, `public_link_max_days`, `public_commands_enabled` (default off, §8.13).
- URL: `{public_url}/p/{token}` on the **untrusted origin**. If the resource has
  folder content (static site) it is served as it is; otherwise the
  public viewer of the plugin opens (`public_view` in the manifest), which receives
  only the data of that resource (and of its children). That page may also read the settings its
  plugin marks public and run the commands it declares for public links (§8.13).
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

**Rows a reader writes (`[[tables]]`).** By default only a person with the write permission on the resource of a row writes it. A plugin that keeps
rows people write about a resource they may only read (who is looking now, comments, favourites) declares the table:

```toml
[[tables]]
name = "presence"
insert_for = "reader"          # the only value
owner_column = "user_id"       # uuid column with the person who wrote the row (default user_id)
```

For that table the three write policies become `(core.can_access(resource_id, 2) or (core.can_access(resource_id, 1) and user_id = core.ctx_user()))`: a person who
**sees** the resource inserts rows whose owner is themselves, and changes or deletes the rows that are theirs; the rows of another person stay out of reach, and so
does a resource they cannot see. Everything else about the table is unchanged (the tenant is still the one of the context). The table must have the owner column
as `uuid` (the install refuses it otherwise); other tables keep the default. On SQLite the same rule is in the triggers and in the rewriting of `update` and
`delete`; the manifest is read from `core.plugins`. Tested on both backends (`a_reader_writes_only_the_rows_that_are_theirs_where_the_table_says_so`).

The read policy is a **set**: `core.ctx_levels()` (what the person of the context sees in the current
plugin, public links included, the same rules as `can_access()`) is computed once per statement and
the rows are kept by key, instead of one `can_access()` call per row (a third of the time of a list).
The writes keep the check per row: they touch one row, or few. The role of every plugin may execute
`ctx_levels()` (the function reads only the context, it takes no argument). The equivalence of the two
rules is checked on the data of the load test (`tests/perf/check_rls.sql`) and by the tests of the
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
among all the members). **Sort of the whole list**: `&sort=<field>&dir=asc|desc` sorts the WHOLE
filtered list, not the rows already loaded. Every paged endpoint has an allow-list of sortable fields, each mapped
to a fixed SQL expression (the request never reaches the SQL); an unknown field or direction is a 400 with the
translatable code `sort_unknown`. The order is total (the sort key, then the id), so pages are deterministic; a
sorted list pages by offset (`next` is `~<offset>`) because the key is not unique and may be null (nulls last).
The visibility rules (tenant, owner, RLS, ACL, policy of titles) are applied before the sort and do not change; a
column whose value is computed per page or joined (counts, groups, what an event is about) has no server sort and its
title is plain text. Sortable: Tenants (`name`, `slug`, `status`, `created`, `trial_until`, `archived_at`), People
(`name`, `username`, `home`, `status`, `last`), Manage › People (`name`, `username`, `role`, `status`, `home`, `last`,
`joined`), Manage › Items (`item`, `app`, `owner`, `size`, `created`, `updated`; `item` only means something when the
manager may see titles), invitations (`person`, `role`, `status`, `created`, `expires`), Trash (`item`, `app`, `owner`,
`size`, `deleted`, `purge`), Log (`when`, `who`, `what`, `tenant`, `result`; `offset` instead of `before`). In the UI the
`key` of a column is the field (`Col.serverSort` marks the columns the server sorts; `ListTable` then sends
`sort`/`dir`, the query key includes them so the list reloads from the first page and scrolls to the top; local lists
keep sorting in the browser, `aria-sort` stays). **Plugin lists** (`crud.list` with `limit`, `sort`, `dir`; the
`msk.crud(...).list` options and the `gridTable` option `server`/column `serverSort` of the plugin API): `sort` is a
declared field of the manifest that is not `hidden` (computed), or `created_at`, `updated_at`, `owner_name`;
`mountCrud` sorts by the declared fields and the owner, not by extension fields. **Select all**: on a page where every shown row is selected the shell offers
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

How to write, test, sign and ship a plugin, step by step and field by field: the development kit documents in
[devkit/README.md](devkit/README.md). This section is the reference of the platform side.

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
description = "Personal and shared notes"
author = "Mosaikit"      # brochure (all optional): author, license, homepage, details, screenshots
license = "Apache-2.0"
homepage = "https://example.org/notes"
details = "Longer text of the plugin page.

Paragraphs are separated by a blank line."
screenshots = ["notes-1.png"]   # images of media/ (png, jpg, webp, svg), at most 8
kind = "app"             # app | service | extension | layout | language (required in new plugins)
icon = "notebook-pen"    # icon of the shell (Lucide); unknown names: a default icon

[contribution]           # kept for older hosts (emoji icon and label); the shell uses name and icon
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
notify = false           # the logic may send notifications (host operation `notify`, §8.3)
script_eval = false      # the UI may compile code at run time (CSP 'unsafe-eval', §9); sensitive
files_read = false       # the logic may read the Files area as the caller (`files.list|describe|read`, §8.3); sensitive
resources_read = []     # plugins whose resources the logic may list as the caller (`resources.list`, §8.3); sensitive, needs `[requires] mosaikit = ">=1.0"`
embeds = []             # plugins whose pages (`[[embeds]]`) this plugin shows in a frame of its own page (`embed.url`, §8.15); sensitive, needs `[requires] mosaikit = ">=1.0"`
contributions = []      # points whose contributions the logic may list and whose contributors it may call (§8.3); sensitive, needs `[requires] mosaikit = ">=1.0"`
web = false              # the UI may ask the host about a web page (`msk.web.probe`: may it be framed, title, picture)
run_commands = []        # commands a run ticket may call on behalf of a person (§8.14); sensitive, needs `[requires] mosaikit = ">=1.0"`

[requires]               # optional
mosaikit = ">=1.2, <2"   # versions of Mosaikit it works with (a range; absent: any)
api = 1                  # plugin API it was built for (an integer; absent: the current one)
database = "postgres"    # uses PostgreSQL functions: it does not install on SQLite
extensions = ["postgis"] # they must be installed in the database

[[nav]]                  # optional: the pages of an app in the navigation of the shell
id = "archive"           # unique in the plugin
label = "Archive"
icon = "archive"         # icon of the shell (Lucide)
place = "archive"        # where it opens the app (`msk.at`); absent: the id
parent = "all"           # the entry it is under (two levels at most)
permission = "export"    # shown only to whoever has this permission of the plugin

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
public = false           # true: a public link page may read it (`msk.publicConfig()`, §8.13); never for a secret

[[public_commands]]      # optional: commands any holder of a public link may run, read only (§8.13); sensitive
name = "tile_ticket"
description = "A ticket to load the map of the shared item"
max_arg_bytes = 1024     # optional, at most 16384

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
actions to another plugin (§8.9) and needs `[extends]`; a **layout** arranges the slots of the shell
(`layout/layout.toml`, a style and images: declarative, never code); a **language** brings a language of
the interface (`[language]` with `code` and `name`, texts in `lang/`: never code). People who work see
the apps; the Administrator and the Tenant Managers see every plugin with its kind. `icon` names an icon
of the set of the shell; the shell draws only the names it knows (a manifest cannot load an image).
New plugins state `kind`; when it is absent the kernel derives it (`extension` with `[extends]`, `app`
with `[ui]`, else `service`), a rule kept for old manifests.

**Navigation.** `[[nav]]` lists the pages of an app (two levels): opening an entry opens the app at its
`place`, which the UI reads as `msk.at`. An entry with children and no `place` is only a group; `permission`
hides the entry from people who lack that permission of the plugin. The labels have a translation under
`[i18n.<lang>.nav]`.

**Brochure.** `author`, `license`, `homepage` (an `http://` or `https://` address), `details` and
`screenshots` fill the page of the plugin in Plugins and in the catalog. All optional.

**`web`.** `[permissions] web = true` lets the UI call `msk.web.probe(url)`: the host fetches the page (only from
public addresses) and says whether it may be shown in a frame, its title and, on request, its picture.

**Compatibility.** `[requires] mosaikit` is a range of versions of Mosaikit (comma-separated comparators
`>=`, `>`, `<=`, `<`, `=`, `^`, `~`; a bare version is `^`, so `"1.2"` means `>=1.2, <2`) and `[requires] api` the
plugin API the plugin was built for (§8.11). The kernel refuses a plugin outside the range, or built for another
API, with one error (`plugin_incompatible`) that names the range and the version of the kernel; the error is
translated by the shell, and Plugins › Updates marks the version of the catalog that cannot be installed with
the same reason (the registry index carries `mosaikit` and `api` of each version). The old keys `abi` and
`min_kernel` (a lower bound only) still work for one major version: when `[requires]` does not say, `abi`
gives the API and `min_kernel` the lower bound of the range, and a plugin loaded from its folder in
development logs a warning for each. A kernel that does not know `[requires]` rejects the manifest (every
table denies unknown keys): release the kernel that reads it before the first plugin that uses it.

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
answer `{"ok":…}` or `{"err":"…","code":"…"}`: the optional `code` is a stable name of the error chosen by the
logic (`[a-z][a-z0-9_]*`, at most 48 characters; the SDK writes it with `Error::coded("invoice_locked", "…")`) and
reaches the UI of the plugin as `BridgeError.code` (§8.11); without it the UI gets `plugin_error`. The message
stays the one shown to the person. Host operations: `db.query`, `db.exec`,
`resource.create`, `resource.delete`, `http.fetch` (only towards `network` or the address of an address service
of `[[service_keys]]`; with `"key"` the host adds the key of that service),
`plugin.call` (only towards `calls`, §8.6), `key.get` (only for the `[[service_keys]]`), `notify`
(only with `[permissions] notify = true`), `files.list`, `files.describe`, `files.read` (only with
`[permissions] files_read = true`, below) and `resources.list` (only towards the plugins of `resources_read`, below).

An error of a host operation may carry a stable `code` too: `{"err": "…", "code": "…"}` (`Host::error_code` in
the runtime); the SDK turns it into `Error::coded`, and a logic that returns it unchanged gives it to its UI.

**Context of the call** (`ctx`, `Ctx` in the SDK; old plugins ignore what they do not read): `user`,
`username`, `tenant` (ids), `plugin`, `perms` (permissions of the caller, §3.2), `config` (settings of
the plugin) and `groups` (a public command has no `user` and gets `public`, `link_resource` and no secrets in `config`: §8.13): the groups of the tenant the caller belongs to, by name, as
`[{"id": "<uuid>", "name": "Field"}]` (`[]` when none; never groups of other tenants; read at every
call). In tests: `MockHost::new().with_groups(&[("g1", "Field")])`.

**`files.list`, `files.describe`, `files.read`** (`[permissions] files_read = true`; default none): the logic of ANY
plugin reads the Files area with the permissions of the CALLER, the rules the Files UI applies (no one sees
more than in the UI; a public link is not a caller). Files and folders are kernel resources, so the operations
run on a read transaction of the plugin that owns them (`plugin`, default `com.mosaikit.files`; it must be on for
the tenant, declare `files`, and the caller needs `use` on it) with the context of the caller: ownership, ACL
and sharing come from `core.visible_resources`. Requests: `files.list {parent?}` (root if absent) answers
`{"entries": [row…], "truncated": bool}` (at most 1000 rows); `files.describe {id}` answers one row;
`files.read {id, max_bytes?}` answers `{"entry": row, "base64": "…", "size": <bytes returned>, "truncated": bool}`.
A row is `id, name, is_dir, size, mime, created, modified, owner_id, owner_name, my_level, shared, parent_id`:
no storage path, no internal key, no secret. `max_bytes` is cut at the hard ceiling of the kernel, 4 MiB
(`files::HOST_READ_CEILING`); only the head of the file is read from disk, and `truncated` says that the file is
longer. Errors have a code (Plugin API 1): `permission_denied` (the manifest has no `files_read`),
`not_found` (missing, or not visible to the caller: the two cannot be told apart), `invalid_argument` (bad id,
a folder given to `files.read`, bad `max_bytes`). SDK: `ctx.files().list(parent)`, `.describe(id)`,
`.read(id, max_bytes)`. The Administrator sees the permission in the plugin's «What it asks».

**`resources.list`** (`[permissions] resources_read = ["<plugin id>", …]`, at most 16; default none; `[requires] mosaikit = ">=1.0"`): the logic lists the
resources of ANOTHER plugin that the CALLER sees, for a picker (a map, a dashboard or a document to publish or to link). The manifest names the plugins; the
call runs on a read transaction of the target plugin with the context of the caller, so the rows are those of `core.visible_resources` (ownership, ACL and
sharing of the owner; the target must be on for the tenant and the caller needs `use` on it). Request `{plugin, kind?, q?, limit?}` (`kind` is the kind of
resource, `q` a part of the title, at most 64 characters; `limit` 50 by default and 200 at most) answers `{"entries": [{id, plugin, kind, title, owner_name,
my_level, updated_at}], "truncated": bool}`, folders left out, newest first. No body, no content, no storage path. Not available in a public link. Errors:
`permission_denied` (the plugin is not in `resources_read`, or the caller may not use it), `invalid_argument`. SDK: `ctx.resources().list(plugin, kind, q, limit)`.
The Administrator sees the permission in the plugin's «What it asks».

**Contributions** (`[[contributes]]` in the contributor, `[permissions] contributions = ["<point>"]` in the plugin that collects them; `[requires]
mosaikit = ">=1.0"`): a plugin plugs into a point another plugin offers (a provider of data for a hub, a kind of widget for a dashboard) without the
host keeping a list of plugins. The contributor declares `[[contributes]]` with `point` (lowercase letters, digits, `.`, `-`, `_`, at most 64), `id` (the
same, unique per point in the plugin), optional `label` (at most 120 characters) and `data` (a TOML table of at most 4 KiB: its shape is defined by the point
and it is never executed); at most 16 per plugin. The collector declares the points it reads (at most 16). The host operation `contributions.list {point}` answers
`[{ plugin, id, label, data }]` for the plugins that are on in the tenant and that the caller may use, ordered by plugin and id; a point the manifest does not
declare is `permission_denied`. A plugin that contributes to a declared point can also be called with `plugin.call`, as if it were in `calls` (the called plugin
runs in its own transaction and with its own rules, §8.6). SDK: `ctx.resources().contributions(point)`. The Administrator sees the permission in «What it asks».

**`notify`**: `{"op":"notify","req":{"title":"…","body":"…","at":"notes/2f1c","resource":"<uuid>"}}`,
answer `{"ok":null}`. SDK: `ctx.notify(&Notice::new("Title").body("Text").at("notes/1").resource(id))`.
`title` is required (cut to 160 characters), `body` optional (600). The plugin never names recipients:
without `resource` the notification goes to the caller alone; with the id of an item of the same
plugin and tenant, on which the caller has the write level, it goes to the people who can see the
item, the caller excluded. `at` is a place inside the plugin (letters, digits and `/_-.=&?%:`, up to
200): the link is always `#/t/<tenant>/p/<plugin>/<at>`, never an outside address. The limits are the
ones of `msk.notify` in the bridge: 30 a minute for each person and plugin, no other tenant, source =
the plugin itself (kind `plugin`, same preferences and email rules). A wrong shape or the limit fail the
call at once; the people are resolved and the notifications sent **after the operation commits**, so a
rolled back operation notifies nobody and the item a hook just created can be named by a later call. A
refusal then (no write level, item of another plugin or tenant) is logged and does not fail the
operation. In tests `MockHost::notifications()` lists what the logic sent.

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

const msk = await connect()                 // handshake: API version, language, theme, mode, user, tenant
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

**Tables and empty states.** A list of your own draws its rows with `gridTable` (fixed header row, only the rows scroll,
sortable titles, the foot as the last row; `.msk-grid` in `style.css`), and a page or list with nothing in it with
`emptyState({ art, title, text, actions })`, never a bare «no items» line (`filteredEmpty` for a filter that matches
nothing). `mountCrud` does both by itself (option `empty` for the picture, title, text and buttons).

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

### 8.11 Plugin API 1: versions, errors, events, deprecation

**What the API is.** The contract between a plugin and the kernel: the manifest (§8.2), the logic ABI and the
SDK crate (§8.3), the bridge and the UI package (§8.4). It has one number, **the plugin API**, an integer that
grows only with a breaking change. This Mosaikit speaks **API 1**. A plugin declares the API it was built for
with `[requires] api` and the kernel refuses any other (§8.2). The two packages that carry it have a version of
their own and a changelog: `mosaikit-plugin-sdk` (`crates/plugin-sdk`) and `@mosaikit/plugin-api`
(`ui/plugin-api`); a release of Mosaikit that changes the API raises both.

**Handshake of the UI.** `connect()` sends `hello` with `{ api: API_VERSION }` (the number the package
implements); the host answers `Hello` with `api`, the API it speaks. The host refuses a plugin built for a newer
API than its own with the error `incompatible_api` (and tells the person with a toast), and speaks every API up to
its own. The package refuses a host older than the API it needs with the same code (`isIncompatible(e)` tells it
apart, the page may show a message of its own); `msk.api` is the API of the host. A host or a plugin that
predates the handshake sends no number and counts as API 1. The public-link viewer answers with `api` too.

**Error codes.** An error of the bridge carries `BridgeReply.code` and `BridgeError.code`, typed as `ErrorCode`
in `@mosaikit/plugin-api`: switch on the code, never on the text. The kernel and the host use the codes of
the type (`missing_permission`, `plugin_off`, `base_off`, `quota_exceeded`, `content_too_large`, `too_many_rows`,
`sort_unknown`, `item_exists`, `web_blocked`, `maintenance`, `server_unavailable`, `forbidden`, `not_found`,
`plugin_error`, `incompatible_api`...). An error raised by the logic is `plugin_error` for the shell (which shows
its message) and, when the logic gave it a code, that code for the UI of the plugin (`plugin_code` in the JSON
of the server): the type is open (`string & {}`) for these.

**Events of the host.** `context` (language, theme, mode: `msk.onContext`), `theme` (**deprecated**, the same
variables as `context`; still sent in API 1, removed in API 2), `ext.changed` and `ext.tab.height` (extensions,
§8.9). `HostEvents` types what each carries and `msk.onEvent` names them.

**Public surface.** The UI package exports only what `index.ts` lists; the bridge class, the wire types, the
theme helpers and the pictures of the host pages are internal. In the SDK, `Ctx` is `#[non_exhaustive]` (build
it with `Ctx::default()`), and `abi`, `Registry` and the macro plumbing are `#[doc(hidden)]`.

**Deprecation rule.** A deprecated item (manifest key, SDK function, UI export or event) stays for one major
version of the API, is marked `@deprecated` (or `#[deprecated]`) with what replaces it, logs a warning in
development where it can (the kernel for manifest keys) and appears in the changelog of the package; it is removed
in the next major version. Deprecated in API 1: the manifest keys `abi` and `min_kernel`, the `theme` event and
the emoji `[contribution]` (now optional: absent, the name labels the plugin).

**Experimental.** Part of the surface has kernel tests but no official sample plugin yet, so API 1 does not
promise it will stay as it is until a sample (or a template of the dev kit) uses it: `[[config]]` and
`ctx.setting`, `[[user_permissions]]` and `ctx.can`, `permissions.calls` and `plugin.call`, `ctx.notify` and
`msk.notify`, `network` and `http.fetch`, `script_eval`, `[search]`, the `command` actions of an extension,
`CrudOptions.panel`, `Resources::create` and `Resources::delete` of the SDK, `[[config]] public`, `[[public_commands]]`, `msk.publicConfig` / `msk.publicCall` and `ctx.link_resource()` (§8.13), `permissions.run_commands` and `ctx.on_behalf()` (§8.14). A change to one of them is announced in
the changelog of the package, with the deprecation rule applied when a distribution relies on it.

### 8.12 The developer profile

A server started for a plugin developer (the development kit, `docs/plugin-devkit-plan.md`, phase 4). It is one switch,
`developer_profile = true` in `mosaikit.toml` (environment `MOSAIKIT_DEVELOPER_PROFILE=1`), **never the default** and never
reachable from a tenant, a plugin or the API: it is read once at start, from the file or the environment of whoever starts
the process, and not stored in any setting.

**What it switches on** (`Config::derive`, `crates/kernel/src/devprofile.rs`):

| What | Effect |
|---|---|
| plugin folders | the folders of `[dev] plugins` (or `MOSAIKIT_DEV_PLUGINS`) are loaded as plugins in development: no package, hot reload of the manifest, the migrations, the UI (`ui/dist`) and the logic (the `.wasm` of the folder's own `target/`, or of its workspace) |
| unsigned packages | `allow_unsigned = true`, so a package made by `mosaikit-plugin pack` with a throwaway key installs |
| plugin origin | `plugin_url` defaults to `http://*.localhost:<port+1>`: every plugin UI keeps its own origin (§9), which the browser resolves to this computer |
| second factor | `admin_totp = false` |
| accounts | the tenant `dev` and the accounts `admin` (Administrator), `manager` (Tenant Manager), `alice` and `bob` (Users), all with the password `mosaikit-dev`, made once with the tenant |
| sample content | a group, a welcome notification for Alice and Bob, entries in the Log and, when a plugin in development declares a resource, one item of it shared with Bob |
| API | `/api/dev/info` (the accounts, public), `/api/dev/plugins/{id}/manifest`, `/api/dev/plugins/{id}/reset`, `/api/dev/switch-user`; the routes are added to the router only while the profile is on, so a normal server answers 404 |
| shell | a banner that cannot be closed, and the **Developer tools** (§ below) |

**Guards.** The profile has known passwords and no signature check, so `Config::developer_guard` makes it refuse to start (the
message names every reason) when any of these holds: `listen` or `plugin_listen` is not a loopback address; `url` or `plugin_url`
is not an address of this computer (`localhost`, `*.localhost`, `127.x`, `::1`); `database.url` points to another host;
`trust_proxy` is on. After the database is open the seed refuses a database that has a tenant besides `dev` (it may hold real
data). A single explicit flag lifts the guards, `developer_profile_allow_remote = true`
(`MOSAIKIT_DEVELOPER_PROFILE_ALLOW_REMOTE=1`): the Docker kit needs it, because the container listens on every interface of its
own network and the database is another container; its compose file publishes the ports on `127.0.0.1` only. While the
profile is on the server writes a warning to its log and to the standard error at start, `/api/health` and the session carry
`developer: true`, and the shell shows the banner before and after sign-in. With the profile off nothing changes: signatures,
origins, CSP, second factor and routes are those of §9; a test (`crates/kernel/tests/developer_profile.rs`, and
`crates/server/tests/http.rs`) proves that a default start has no test tenant, no test users, no switch of users and refuses
unsigned packages.

**Developer tools** (`ui/host/src/app/DevTools.tsx`, drawn only when `/api/health` says `developer`): a panel with the
manifest as the server reads it (it follows the file), the host calls of the plugin with their time and their errors (recorded
by the bridge only while the profile is on, `devlog.ts`), the permissions of the signed-in user on the plugin, the switch between
the four test users (a session without a password: `identity::dev_session`) and a button that deletes the data of the plugin and
runs its migrations again (`plugins::wipe`, then the plugin is loaded again from its folder; the tenants keep it on). A migration
that changed after it ran is refused at reload with a clear message; the shell then asks, once, whether to delete the data of
the plugin and run the migrations again from the first one.

**The two kits.** The desktop kit is `mosaikit-plugin dev` (`crates/plugin-cli/src/dev.rs`): it writes a configuration for the
plugin folder (loopback ports, SQLite in `.mosaikit-dev/`, the profile on), starts the `mosaikit-server` of the kit, waits for
`/api/health`, opens the browser, prints the addresses and the test users, and rebuilds the logic or the UI when their sources
change. The Docker kit (`cargo xtask release devkit-docker`, `deploy/compose.devkit.yml`) is the same image tagged
`mosaikit-dev` with PostgreSQL and the plugin folder as a volume, to check migrations and row level security against the real
database.

**Tests and conformance** (phase 5). `mosaikit-plugin validate --strict` is the static conformance suite (`crates/plugin-cli/src/conformance.rs`):
permissions against the host operations the logic calls (read from the Rust source of a folder, from the literals linked into
`logic.wasm` for a package), the migrations (numbering, no irreversible statement, the guard of PostgreSQL and the translation for SQLite),
the UI (size, outside requests, what the plugin CSP of §9 blocks), i18n coverage and the layout contract of `mountCrud` pages;
`mosaikit-plugin test` runs it before the tests of the logic. The logic is tested natively with `MockHost` (`crates/plugin-sdk/src/testing.rs`,
with a recipe for `db.query`, `notify`, `call_plugin`, permissions and the Files area) and end to end with `@mosaikit/plugin-testing`
(`ui/plugin-testing`), which starts or attaches to this server, signs in as a test user, opens the plugin, creates an item and runs axe.

### 8.13 Public pages: settings and commands

What the page of a public link (§5) may ask of its plugin. Both are additive keys of API 1 (no version bump, §8.11): a plugin that uses
them declares `[requires] mosaikit = ">=1.0"`, because every struct of the manifest refuses unknown keys, so an older Mosaikit
rejects the manifest (fail closed). `mosaikit-plugin validate` warns (an error with `--strict`) when the range is missing.

**Public settings.** `[[config]]` takes `public = true` (default false, opt-in key by key). The manifest is refused when a `secret`
is `public`. `plugins::config::public_values(plugin)` returns the non-secret values of the keys marked public (the manifest default
where the Administrator chose none); the secrets never pass through it. The page reads them with `GET /p/{token}/config` (the link is
checked first: revoked, expired, tenant policy, plugin off, password) and the UI with `msk.publicConfig()` (host op `public.config`
of the public viewer, which still refuses every other op). The plugin is always the one of the link.

**Public commands.** `[[public_commands]]` (`name`, `description`, optional `max_arg_bytes`, at most 16 KiB) lists the commands of the
logic that any holder of the link may run. The Administrator sees them in «What it asks» when the plugin is installed. The page runs
one with `POST /p/{token}/call/{name}` (JSON body = the arguments, at most 32 KiB; `Content-Type: application/json` is required, so a
cross-site form cannot send it) and the UI with `msk.publicCall(name, args)` (host op `public.call`). `crud::call_public` does,
in order: the link is resolved again on **every call** (`open()`: revoked, expired, trashed, plugin off, password cookie), the name must
be declared (`403 command_not_public`), the tenant policy `public_commands_enabled` must be on (**default off**, set by the Tenant
Manager in Manage › Settings; `403 public_commands_off`), the arguments must fit (`400 args_too_large`), and the rate limits hold
(30 calls a minute for a link, 300 for a tenant; `429 public_rate_limited`). It then runs the logic in a **read only** transaction
(`set transaction read only` on PostgreSQL) with the link context and **no user**:

| Host op in a public command | |
|---|---|
| `db.query` | SELECT only (a write, even with `returning`, is refused); RLS limits it to the item of the link and its descendants |
| `http.fetch` | only the origins the plugin declares in `permissions.network`; with `key`, the key is added by the host |
| `key.get` | the tenant's shared key, else the platform's; **never a personal key**, not even the link creator's |
| everything else (`db.exec`, `resource.*`, `plugin.call`, `notify`, `files.*`) | refused (default deny) |

`ctx` of a public command: `public = true`, `link_resource` (SDK `ctx.link_resource()`), `tenant`, `plugin`, empty `perms` and
`groups`, no `user`, and `config` **without the secrets** (a secret is reachable only through `http.fetch` with `key`, which never shows
the value). The fuel is a quarter of a normal command (`FUEL_PUBLIC`). The audit event `link.call` (link, plugin, command; no
arguments) is written at most once a minute for a link, so an anonymous caller cannot flood the log. Nothing else is minted: the link
token is the credential, so a stolen link has the exposure of the page itself, and there is no path to a session.

**What the kernel cannot do, so the plugin author must.** The kernel limits what a public command can READ (the item of the link, the
keys of the tenant); it cannot limit what the logic RETURNS, and WASM may return data it legitimately read. Review checklist for every
public command: (1) never put a setting, a key or anything from `ctx.config` in the answer; (2) never take the id of the item from the
arguments, use `ctx.link_resource()` only; (3) treat every argument as chosen by a stranger; (4) remember that an outside request made
with `key` spends the tenant's or the platform's paid key for an anonymous visitor, so keep it small and cache what you can.

### 8.15 Embedded pages: a page of one plugin inside the page of another

A plugin may show a page of another plugin (a viewer of one of its resources: a map, a chart) in a frame of its own page, and the two pages
may talk. It works with what exists: each plugin keeps its own origin, and the frame carries a **run ticket** (§8.14) limited to one resource.

**Manifest.** The plugin that offers the page declares `[[embeds]]` (at most 8): `name`, `entry` (an `.html` page of its UI), optional `contract` (a name for the
messages the two pages agree on, for example `geo-embed/1`), optional `resource_kind` (the page shows only resources of that kind), and `commands` (1 to 16 commands
the page may call; each must be in its `permissions.run_commands`). The plugin that embeds declares `[permissions] embeds = ["<plugin id>"]` (at most 16, needs
`[requires] mosaikit = ">=1.0"`; sensitive, shown in «What it asks»). Neither side can do it alone.

**`msk.embeds.url({ plugin, name, resource })`** (REST `POST /api/t/{t}/p/{host}/embed/url`) answers `{ url, expires_at, contract, resource }`. The kernel checks that the
host declares the plugin in `embeds`, that the plugin declares the embed, that the person uses it, and that the resource belongs to it, has the kind of the embed and is
visible to the person now (else `404`, as for any resource that cannot be seen; `403 permission_denied` for the declaration). It then mints a run ticket for the person limited
to that resource and to the `commands` of the embed (60 minutes, 1000 calls; the page of the host asks again before `expires_at`) and answers the address of the page on the
origin of its plugin: `…/ui/{plugin}/{entry}?embed=<ticket>&plugin=…&resource=…&api=<origin of the platform>`.

**The frame.** The host opens it in an `iframe` with `sandbox="allow-scripts"` (no origin of its own, no cookie, no access to the shell). The CSP of the pages of the host
gets the origin of the embedded plugin in `frame-src`, and the CSP of the embedded page gets the origin of the hosts that declare it in `frame-ancestors`; nothing else
changes. The embedded page reads its address with `embedSession()` of the UI package and calls its plugin with the ticket (`POST /api/run/{ticket}/call/{plugin}/{command}`, which
answers CORS for any origin because the ticket is the only credential): it reads with the rights of the person who looks, only the resource, only the commands of the embed.
A page opened that way has no bridge to the shell (`msk.*`); what it tells the host and the host tells it goes over `window.parent.postMessage` under the contract of the embed
(`event.source` is checked on both sides; the platform sets no shape for the messages).

**In a public link view.** The same `msk.embeds.url` works in the page of a public link (§8.13), but the ticket is not a person's: nobody is signed in, so it
is tied to the link. The shell of the public page answers the call (`POST /p/{token}/embed`, JSON body `{ plugin, name, resource }`, at most 2 KiB; the link is resolved
again first, as for a public command) with `embeds::public_url`, which requires, in order: the tenant allows public commands (`403 public_commands_off`); the plugin
of the link declares the other one in `permissions.embeds` (`403 permission_denied`) and the other plugin declares the embed (`404`); the `resource` is the shared one
or a descendant of it and has the kind of the embed (else `404`: what the link cannot see does not exist; it is a resource of the plugin of the link, because a resource never has a
parent of another plugin, so the embedded plugin keeps its own data for it in its own tables); and at least one command of
the embed is also in `[[public_commands]]` of the embedded plugin (`403 command_not_public`). The ticket is **not stored**: `pe.<payload>.<mac>` with the payload
`{ link, resource, plugin, embed, expiry }` (60 minutes) and `mac` the HMAC-SHA256 of the payload and of the password of the link under the secret of the server (so a
new password of the link kills the tickets made before). A person's run ticket is 48 hex characters; the prefix `pe.` tells them apart, and the same route answers
(`POST /api/run/{ticket}/call/{plugin}/{command}`, so `embedSession()` works as it is).

`embeds::call_public` checks everything again on **every call**, in this order: the link by its id (revoked, expired, trashed, plugin off, tenant policy: the ticket
dies with the link), the signature and the expiry (`401 run_ticket_invalid` for all of them), the plugin of the ticket (`403 run_wrong_plugin`), the declarations of both
plugins **as they are now**, the command (`403 run_wrong_command` when the embed does not list it, `403 command_not_public` when the plugin does not expose it as public),
and the resource (it must still be under the link and of the kind of the embed). It then runs `crud::call_public` like any public command (read only, no user, `perms` and
`groups` empty, no secrets in `config`, the rate limits of the link, the audit event `link.call`), with the link **narrowed to the resource of the frame**: the database
shows the command that resource and its descendants only, and `ctx.link_resource()` is that resource. A person's rights never enter, and the ticket can never do more
than the link grants: the page of the host and the embedded page share the 30 calls a minute of the link. The CSP needs no change: the page of the host and the embedded
page already list each other (`frame-src`, `frame-ancestors`), and the public origin is already an ancestor of every plugin page. The review checklist of §8.13 applies to
the commands that an embed exposes: they run for a stranger.

### 8.14 Run tickets: a plugin called on behalf of a run

A distribution may run a process in the background (a graph of nodes, a report) where a node is a command of a plugin. The service that
runs it is an outside program with no session, and a run outlives the session of the person who started it. A **run ticket** lets
that service call one plugin for a while, **as the person**, with the limits below. It is not a session and is never accepted on
`/api/t/...`; it is not the file ticket of §5 either (that one is tied to a session). `permissions.run_commands` is an additive key
of API 1 (no version bump, §8.11): a plugin that uses it declares `[requires] mosaikit = ">=1.0"` (an older Mosaikit rejects the
manifest, fail closed); `mosaikit-plugin validate` warns, an error with `--strict`, when the range is missing, and lists it among the
permissions the Administrator reviews.

**Manifest.** `[permissions] run_commands = ["node_run", ...]` (identifiers, at most 32) are the only commands of the plugin a run
ticket can ever call. The Administrator sees them in «What it asks» when the plugin is installed.

**Mint.** `POST /api/t/{t}/run-tickets` with the session of the starter (cookie and CSRF as any request), body `{ plugin, commands,
run_ref, ttl_minutes?, uses?, resources? }`. The kernel (`run_tickets::mint`) requires the permission `use` of the plugin now; each
command must be in `run_commands` (`403 command_not_declared`); `run_ref` is the service's own name for the run (1 to 128
characters, no control characters, shown in the Log); `ttl_minutes` 1 to 60 (default 15); `uses` 1 to 1000 (default 100);
`resources` (optional, at most 64) must each be visible to the starter now and belong to the plugin. Per person: 30 mints a minute
and 100 live tickets in a tenant. The answer carries the token **once** (24 random bytes, 48 hex characters); the table
`core.run_tickets` keeps its SHA-256 only, with the person, the tenant, the plugin, the commands, the resources, the uses left, the
expiry and the revocation. Event `run_ticket.mint` (ticket id, `run_ref`, commands, expiry; never the token).

**Redeem.** `POST /api/run/{ticket}/call/{plugin}/{command}` (JSON body = the arguments, at most 256 KiB; no cookie, no CSRF,
`Content-Type: application/json` required) goes to `run_tickets::call`, which on **every call**: finds the ticket by hash (not
revoked, not expired, uses left: one answer, `401 run_ticket_invalid`, for every failure); checks the plugin and the command against
the ticket (`403 run_wrong_plugin`, `run_wrong_command`) and against the manifest **as it is now** (an update may have dropped the
command: `403 command_not_declared`); loads the person again (active account, active tenant, active membership, plugin on in the
tenant) and rebuilds a `Caller`, never the Administrator; applies the rate limit (120 a minute for a ticket, 1200 for a tenant;
`429 run_rate_limited`; a refused call spends no use); spends one use atomically (`update ... where uses_left > 0`); and runs
`crud::call_depth`, which checks the permission `use` and the groups of the person **at that moment**. The rights are never taken from
the mint: a person suspended, removed, with a share taken back or the plugin turned off loses the ticket's reach at once. The logic
receives `ctx.on_behalf = { run_ref }` (SDK `ctx.on_behalf()`; the arguments cannot set it). Event `run_ticket.call` (ticket,
`run_ref`, command, `ok`; no arguments). `DELETE /api/t/{t}/run-tickets/{id}` revokes (the starter or a Tenant Manager, event
`run_ticket.revoke`); the service ends its run with `DELETE /api/run/{ticket}`, which revokes too. During maintenance a call is refused.
The token is in the path (like a public link, §5): the server logs no paths, but a reverse proxy in front of it may, so redact `/api/run/` in its
access log. There is no CORS on these routes and JSON is required, so a page of another site cannot send a call.

**The resource scope (DB level).** With `resources`, the context of the transaction carries `scope` (`core.session_ctx.scope uuid[]`,
set by the six-argument `core.set_ctx`, migration 0021; on SQLite `core_ctx_scope()`). `core.level_of()`, `core.ctx_levels()` (so the
RLS of every plugin table and `visible_resources`) and the SQLite twin return level 0 for everything that is not in the scope or one
of its descendants, and `core.create_resource` refuses a root item: whatever the logic asks, in SQL or through a host operation, it
reaches only those resources, with the level the person has on them. Without `resources` the ticket has the person's whole reach for
the declared commands (use the scope for a sensitive plugin). A ticket of tenant A has no way to name tenant B: the tenant is the one
of the ticket and RLS filters on it.

**Host operations in a run call.** Same as a normal command, except `plugin.call` is **refused** (a ticket names one plugin; with the
person's rights it must not reach another one). That also keeps SQLite simple: a top-level redeem works there, while a nested
`plugin.call` stays PostgreSQL only (§8.6) and is not available to a run in any case. A distribution on SQLite desktop is an owner decision.

**What the kernel cannot do, so the plugin author must.** The kernel limits what a run command can READ (what the person may see,
cut to the resources of the ticket); it cannot limit what the logic RETURNS, and WASM may return data it legitimately read. Review
checklist for every run command: (1) take the ids it works on from its arguments but check them against what the database lets it
read (the scope already does for a ticket that has one); (2) never return a setting, a key or anything the caller of the run should not
see; (3) treat the arguments as chosen by the service, which may be compromised; (4) remember that it writes as the person, so keep
writes minimal and idempotent; (5) `ctx.on_behalf()` tells a run call from a person's own call: use it to be stricter, never looser.
Limits that remain by design: a ticket not scoped to resources is the person's reach for its commands until it expires, is spent or is
revoked, so keep the lifetime short and have the service call `DELETE /api/run/{ticket}` when the run ends.

### 8.15 Directory search: the people of the tenant for a plugin

A plugin sometimes needs to let a person pick another person or a group (an assignee, a reviewer, who to notify). It cannot do it
alone: `core.users` is not in the SQL guard (§8.6, only `visible_resources` of the core is) and `ctx.groups` lists the groups of the
caller only. The kernel offers one narrow operation instead, `directory.search`, in the logic (`ctx.directory().users(q, limit)`,
`.groups(q, limit)`) and in the UI (`msk.directory.search({ kind, q, limit })`, REST `POST /api/t/{t}/p/{plugin}/directory/search`). It
has its own query in `kernel::plugin_directory`; the SQL guard is unchanged and a plugin still cannot read `core.users`.
`permissions.directory` is an additive key of API 1 (no bump, §8.11): a plugin that uses it declares `[requires] mosaikit = ">=1.0"`;
`mosaikit-plugin validate` warns (an error with `--strict`) when the range is missing, and errors when the logic searches without the
permission.

**Who may.** (1) The manifest must say `[permissions] directory = true` (`403 permission_denied` otherwise, whoever asks); the
Administrator sees it as a red row «Searches the people and groups» in «What it asks» and as a chip in the brochure. (2) The caller must
have `use` of the plugin in the tenant (the plugin on in the tenant, as for any call) **and** be a Tenant Manager or hold the standard
permission `share` of that plugin: the same right that lets a person see the people of the tenant in the share dialog. The default
profile has it; a profile that takes it away takes this away too. Everyone else gets `403 permission_denied`.

**What it returns.** `kind` is `"user"` or `"group"`; `q` is 1 to 64 characters after trimming, no control characters, matched
case-insensitively as a substring of the username or display name (people) or of the name (groups), with `%` and `_` taken literally;
`limit` is 20 by default, a larger value is capped to 50, below 1 or not an integer is `400 invalid_argument`. People come as `{ id,
username, name }` and only if the account is active **and** the membership of the tenant is active; groups as `{ id, name }`. Nothing
else: no email, no picture, no role, no home tenant, no membership of groups. The order is fixed (name, then username, then id), so a
page does not shuffle. **The tenant is the one of the authenticated caller, never an argument**: an extra `tenant` field is ignored, and
a person of another tenant or a group of another tenant never appears, even when they also belong to this one's installation.

**Where it is refused.** In a public link (no caller: the host operation is outside the allowed ones, `permission_denied`) and in a call
on behalf of a run ticket (§8.14: nobody is at the keyboard to pick someone; `permission_denied`). The UI operation is a viewer
operation of the shell (`directory.search` of the bridge, routed to the REST call above), so it exists in the normal host only, never
in the public viewer.

**Limits and audit.** 30 searches a minute for a person and 300 for a tenant (`429 directory_rate_limited`, `rate_limited` in the
logic); a refused or invalid request spends no budget. The Log gets one `directory.search` event per person and plugin per minute at
most, with only the kind (`user` or `group`): **never the text searched and never the rows found**.

**What the kernel cannot do, so the plugin author must.** The kernel limits who may search and what a row contains; it cannot limit
what the plugin does with the answer. Rule for plugin authors: use the directory to fill the picker the person has on screen, keep
the answer only as long as that editor needs it, never copy the list into the plugin's own tables or settings, never return it from
another command or send it outside (`http.fetch`, `notify`), and store only the ids the person chose (a name can change; look it up
again when you show it). Do not search on every keystroke without a pause; the rate limit is a safety net, not a design.

### 8.16 The contextual top band: a resource on the full page

When a plugin opens the detail of a resource on the full page (a map, a dashboard, a process) the top band of the shell can change
to serve that page. The plugin declares it to the shell with `msk.band.set(state)` (bridge operation `band.set`) and gives the band
back with `msk.band.reset()` (`band.reset`). While the state is set the band (the rail layout, `ui/host/src/app/Shell.tsx`):

1. has no search bar when the plugin says `search: false`;
2. keeps the tenant (with its selector when the person has more than one);
3. shows a View | Edit switch when `mode.canEdit` is true, otherwise the label «Read only»;
4. shows the people connected to the resource: avatars with their initials (the name in the tooltip and for screen readers), the
   first three and «+N» for the others;
5. shows a button that opens and closes the comments of the resource;
6. shows an arrow-left button on the left, right after the tenant, when the plugin gives `back` (its label is the accessible name
   and the tooltip), for a page that has a way back such as the list of the plugin;
7. keeps, untouched, language, mode, help, notifications and the person (avatar, name and role).

```
msk.band.set({
  search: false,
  mode: { value: 'view' | 'edit', canEdit, onChange(v) },
  presence: [{ id, name, initials? }],
  comments: { resource },            // or { open, count?, onToggle() } to draw the panel yourself
  back: { label, onClick() },
})
```

**Comments on resources (native).** Any resource has a thread of plain-text comments in the platform (`core.resource_comments`, API 1,
additive). A page that passes `comments: { resource: "<id>" }` gets the comments button, its badge (refreshed every 30 seconds) and a
panel on the right of the frame from the shell, and writes no code for them. REST (session and CSRF as any `/api/t/{t}` route, the
right on the resource checked by the kernel): `GET /api/t/{t}/resources/{id}/comments` gives `{ comments: [{ id, author_id, author_name,
body, created_at, mine, can_delete }], count }` oldest first; `POST …/comments` with `{ body }` adds one; `DELETE …/comments/{cid}`
deletes one. Whoever **sees** the resource reads and writes (a reader too); a resource the caller does not see is `404`, as for every
other call. A comment is 1 to 2000 characters of plain text (the shell draws text nodes, never HTML; control characters other than line
breaks and tabs are refused: `comment_invalid`, `comment_empty`, `comment_too_long`), a resource holds at most 1000
(`too_many_comments`) and a person writes 20 a minute (`comment_rate_limited`). The author deletes their own and whoever **manages** the
resource deletes any (`403` for others). Comments go with the resource when it is deleted for good, are never part of a public link and
are not copied or exported with it. The audit log has `comment.add` and `comment.delete` with the resource and the comment, never the
text. A run ticket has no part in comments.

**Import.** A Tenant Manager brings the comments of another store with `POST /api/t/{t}/resources/{id}/comments/import` and `{ comments: [{ external_id, author_id, body, created_at }] }` (1 to 1000 per call). Each comment keeps its author (a member of the tenant) and its date; the `external_id` (at most 128 characters) is kept with it, and a comment whose `external_id` is already on the resource is skipped, so the import can be run again. Answers `{ imported, skipped }`; `comment.import` in the audit log (counts only). Others get `403`.

**Data and callbacks.** Functions cannot cross the iframe boundary: the UI package sends only the data (`mode.value`, `canEdit`,
`presence`, `comments.open`, `count`, `back.label`) and keeps `onChange`, `onToggle` and `onClick`. When the person flips the switch or presses the button
the shell posts an event to the iframe (`band.mode` `{ value }`, `band.comments` `{}`, `band.back` `{}`) and the package calls the callback. The
switch does not move by itself: the plugin follows with `band.set` and the new `value` (so the plugin stays the owner of the mode;
a plugin that ignores the event leaves the switch where it was). The whole state is replaced at every `set`; what is left out
returns to the default of the shell. **Presence is just data the plugin passes**: the kernel has no real-time service and does not
know who has what open. The comments button only reports its state; the comments panel of the shell is a later part, and the
button points at it with `aria-controls` only when the element `#msk-comments-panel` is on the page.

**Who owns it, and when it ends.** The state belongs to the frame that set it (`PluginFrame`): another frame cannot reset it. The
shell resets it by itself when that frame goes away (the page closes, another plugin or route opens: `Shell` also resets it at every
change of route), and at the `hello` of every new document of the plugin in the frame (a page that replaces the previous one
starts clean). Only one plugin page is open at a time, so there is one state. Frames that draw a tab of an extension
(`ExtensionTab`) do not have the operation. A declarative layout (`layout.toml`, `frames.tsx`) may ignore the state: the built-in
rail draws it, the other patterns keep their band.

**Security.** Everything that comes from the iframe is untrusted and is checked in `sanitizeBand` (`ui/host/src/app/contextband.ts`)
before it is drawn, after the usual origin and window check of the bridge. A wrong type refuses the call (`invalid band ...`).
Names are at most 80 characters, initials at most 3 (derived from the name when missing), the list at most 50 people (the rest is
dropped), ids at most 64 characters and unique, the count an integer from 0 to 9999 (more is shown as 9999). Control and
bidirectional-override characters are removed and spaces collapsed; the text is drawn only as React text, never as HTML, and the
plugin passes no class, style, URL or icon. `search` can only turn the search off (`true` adds nothing), and the controls of the
shell that a plugin must not hide (tenant, notifications, help, language, mode, the person menu) are not part of the state at all.
A person who cannot edit is shown in view mode whatever `value` says. **No manifest permission is needed**: the state cannot read or
write data, cannot reach the network and cannot change what the person is allowed to do (the real checks stay on the server, in the
calls the plugin makes); the worst a hostile page can do is show a wrong name or hide the search of its own page, which it can do
anyway inside its iframe. A plugin should set the band when its state changes, not on a timer.

**Colours and accessibility.** The switch, avatars and badge use only the pair `band-foreground` on `band` (and the reverse), so
the contrast is the one of the band in every theme and in dark mode (`contextband.test.ts` computes it for every band colour:
at least 4.5:1). The switch is one `role="switch"` button (`aria-checked` = edit mode) with the label «Edit mode»; avatars are
`role="img"` with the name as label, «+N» is announced with the names it stands for; the comments button has `aria-expanded` and the
number of comments in its name. Everything is reachable and operable with the keyboard. Below 640 px the avatars are hidden (switch
and button stay), and below 900 px the bar is the flexible one of the phone.

### 8.17 Schedules: recurring jobs run on behalf of their author

A person can put a job of a plugin on a timetable ("every night at 03:00") and have it run later, as that person, by an outside service
of a distribution. A schedule is the recurring cousin of a run ticket (§8.14): the same idea (the rights are the person's, recomputed
when the job runs, never stored) with the timetable kept by the kernel. It is an additive key of API 1 (§8.11): a plugin that uses
`[[schedules]]` declares `[requires] mosaikit = ">=1.0"`; `mosaikit-plugin validate` warns, an error with `--strict`, when the range is
missing, and lists `schedules` among the permissions the Administrator reviews (the install screen of the shell shows it in the step that adds the UI).

**What this version contains.** The registry (manifest, table, REST routes with their rules and limits, audit, the hooks that pause the
schedules of a person who leaves) and the **worker** that runs the jobs: it claims what is due, checks the rights of the author again,
mints a run ticket, pushes the run to the service of the plugin, follows it to its end, and stops a schedule that keeps failing. Both
backends use the same code. The screen of the shell (Tenant management › Schedules, for Tenant Managers: the schedules of the tenant with the author, timetable and zone, next and last run, state; pause, resume, run now, delete) draws on the REST routes below.

**Manifest.** `[[schedules]]`, at most 8 per plugin, each one: `name` (identifier, unique), `command` (must be in
`permissions.run_commands`), `target` (the endpoint of the service; its origin must be in `permissions.network`, no credentials in the
address), optional `service_key` (an `id` of `[[service_keys]]`), `min_interval_minutes` (default 15; the floor of the kernel is 5 and
wins), `max_runtime_minutes` (default 15, at most 60), `max_per_tenant` (default 10, at most 50) and `resources_required`. All of this is
checked when the manifest is parsed, so the kernel and `validate` agree.

**Data.** `core.schedules` (migrations `0022` and `0023`, SQLite `0020` and `0021`): tenant, author, plugin, name, label, cron, `time_zone`, `catch_up_once`, `args`, optional `resources`,
`status` (`active` or `paused`) with a `paused_reason` (`author`, `manager`, `author_inactive`, `failures`, `plugin_off`,
`command_removed`) and the columns of the worker. A core table with no RLS, like `run_tickets`: every query filters by `tenant_id`, and a
test proves that a schedule of one tenant does not exist for another. Rows go with the person, the tenant or the plugin (`on delete
cascade`). `core.schedule_runs` keeps one row per run (status `running`, `succeeded`, `failed`, `timed_out`; the id the service gave it; the deadline; `started_by` `timetable` or `manual`), and `core.run_tickets` has a nullable `schedule_id` (set null when the schedule goes) so a ticket is tied to the schedule that minted it.

**Cron.** Five fields (`minute hour day-of-month month day-of-week`), parsed in `crates/kernel/src/cron.rs` with no
dependency for the grammar: `*`, numbers, ranges, lists and steps; no names, no `L`/`W`/`#`, no seconds. When both day fields are restricted a day
matches if either does (as classic cron). A registration is refused when the expression never fires or when any of the gaps between the
next ten fire times is shorter than the interval floor of the entry.

**From a plugin page.** The UI package has `msk.schedules` (`list({resource?})`, `create`, `update(id, patch)`, `pause`, `resume`, `remove`, `run`, `runs`, `timezone()`): the shell runs each call with the session of the person against the routes above and **forces** `plugin` to the one of the page (`?plugin=` on the routes of one schedule, in the body of the creation), so a page reaches the schedules of its own plugin only. No permission beyond the `[[schedules]]` of the manifest; the rules, limits and error codes are the ones of the REST API.

**Time zone.** One IANA name per schedule (`time_zone` of the registration, checked with `chrono-tz`: `bad_time_zone`), read as the wall clock of that
zone. The default is the zone of the tenant; tenants have none yet, so it is UTC. Daylight saving time is resolved the same way every time: a wall time
that does not exist (clocks forward) fires once, at the first instant after the gap; a wall time that happens twice (clocks back) fires once, at its
first occurrence; a fire time is never at or before the previous one. The floor between runs is measured in the zone too.

**REST** (`crates/server/src/schedule_api.rs`, session and CSRF as any `/api/t/{t}` route):

- `POST /api/t/{t}/schedules` with `{ plugin, name, cron, time_zone?, catch_up_once?, args?, resources?, label? }` gives `{ id, next_run_at }`;
- `GET /api/t/{t}/schedules?plugin=` lists: the author's own, or all of the tenant for a Tenant Manager (who does not receive `args` or
  `resources`);
- `PATCH .../{id}` with any of `{ label, cron, time_zone, catch_up_once, args, resources, enabled }` edits the schedule in place (the id and the history of its runs stay) and answers with the schedule; the checks of the creation apply, `next_run_at` is computed again when `cron` or `time_zone` change, `enabled: false|true` pauses or resumes under the rules below. The author may change everything; a Tenant Manager only `label`, `cron`, `time_zone`, `catch_up_once` and `enabled`, never `args` or `resources` (`403 author_only`): the job runs as the author, so what it does is the author's to change. Event `schedule.update` (no arguments in it);
- `GET /api/t/{t}/schedules/timezone` gives `{ time_zone }`, the zone of the tenant (below); every route of one schedule (`PATCH`, `pause`, `resume`, `DELETE`, `run`, `runs`) takes an optional `?plugin=<id>`: the schedule must belong to that plugin, else `404`. The shell adds it for a page of a plugin (`msk.schedules`, below);
- `POST .../{id}/pause`, `POST .../{id}/resume`, `DELETE .../{id}`;
- `POST .../{id}/run`: run now (below); `POST .../{id}/take-over`: a Tenant Manager takes the schedule over (below);
- `GET .../{id}/runs`: the last 50 runs (status, id at the service, error, deadline), for the author or a Tenant Manager.

**Who may do what.** The author creates, lists, pauses, resumes and deletes their own. A Tenant Manager lists, pauses and deletes any in
the tenant and resumes what a manager or the system paused; a manager never creates a schedule for someone else (the author is always
the caller) and edits only the timetable and the label of one (`PATCH`); taking a schedule over (below) makes it theirs, as a new registration would, and run-now is open to the author and to a Tenant Manager. Anybody else, and any id of another tenant, gets 404. A run ticket cannot register or manage schedules.
Resuming by the author checks again that the plugin is on, that they may use it and that the plugin still declares the schedule; a
manager cannot resume what the author paused or what was paused because the author was removed or suspended: the rights of the author
must exist again and the author says so.

**Limits.** An entry's `max_per_tenant` per tenant and name; 50 schedules per person per tenant (the check is part of the insert); a
floor of 5 minutes between runs; `args` at most 64 KiB and a JSON object; at most 64 resources, each one visible to the author now and
belonging to the plugin; 10 registrations per person per minute; the plugin must be on for the tenant. Refusals carry a `code`
(`schedule_not_declared`, `bad_cron`, `interval_too_short`, `bad_args`, `args_too_large`, `bad_resources`, `resources_required`,
`too_many_schedules`, `too_many_schedules_of_kind`, `schedule_rate_limited`, `author_must_resume`).

**Leaving people.** `remove_member` and `set_member_suspended` pause the active schedules of the person in the tenant (all of them when
removing disables the account) in the same transaction, with `paused_reason = author_inactive`. Reactivating the person resumes nothing. The Tenant Managers get a notification (kind `system`, `data.code = schedules_paused`) once the transaction has committed, and the same when the worker pauses the schedules of a person who lost their rights (below). A schedule paused this way is not lost: a Tenant Manager can take it over.

**The worker** (`crates/kernel/src/schedule_worker.rs`, started with the kernel, every 30 seconds, `ops` job `schedules`; `tick` is public for tests).

1. *Claim.* One statement takes the schedules that are active, due and not leased (`next_run_at <= now()`, `claimed_until` empty or past), at most 20, with
   `for update skip locked`, and puts a lease on them (`claimed_until`). With several kernels on one PostgreSQL a schedule goes to one of them only; SQLite
   has one process and runs the same statement (the lock clause is dropped, its writes are serialized). While a run is in flight the lease lasts as long as
   the run, so a schedule never overlaps itself; a worker that dies leaves nothing stuck for more than five minutes.
2. *Next fire time first.* `next_run_at` moves to the next fire time before anything else. A run more than 3 minutes late (the kernel was down) is
   **skipped** (`last_status = missed`, audit `schedule.missed`), unless the schedule has `catch_up_once`: then it runs once, however many fire times were missed.
3. *Gate.* The rights of the author are recomputed now: the account and the tenant active, the membership active, the plugin on for the tenant, the use
   permission, the schedule and its command still declared, every stored resource still visible to the author and of the plugin. If not, nothing is minted
   or sent; the schedule is paused with `author_inactive` (all of the author's schedules of the tenant, and the Tenant Managers are notified), `plugin_off` or
   `command_removed`, and the audit has `schedule.skipped` and `schedule.paused`. Reactivating the person resumes nothing.
4. *Ticket.* `run_tickets::mint` as the author with the one command of the declaration, the stored resources, a life of `max_runtime_minutes` (default 15,
   never more than 60) and `schedule_id` set; `run_ref = schedule:<name>:<run id>`. A schedule grants nothing else: the capability is only the run of that
   command of that plugin, and `run_tickets::call` rechecks everything at every call. In the logic `ctx.on_behalf` carries `schedule` (the name) and
   `schedule_id` besides `run_ref`; `RunCall` has `scheduled_by` and `schedule_name`.
5. *Push.* `POST <target>` through `webfetch::request` (the origin must be in `permissions.network`; the SSRF guard and the deployer's private hosts apply as for
   a plugin) with the shared key of the declared service (the tenant's if shared, else the platform's) as `Authorization: Bearer`. The JSON body has the tenant, the
   author, the schedule, the run, the ticket (`ticket`, `ticket_path`), the command and the arguments. The service answers `2xx` (202) with `{ "run_id" }` at once; the
   kernel stores that id on the run record. A refusal or an unreachable service fails the run (only the status code is kept).
6. *Follow.* Every tick the runs in flight are looked at: past the deadline they are `timed_out` and the ticket is revoked; otherwise `GET` the status
   (`<target without a final /run>/runs/{id}`, so `/schedules/run` gives `/schedules/runs/{id}`) answers `running`, `succeeded` or `failed` (`404` is a failure; an
   answer that cannot be read is asked again). A service that gave no `run_id` ends the run by ending the ticket (`DELETE /api/run/<ticket>`).
7. *Failures.* A failed push, run or timeout counts. The next run is brought forward to a retry after 5 minutes (doubling: 5, 10, 20, 40, 60) when that is sooner than the
   timetable; five in a row pause the schedule (`failures`, audit `schedule.paused`, notification to the author); a success resets the count. Runs that fell due while one
   was in flight are skipped.

Limits: 30 runs per tenant per minute (timetable and run-now together, `run_rate_limited`); 8 pushes or polls at once; the reply of a service is read up to 64 KiB.

**Run now** (`POST .../{id}/run`): the author or a Tenant Manager. The job still runs as the **author** and goes through the same gate and rate limit; the timetable is
not touched. Refused while a run is in flight (`already_running`) or the schedule is paused (`schedule_paused`). It answers with the run record.

**Takeover** (`POST .../{id}/take-over`): a Tenant Manager takes a schedule of another person over; from then on it runs as that manager. Their rights are checked
as for a registration (they may use the plugin, the plugin still declares the schedule and the command, each stored resource is visible to them), the schedule
becomes active again whatever its pause, the failure count restarts and the next run is computed again. The previous author loses it, the manager now sees its
`args` and `resources`; at most 50 schedules per person still holds. Audit `schedule.takeover` with `from` and `to`. Errors: `manager_only`, `already_yours`,
`takeover_resources`, `schedule_not_declared`, `command_removed`.

**Audit** (`events::record`, never the arguments, the ticket or the key): `schedule.create`, `schedule.pause`, `schedule.resume`, `schedule.delete`, each with the
schedule, its name and the actor; by the worker (no actor unless said, `by` is `scheduler` or `manual`): `schedule.run` (the author as user, the run, the run reference
and the ticket), `schedule.skipped` (the reason), `schedule.missed`, `schedule.failed` (the status only), `schedule.paused` (the reason); and `schedule.takeover`.

**Time zone.** The tenant setting `timezone` (an IANA name, default `UTC`, set by the Tenant Manager in Manage › Settings, or by a product in `[defaults]`) is the zone of a new schedule that does not ask for one; the zone is stored with the schedule, so a later change of the setting moves none. `next_run_at` and `last_run_at` stay UTC in the API; every schedule carries its `time_zone`.

**Not in this version.** A pull model for a service that cannot listen.

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
  origin), `nosniff`, `Referrer-Policy: no-referrer`. The files of a static site also carry
  `Cross-Origin-Resource-Policy: cross-origin` (the others keep `same-site`): the sandboxed frame
  has an opaque origin, so its own css, scripts and images are cross-site requests. Access is by the
  token in the URL (ticket or public link); the unlock cookie of a protected link is `SameSite=Lax`
  and never goes with such requests. They also carry `Access-Control-Allow-Origin: *` (never
  `Allow-Credentials`), and the site routes (`/c/{ticket}/...`, `/p/{token}/...`) answer the CORS
  preflight (`OPTIONS`, 204, methods `GET, HEAD, OPTIONS`, requested headers echoed, `Max-Age`,
  `Access-Control-Allow-Private-Network` when asked), so the scripts of a site can read its own
  files with XHR/fetch from the `Origin: null` frame. Only GET/HEAD are served.
- **Passwords**: argon2id, at least 10 characters (the platform and the tenants may ask for more,
  §3.1). Sign-in with a limit of failed attempts per account and per address (default 8 in 15
  minutes, settings of the platform and of the tenant).
- **`script_eval` (opt-in, sensitive)**: the CSP of a plugin UI never allows run-time code
  compilation, unless the manifest declares `[permissions] script_eval = true`: then `'unsafe-eval'`
  and `'wasm-unsafe-eval'` are appended to `script-src` and `worker-src` of THAT plugin's UI only
  (`csp_for` in `crates/server/src/untrusted.rs`). The host UI, user contents, public links and the other
  plugins keep the strict policy. The Administrator sees the permission in the plugin's «What it asks».
  A plugin that declares it can run injected strings as code: grant it only to code you trust.
- **Embedding**: the host UI is never embedded (`frame-ancestors 'none'`); the public pages of a
  tenant (public links) may be embedded by the static sites of the same installation (`frame-ancestors
  'self'`, the app origins and the plugin origin, as for those sites) and by the sites in `embed.sites`
  of the tenant, a subset of the platform's, added on top; nobody else.
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
  `MOSAIKIT_E2E_WILDCARD=1 cargo xtask e2e` runs `tests/e2e/specs/wildcard.spec.ts` that way.
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
work tenant, with the name of the product, and its Tenant Manager `user`
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
├── tests/                   every test suite beyond the unit tests: e2e/, perf/, manual/, fixtures/, results/ (README.md)
├── deploy/                  Dockerfile, compose.yml, compose.dev.yml, k8s/
├── crates/plugin-cli/       `mosaikit-plugin`: the tool of plugin developers (templates/plugin: skeleton of `new`)
├── xtask/                   dev, db, plugin (calls plugin-cli), test, e2e, ci, release
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
| `cargo xtask plugin new <name>` | creates a plugin from the template (in the plugin folder of the distribution) |
| `cargo xtask plugin pack` | builds and packs the plugins of the distribution (signs with the development key) |
| `mosaikit-plugin new / build / pack / test / sign / keygen / validate / install / doctor` | the same loop for any plugin folder, without `xtask` nor this repository (crate `crates/plugin-cli`, [its README](../crates/plugin-cli/README.md)); `cargo xtask plugin` calls its library |
| `mosaikit-plugin validate --strict` | the conformance suite of a plugin (permissions against the calls of the logic, migrations for both databases, UI, i18n, `mountCrud` layout) |
| `mosaikit-plugin dev` | the development server of the kit (developer profile, SQLite) for a plugin folder: banner, test users, hot reload, developer tools (§8.12) |
| `cargo xtask release devkit-docker` | the Docker development kit: image `mosaikit-dev:<version>` and `dist/mosaikit-dev-<version>-docker` (compose, PostgreSQL, plugin folder as a volume); `--no-build` writes the folder only |
| `cargo xtask test` | Rust tests on PostgreSQL and on SQLite, tests of the plugins and of the distribution, UI tests |
| `cargo xtask manual-tests` | the checks of `docs/manual-tests.md`, automated (`tests/manual`), on a new seeded installation; `--check` only compares ids |
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

**Manual checks, automated.** Every check of `docs/manual-tests.md` has an automated twin in
`tests/manual` (Playwright, one test per id). `cargo xtask manual-tests` starts a new installation like
the e2e one (database `mosaikit_manual` plus the folder of the checkout, free ports, the test identity
provider), the suite seeds it like the development environment (accounts of the document, two tenants,
a guest, a few notes) and runs the checks in the order of the document; arguments after `--` go to
Playwright (`-- --grep P3-12`). `--check`, also run by `cargo xtask ci`, verifies that the document and
the suite have the same ids. Raw outputs are git-ignored under `tests/results/raw` (`manual/results.json`,
`manual-screens/<id>.png`); known defects are expected failures with their finding, so a fix shows up as
"expected to fail" until the mark is removed. Definition of done: [ui-plan.md](ui-plan.md).

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
- `[tests] cargo`: integration tests of its own;
- `[[sidecars]]`: extra processes or services shipped next to the kernel (see 14.0 below).

- `[[plugin_settings]]` and `[[service_key_values]]`: values to seed (14.2).
- `[[nav_groups]]`: groups of the sidebar navigation (14.3).

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

### 14.0 Sidecars

A sidecar is a process or service a distribution ships next to the kernel (for example a native service
the plugins call over HTTP). Keys of `[[sidecars]]`: `name` (unique, lower case, `-`), `command`
(executable relative to the distribution; desktop), `args`, `env` (a value `env:NAME` is read from the
variable NAME: environment of the launcher, `.env` of Compose, secret of Kubernetes), `health` (`"tcp"` or
an HTTP path, needs `port`), `port` (1024-65535, not the ports of the app), `image`, `volumes`
(`name:/path[:ro]`), `depends_on` (other sidecars, no cycles), `restart` (`never`, `on-failure` default,
`always`) and `start_timeout_secs` (default 30). Every entry needs `command` and/or `image`; the release
of a target checks the one it needs. The section is validated whenever the distribution is loaded
(so `cargo xtask ci` and every command check it); `cargo xtask sidecars` prints what each target gets.

- **Desktop**: `release desktop` copies the executables (the first folder of `command`, or the file) into
  `sidecars/<name>/` and writes `sidecars.toml` next to the executable. The launcher
  (`crates/desktop/src/sidecar.rs`) starts the sidecars in dependency order BEFORE the kernel, waits for
  each health check (progress in the splash window; clear errors for a missing executable, an unset
  `env:` variable, an exit before ready and a timeout), supervises them with the restart policy (pause
  that grows, gives up after 5 restarts in a minute), writes their output to
  `<data_dir>/logs/sidecar-<name>.log` and stops them AFTER the kernel, in reverse order (a hard kill: a
  sidecar must tolerate it). They also receive `MOSAIKIT_SIDECAR_NAME` and `MOSAIKIT_SIDECAR_PORT`.
- **Docker**: `release docker` writes `compose.sidecars.yml` (a service per sidecar with image, env,
  volumes, healthcheck; the `app` service depends on them) and sets `COMPOSE_FILE` in `.env` to merge it
  with `compose.yml`. Healthchecks use `wget`, `curl` or `nc` of the image.
- **Kubernetes**: `release k8s` adds `sidecars.yaml` (a Deployment and a Service per sidecar, a PVC per
  named volume, probes from `health`) to the kustomization; `env:NAME` becomes a key of the secret.
- **Addresses for the plugins**: a sidecar with a `port` is added to
  `MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS` (the exact `host:port` list of private hosts the plugins may
  fetch, comma separated): `127.0.0.1:<port>` set by the launcher before the configuration is read,
  `<name>:<port>` in `compose.sidecars.yml` (overridable from `.env`) and in `config.env` of Kubernetes.

**Kind `oneshot`.** `kind = "service"` (default) or `"oneshot"`: a oneshot runs to completion (exit code 0
= success) and the sidecars that `depends_on` it start only after it succeeded. It never restarts, is not
health-checked (`port` and `health` are refused), is not added to `MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS`
and runs once per start of the app (every start of the launcher, every `compose up`, every new Job), so it
must be idempotent (for example a database initialisation that checks what is already there). Any other
exit code, or running longer than `start_timeout_secs`, fails the start with an error that names the
sidecar and shows the tail of its log.

- Desktop: the launcher runs it in dependency order (splash «Running <name> (n/m)»), output in
  `logs/sidecar-<name>.log`; a failure stops the start and what was already started.
- Docker: a Compose service with `restart: "no"`; the dependants (and `app`) use
  `depends_on: condition: service_completed_successfully`. Compose does not enforce `start_timeout_secs`.
- Kubernetes: a Job (`backoffLimit: 0`, `activeDeadlineSeconds` = `start_timeout_secs`). A pod that depends
  on a oneshot gets an initContainer that runs `kubectl wait --for=condition=complete job/<name>` (image
  `registry.k8s.io/kubectl`, a ServiceAccount, Role and RoleBinding that may read Jobs are generated). If
  the Job failed the wait times out and the pod keeps restarting until the Job is deleted and recreated.
  A Job is immutable: delete it (`kubectl delete job <name>`) before applying a new version of the release.

**Overlay `files`.** `files = [{ source, target, mode }]` places files of the distribution where the
sidecar expects them (for example the configuration of a server). `source` is a file relative to the
distribution, inside it (no `..`), checked when the distribution is loaded; `target` must be unique per
sidecar and without `..`; `mode` is an optional octal string such as `"0644"`.

- Desktop: the release copies the sources to `sidecars/<name>/_files/`; the launcher copies them at EVERY
  start (replacing what is there) to `sidecars/<name>/<target>`. The target must be relative.
  `mode` is applied on Unix only.
- Docker: read-only bind mounts from `sidecar-files/<name>/<source>` of the bundle to the absolute
  `target`. The mode is the one of the host file.
- Kubernetes: one ConfigMap `<name>-files` mounted with `subPath` at the absolute `target`, `mode` applied.
  The files must be UTF-8 text and at most 512 KiB in total per sidecar (a clear error otherwise).

A target is relative on the desktop and absolute in containers: a sidecar with `files` is therefore for
one kind of target (the release of the other kind refuses it with a clear message).

### 14.2 Seeding settings and platform keys

A manifest default works for text and number settings only; a `secret` of `[[config]]` and the platform key of
a `[[service_keys]]` service could only be typed by the Administrator. A distribution (or any deployment) can
seed them. In `distribution.toml`:

```toml
[[plugin_settings]]                  # a [[config]] setting of a plugin (any kind, secrets too)
plugin = "com.example.translate"
key = "api_token"
value = "env:TRANSLATE_TOKEN"        # or "file:/run/secrets/token"; a literal is allowed, not advised

[[service_key_values]]               # the platform key of a [[service_keys]] service
service = "translate"
value = "file:/run/secrets/translate"
shared = true                        # optional (default false): tenants without a key may use it
```

A value is a literal, `env:NAME` (an environment variable of the server) or `file:PATH` (the content of a
file, relative to the folder of the seed file, a final line break dropped). **Secrets must be referenced, not
written**: `distribution.toml` lives in a repository. A literal secret works but the server warns at start.
Numbers and booleans may be written as TOML values.
Set `shared = true` when a plugin command that any member of a tenant can run uses the key: with the default
(`false`) a member of a tenant that has no key of its own gets «no key of the service … is set».

How the server gets them: one mechanism, the property `plugin_settings_file` of `mosaikit.toml` (env
`MOSAIKIT_PLUGIN_SETTINGS_FILE`), a TOML file with these two tables (other tables are ignored, so it may be the
`distribution.toml` itself). `cargo xtask dev` sets it from the distribution; `release` copies
`distribution.toml` into the bundle and sets the property. A deployment without a distribution writes a small
file of its own with the same two tables. Code: `crates/kernel/src/seed.rs`, applied at every start after the
plugins are loaded.

Rules. An entry is applied **once**, only while the setting or key is unset, and never overwrites an
Administrator choice: a setting or key that already has a value is left alone, and a marker (an empty row
`plugin:<id>:seeded:<key>` or `seed:service:<id>` in `core.secrets`, with no value in it) keeps a later removal
by the Administrator from being undone at the next start. Uninstalling a plugin drops its markers. Secrets are
stored as the Administrator path stores them (encrypted with the secret key, `core.secrets` /
`core.service_keys`); values never go to the log or to the events. A plugin or key that does not exist (yet), a
value of the wrong kind or a reference that cannot be resolved gives a warning at start and is retried at the
next one; a file that is not valid TOML or an entry without plugin, key or service stops the start. `cargo xtask`
validates the two tables whenever it loads the distribution (unknown fields refused, empty names, a key with
`:`, an entry listed twice, `env:` and `file:` without a name), so `ci` fails on a bad section. Tests:
`a_deployment_seeds_settings_and_keys_without_overwriting_the_administrator` and
`a_seed_never_overwrites_a_value_set_before_it` (`crates/kernel/tests/plugin_lifecycle.rs`), `dist::tests`.

### 14.3 Navigation groups

The sidebar lists the apps flat. A distribution can arrange them in a two-level tree, because the grouping is a
product choice, not the plugin's (a manifest only has its own `[[nav]]`, the pages inside the plugin). In
`distribution.toml`:

```toml
[[nav_groups]]
id = "data"                          # unique; the key of the collapsed state kept in the browser
label = "Data"                       # English; other languages in [nav_groups.i18n.<lang>]
icon = "database"                    # a Lucide name of the shell (the list of ui/host AppIcon.tsx)
plugins = ["com.example.docs", "com.example.geo"]   # plugin ids, in the order shown
[nav_groups.i18n.it]
label = "Dati"
```

How it travels: the same file as the seeds (`plugin_settings_file`, 14.2). The kernel (`crates/kernel/src/navgroups.rs`)
validates it at start and the public `GET /api/brand` carries it as `nav_groups`; the shell reads it with the brand.
`cargo xtask` refuses unknown fields. The kernel knows nothing of what the groups hold. The plugin API does not
change.

Rules. A plugin not listed stays at the bottom, flat, under «Other apps». A plugin that is not installed (or that the
tenant hid) is ignored: a warning at start, nothing shown. A group id listed twice: the first one wins. A plugin
listed in two groups stays in the first. A group with no plugin is hidden. An icon the shell does not know falls back
to the folder icon. Every case is a warning in the log, never an error: a bad group never stops the start.

Shell. In the open sidebar a group is a heading (collapsible, `aria-expanded`, the state is kept in the browser in
`msk_nav_groups`) over its apps with their icon and name; the arrow keys, Home and End move among the entries. In the
closed sidebar only the group icon and a short name are drawn; a click opens a menu with the apps and, indented, the
pages of each app (its `[[nav]]`); Escape closes it and the focus goes back to the icon. On the phone the drawer shows
the groups open. Groups apply to the default sidebar only: **declarative layouts (`layout.toml`) and the other built-in
layouts ignore them for now** and keep drawing the flat list. Tests: `navgroups::tests`, `dist::tests`, `navgroups.test.ts`,
`specs/19-nav-groups.spec.ts`, checks NAV-01 to NAV-04.

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
