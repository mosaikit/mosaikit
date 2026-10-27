<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo/mosaikit-A-tessera-giallorossa-orizzontale-negativo.svg">
  <img src="docs/logo/mosaikit-A-tessera-giallorossa-orizzontale-positivo.svg" alt="Mosaikit" width="320">
</picture>

# Mosaikit

**Multi-tenant web platform built out of plugins.** The kernel is domain-agnostic: it knows
tenants, users and roles, resources, permissions, public links, KPIs and plugins. Every
domain lives in a plugin:
- WebAssembly logic in a sandbox;
- UI isolated in an iframe;
- data of its own, protected with the same rules on **PostgreSQL** (Row-Level
  Security) or on **SQLite** (query rewriting, triggers and authorizer).

On Mosaikit one builds **distributions**: products with a brand of their own,
their own choice of plugins and possibly plugins of their own. A distribution is a
separate project that refers to Mosaikit; Mosaikit knows none of them.

Full architecture: **[docs/architecture.md](docs/architecture.md)**. The interface follows the
mockup in [docs/mockup](docs/mockup) and the rules of [docs/refactoring-ui.md](docs/refactoring-ui.md);
the plan to complete it is in [docs/ui-plan.md](docs/ui-plan.md). The interface is in English by
default, with Italian available. Guides for the people who use it, one per role:
[docs/guide](docs/guide/README.md).

## Contents

- [What it offers](#what-it-offers)
- [Projects and layout](#projects-and-layout)
- [Prerequisites](#prerequisites)
- [Quick start in development](#quick-start-in-development)
- [Distributions and brand](#distributions-and-brand)
- [Developing a plugin](#developing-a-plugin)
- [Database: PostgreSQL or SQLite](#database-postgresql-or-sqlite)
- [Tests](#tests)
- [Desktop release](#desktop-release)
- [Server release with Docker](#server-release-with-docker)
- [Kubernetes release](#kubernetes-release)
- [Configuration](#configuration)
- [Administration](#administration)
- [xtask commands](#xtask-commands)

## What it offers

- **Three roles**:
  - **Administrator**: platform account of the `system` tenant, which is not a
    workspace; manages tenants and their Tenant Managers, plugins, global KPIs
    and the other Administrators. Signs in from a page of their own, always with a local
    username and password and the second factor (TOTP);
  - **Tenant Manager**: manages users, invitations, groups, policies and KPIs of
    their own tenant;
  - **User**: works with their own resources and the ones shared with them.

  Every user always signs in on their home tenant and can be invited into other
  tenants, with a different role in each. Whoever is both an Administrator and a user
  of a tenant has two separate accounts: the roles never overlap.
- **Sign-in**: users choose the tenant from a menu (hidden if there is only one
  tenant; `#/login/<tenant>` preselects it); Administrators enter from
  *Administrator access* (`#/admin`). At the first sign-in the Administrator
  registers an authenticator app (QR code) and receives ten recovery codes. The
  sign-in page takes the theme of the platform, and the one of the tenant as soon as it is known.
- **Overview**: the start page after sign-in, with the data of the role:
  - for everybody: their own resources, shares made and received, public
    links, recent activity;
  - for the Tenant Manager, in addition: the aggregates of the tenant;
  - for the Administrator: the aggregates of the whole system.
- **Owned resources**:
  - shared with users and groups of the tenant at three levels (read,
    write, manage), with inheritance on folders;
  - when a user leaves the tenant, the Tenant Manager reassigns their resources.
- **Public links**: read only, with expiry, optional password and a
  count of the visits.
- **KPIs**: per tenant (Tenant Manager) and over every tenant (Administrator).
  Only metadata and aggregates, never the contents.
- **Plugins**:
  - signed `.mskp` packages (ed25519), with catalog and blocklist;
  - logic in WASM (wasmi: limited fuel and memory; files, network and clock only
    through the host);
  - UI on a separate origin, which talks to the host only via `postMessage` and receives
    language, theme and mode at start and at every change;
  - SQL limited to its own tables;
  - calls to the commands of other plugins, if declared;
  - declared requirements (e.g. PostgreSQL + PostGIS).
- **Web security**: argon2id passwords, `HttpOnly` session cookie, CSRF
  token, strict CSPs. Contents uploaded by users are always served
  sandboxed.
- **Brand**: name, version, logo, favicon, colours, texts of the sign-in page
  and desktop icon, from a `brand.toml` file. The official logo of Mosaikit is in
  [docs/logo](docs/logo).

Official plugins (in `../mosaikit-plugins`): Notes, Activities, Contacts, Maps
(GeoLibre), Static sites, Files.

## Projects and layout

Projects side by side in the same folder:

```
mosaikit/            platform (this repository)
mosaikit-plugins/    official plugins: Cargo and npm workspaces of their own
<product>/           possible distributions: they refer to ../mosaikit
```

```
mosaikit/
  crates/
    mskp/        package format, manifest v3, signature
    sql-guard/   SQL whitelist of the plugins + translation PostgreSQL -> SQLite
    db/          data access: PostgreSQL (RLS, roles) and SQLite (the same rules)
    runtime/     WASM execution (wasmi)
    plugin-sdk/  Rust SDK for the logic of the plugins (+ simulated host for the tests)
    kernel/      tenants, identity, roles, permissions, links, KPIs, Overview, plugins, brand
    server/      HTTP (axum): API, embedded host UI, plugin UIs, public links
    desktop/     mosaikit.exe: desktop app without a console, icon in the notification area
  ui/
    host/        host UI, the shell (React + Vite + Tailwind + shadcn/ui, i18next)
    plugin-api/  @mosaikit/plugin-api: bridge, generic CRUD, theme and language
  branding/      brand of Mosaikit (documented brand.toml)
  e2e/           tests in the browser (Playwright)
  deploy/        Dockerfile, compose and Kubernetes templates
  xtask/         automation: cargo xtask <command>
    templates/plugin/    skeleton for `cargo xtask plugin new`
    mosaikit.dev.toml    configuration of `cargo xtask dev`
  docs/          architecture, mockup, interface rules and plan, logo
  distribution.toml        the "Mosaikit" distribution
  mosaikit.example.toml    every configuration property, described
```

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Rust | recent stable | `rustup target add wasm32-unknown-unknown` |
| Node.js | 20 or later | npm workspaces |
| PostgreSQL | 15 or later | for development and tests (local binaries or Docker); PostGIS if a distribution requires it |
| Docker | optional | for the server image, or as development PostgreSQL |

SQLite is included in the executable: there is nothing to install.

On Windows everything works from PowerShell: neither bash nor WSL is needed. PostgreSQL
is looked for in the `PATH`, in `C:\Program Files\PostgreSQL\*\bin`, or where
`MOSAIKIT_PG_BIN` says.

The `mosaikit-plugins` repository must be next to `mosaikit`.

## Quick start in development

```powershell
rustup target add wasm32-unknown-unknown
npm install
cargo xtask dev                       # Mosaikit
cargo xtask --dist ../product dev     # or a distribution (its own brand and plugins)
```

`cargo xtask dev` does four things:

1. Starts a **dedicated development PostgreSQL** in `.dev/pg`, on port 55432.
   If PostgreSQL has PostGIS, it turns it on (in the test databases too).
2. Builds logic and UI of the plugins of the distribution, taken from the folders in
   `[plugins] roots`.
3. Starts the **server** in development mode with `xtask/mosaikit.dev.toml`:
   - API on :47080;
   - plugins and contents on :47081;
   - plugins read from their folders, with `MOSAIKIT_DEV_PLUGINS`.
4. Starts **Vite** for the host UI on **http://127.0.0.1:5173**.

First sign-in: *Administrator access* (`#/admin`), user `admin`, password
`admin-sviluppo` (or the value of `MOSAIKIT_ADMIN_PASSWORD`). In development the
second factor is off (`admin_totp = false`).

| Change | Effect |
|---|---|
| `ui/host/**` | Vite HMR, without reloading the page |
| `<plugin>/ui/**` | `vite build --watch` rebuilds the UI and the host reloads the iframe of the plugin |
| `<plugin>/src/**` | rebuilds the WASM; the server reloads the module without restarting |
| `<plugin>/migrations/**`, `plugin.toml` | applies the new migrations, reloads the manifest, updates the sidebar |
| `crates/**` | rebuilds and restarts the server (on Windows it stops it first: a running executable cannot be replaced); the sessions stay valid |

If you change a migration already applied, the server says so. Then
create a new migration, or reset the data of the plugin with
`cargo xtask plugin db-reset <id>`.

```powershell
cargo xtask db up | down | reset | url      # development PostgreSQL
```

## Distributions and brand

A distribution is a product based on Mosaikit. The kernel stays the same;
name, version, brand and plugins change. It is described by `distribution.toml`:

```toml
[product]
id = "product"              # names of the release files and of the Docker image
name = "Product"
version = "0.1.0"
executable = "product"      # product.exe in the desktop version

[brand]
dir = "branding"            # brand.toml + logo, favicon, icon

[plugins]
roots = ["../mosaikit-plugins", "plugins"]   # plugin folders
include = ["com.mosaikit.notes", "com.example.registry"]   # or "*"

[desktop]
database = "sqlite"         # or "postgres" (embedded PostgreSQL, e.g. for PostGIS)
port = 48080

[docker]
image = "product"
postgres_image = "postgis/postgis:17-3.5-alpine"

[tests]
cargo = ["tests"]           # integration tests of the distribution
```

Every xtask command accepts `--dist <folder>` (or `MOSAIKIT_DIST`); without it,
it uses the distribution of Mosaikit (`distribution.toml` here).

**Brand** (`branding/brand.toml`, every property described in the file):
- name, version, phrase and message of the sign-in page, footer;
- logo, favicon and `.ico` icon;
- colours of the theme (`accent`, `bg`, `panel`, `fg`, ...).

Where they apply:
- **server**: title and colours injected into the page, social preview with absolute
  URLs; `/api/brand`; `brand/logo` and `brand/favicon`;
- **UI**: sign-in, sidebar, status bar; the plugin UIs receive
  the same theme;
- **desktop version**: name in the notification area, icon; name, description and
  icon of the executable (set by the release).

Colours accept only `#rrggbb`, so no arbitrary CSS in the page.

## Developing a plugin

```powershell
cargo xtask plugin new registry --id com.city.registry                     # in ../mosaikit-plugins
cargo xtask --dist ../product plugin new surveys --id com.example.surveys  # in the plugins of the distribution
cargo xtask dev
```

The plugin is created in the first folder of `[plugins] roots` (or where
`--into` says) and added to the Cargo and npm workspaces of that folder. With
`--no-logic` a plugin without WASM is created (manifest, migrations and UI only).

```
registry/
├── plugin.toml        manifest: CRUD resources, permissions, requirements, UI, KPIs
├── Cargo.toml         WASM logic (optional)
├── src/lib.rs         hooks and commands (mosaikit-plugin-sdk)
├── migrations/        SQL of the plugin: tables, views, kpi_* views
└── ui/                Vite + TypeScript, @mosaikit/plugin-api
```

**Manifest.** Every `[[resources]]` entry becomes a table generated
by the host. Every row is a kernel resource: it has an owner, can be shared
and can have a public link. The other sections:

- `[permissions]`:
  - `hooks`, `files`, `content`;
  - `network` and `frame_src` (origins);
  - `calls`: ids of the plugins whose commands the logic calls.
- `[requires]`:
  - `database = "postgres"`, to use PostgreSQL functions;
  - `extensions = ["postgis"]`.

  On SQLite, or without the extension, the installation stops with a clear
  message.

**Logic** (`src/lib.rs`):

```rust
use mosaikit_plugin_sdk::prelude::*;

fn before_create(ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
    let mut v = hook.values.clone();
    if v.str("status").is_empty() { v.set("status", "draft"); }
    Ok(Some(v))                       // Err(...) refuses and rolls back the transaction
}

fn summary(ctx: &Ctx, _args: Value) -> Result<Value> {
    // the user sees only the rows they can access (RLS or a filter on SQLite)
    Ok(Value::Array(ctx.db().query("select status, count(*)::int n from registry group by 1", &[])?))
}

mosaikit_plugin_sdk::plugin! {
    hooks: { "registry.before_create" => before_create },
    commands: { "registry.summary" => summary },
}
```

- `ctx.call_plugin("com.other.plugin", "command", args)` calls a plugin
  declared in `calls`, with the same user; it works only on PostgreSQL.
- The logic is tested natively, without a server, with
  `mosaikit_plugin_sdk::testing::MockHost` and `cargo test -p registry`.

**Migrations** (`migrations/NNN_name.sql`). SQL is written for PostgreSQL;
on SQLite it is translated.

- Every table must have `resource_id uuid not null` and
  `tenant_id uuid not null default core.ctx_tenant()`. The host adds the foreign
  key, the index and the access rules (RLS policies or triggers).
- The `kpi_*` views (with `tenant_id`) feed the KPIs. The other views
  respect the permissions of whoever reads them.
- Functions, policies, `GRANT`, `SET` and references to other schemas are refused.

**UI** (`ui/src/main.ts`):

```ts
import '@mosaikit/plugin-api/style.css'
import { connect, mountCrud } from '@mosaikit/plugin-api'

const msk = await connect()                       // handshake with the host: language, theme, mode
mountCrud(document.getElementById('app')!, msk, 'registry', { title: 'Registry' })
// or custom: msk.crud('registry').list(), msk.call('registry.summary'),
// msk.share(id), msk.files.*, msk.content.*, msk.onContext(...)
```

The UI does not `fetch` the app and sees neither tokens nor cookies. Every request
goes through the host, which limits it to that plugin and to the active tenant.

**Signed package** (to install on a server):

```powershell
cargo xtask plugin keygen --out publisher.key   # once: private key of the publisher
$env:MOSAIKIT_SIGNING_KEY_FILE = "publisher.key"
cargo xtask plugin pack --release               # dist/registry/plugins/*.mskp + index.json
```

The server accepts the package only if the public key of the publisher is in
`trusted_keys`. The Administrator installs it from *Plugins*, uploading the
file or from the catalog.

## Database: PostgreSQL or SQLite

| | PostgreSQL | SQLite |
|---|---|---|
| Typical use | server, Docker, distributions with PostGIS | desktop (default), small installations |
| Rows visible to the plugins | RLS + a PostgreSQL role per plugin | rewritten queries: every read of the protected tables goes through the filter on the access level |
| Writes of the plugins | `WITH CHECK` policies | triggers that refuse rows not allowed |
| SQL written by the plugin | role without privileges outside its schema | only its own tables; SQLite authorizer against secrets, PRAGMA, ATTACH, writes elsewhere |
| `plugin.call`, PostGIS | yes | no (a single write transaction at a time) |

**Choice of the backend**:
- `database.backend = "sqlite" | "postgres"`, or `MOSAIKIT_DATABASE`;
- without it `postgres` is used if there is `database.url` (or `embedded`),
  otherwise `sqlite` with the file `<data_dir>/mosaikit.db`.

The rules are checked by the same tests on both backends (see [Tests](#tests)).

## Tests

```powershell
cargo xtask test                         # Rust on PostgreSQL and on SQLite, plugins, UIs
cargo xtask --dist ../product test       # plus the plugins and the tests of the distribution
cargo xtask e2e                          # in the browser, on a full installation
cargo xtask ci                           # fmt, clippy -D warnings, cargo-deny, typecheck, lint, build, test
```

| Suite | What it checks |
|---|---|
| `crates/db/tests` | **on both backends**: filters by level, inheritance, isolation between tenants, plugin confined to its space, read-only public links, KPIs, refusal of non-conforming schemas, uninstall |
| `crates/kernel/tests` | (also with `MOSAIKIT_TEST_BACKEND=sqlite`) identity, three roles, Administrator accounts and second factor, interventions of the Administrator on the tenants, tenants and invitations, sharing, Overview by role, reassignment, WASM hooks and commands, KPIs, files, sites, package signatures, migrations, catalog and blocklist, malicious plugins, development mode, themes and top bar |
| `crates/server/tests` | (also on SQLite) cookies and CSRF, security headers, separation of the origins, sandboxed contents, public links, base path, brand, error codes, themes on the sign-in page |
| unit tests of the crates and of the plugins | configuration, manifest, packages, SQL guard and translation, runtime, SDK, logic of the plugins |
| `ui/*`, `<plugin>/ui` (vitest) | bridge, routing of the operations, generic CRUD in both languages, i18n and error mapping |
| `e2e` (Playwright) | under the base path `/mosaikit`: Administrator (with registration of the second factor), tenants, Tenant Manager, User, Overview, plugin in iframe, sharing, public link, KPIs, isolation of the iframe, language, phone, themes on the sign-in page, a server that does not answer, accessibility (axe) |

The PostgreSQL tests create throwaway databases (`msk_t_*`) on the development
cluster, or where `MOSAIKIT_TEST_DATABASE_URL` says; a role with
CREATEDB and CREATEROLE is needed. Orphan databases of interrupted tests:
`cargo xtask db clean-tests`.

For the e2e tests, on Windows Playwright uses the installed Edge; elsewhere
`npx playwright install chromium` and `E2E_CHANNEL=chromium`.

## Desktop release

```powershell
$env:MOSAIKIT_SIGNING_KEY_FILE = "publisher.key"  # without it: development key .dev/signing.key
cargo xtask release desktop                       # Mosaikit, with SQLite
cargo xtask --dist ../product release desktop     # a distribution (SQLite or embedded PostgreSQL)
cargo xtask --dist ../product release desktop --pg-dir "C:\pgsql"   # PostgreSQL from a folder
```

The releases go to the `dist/` folder **of the distribution**: the ones of
Mosaikit in `mosaikit/dist`, the ones of a distribution in `<product>/dist`.

```
mosaikit/dist/
├── mosaikit-1.0.0-desktop-windows-x86_64/
│   ├── mosaikit.exe             single executable: app with an icon in the notification area,
│   │                            from a terminal also the administration commands
│   ├── mosaikit.toml            commented configuration (SQLite, opens the browser)
│   ├── mosaikit.example.toml    every property, described
│   ├── branding/                brand
│   ├── registry/                index.json + signed plugins/*.mskp (preinstalled)
│   └── START.txt
├── mosaikit-1.0.0-desktop-windows-x86_64.zip
├── mosaikit-1.0.0-docker/       (from `release docker`, see below)
├── mosaikit-1.0.0-k8s/          (from `release docker` or `release k8s`, see below)
└── SHA256SUMS                   zips and Docker images
```

With `[desktop] database = "postgres"` the zip also contains `pgsql/`, that is
`bin/`, `lib/` and `share/` of PostgreSQL. The program creates a private cluster
in `data\pg`, with PostGIS if available.

**Use:**

1. Double click on the executable: the icon of the product appears in the notification
   area. If the start takes more than half a second (typically the first one, or with
   embedded PostgreSQL), a small window shows logo, name, **version** and current
   phase, with a spinner.
2. At the first start it creates the database (`data\mosaikit.db` or `data\pg`), then
   installs and turns on the plugins.
3. When it is ready, at the **first start** the browser opens on
   http://127.0.0.1:48080 (`url` in `mosaikit.toml`). **From then on** a Windows
   notification with the address appears, which opens with a click. With
   `open_browser = false` there is always and only the notification. To open the app again
   a click on the icon or a new double click is enough.
4. The first start also creates the work tenant (`initial_tenant = "locale"`,
   with the name of the product) and its user `utente`: one works at once.
   The Administrator `admin` enters from *Administrator access*. The initial
   password of both is `mosaikit` (`initial_password`; also in
   `data\credenziali-iniziali.txt`, icon menu → *Initial credentials*):
   change it at once from the Account page.
5. Icon menu → *Quit*: stops everything. Start errors appear in a
   message window.

The log is in `data\logs\mosaikit.log`. **Backup**: with the program stopped, copy the
`data\` folder.

## Server release with Docker

```powershell
cargo xtask release docker                        # image mosaikit:<version> + mosaikit/dist/mosaikit-<version>-docker
cargo xtask --dist ../product release docker      # image product:<version> + product/dist/product-<version>-docker
cargo xtask release all                           # desktop + Docker + Kubernetes (without Docker running: desktop + Kubernetes)
```

`release docker` also generates the Kubernetes folder (see below), with the same
image.

The Docker distribution is a folder ready to copy to the server:

```
mosaikit/dist/mosaikit-1.0.0-docker/
├── mosaikit-1.0.0-image.tar     image (docker load -i ...)
├── compose.yml                  PostgreSQL (or PostGIS) + app
├── .env                         image, passwords, addresses and ports to edit
├── initdb/                      creation of role, database and optional PostGIS
├── keycloak/, nginx/            optional profiles: identity provider, reverse proxy
└── README.md                    installation, production, backup, update
```

On the server: `docker load -i mosaikit-1.0.0-image.tar`, then edit `.env`
and run `docker compose up -d`. From the repository, without the folder,
`docker compose -f deploy/compose.yml up -d` is enough.

The `README.md` of the folder comes from `deploy/README.docker.md`: quick start, the optional
profiles (`keycloak` identity provider with a Mosaikit-like sign-in theme, `mail` test server,
`proxy` nginx with TLS, base path and wildcard plugin host), environment variables, backup and update.
The files are checked statically by `cargo test -p xtask deploy_check` (no Docker needed).

**Build.** `xtask` prepares a temporary build context with mosaikit, the
plugin folders and the folder of the distribution, read from
`distribution.toml`, without builds, dependencies and data. The multi-stage Dockerfile:
- builds UI, server and plugins of the distribution (`--build-arg DIST=...`);
- signs the plugins with the key passed as a BuildKit *secret*;
- the image runs as a non-root user, with the data in the `/data` volume.

**Main variables** (see `deploy/compose.yml`):

| Variable | Example |
|---|---|
| `MOSAIKIT_URL` | `https://gis.example.com/mosaikit` (with a base path too) |
| `MOSAIKIT_PLUGIN_URL` | `https://plugins.example.com/mosaikit` (a different origin) |
| `MOSAIKIT_DATABASE_URL` | `postgres://mosaikit_app:***@db:5432/mosaikit` |
| `MOSAIKIT_ADMIN_PASSWORD` | initial password of `admin` (only at the first start) |
| `MOSAIKIT_TRUST_PROXY` | `true` behind a reverse proxy (X-Forwarded-For) |
| `MOSAIKIT_IMAGE`, `POSTGRES_IMAGE` | `product`, `postgis/postgis:17-3.5-alpine` |

**Database.** `deploy/initdb/01-mosaikit.sh` creates the application role
`mosaikit_app` (not a superuser, with `CREATEROLE` for the roles of the plugins), the
database and, if the image includes it, the PostGIS extension.

**Production.** Put an HTTPS reverse proxy in front, with **two hostnames**: one
for the app (→ 8080) and one for plugins, contents and public links (→ 8081). With
`https://` the session cookie becomes `Secure`.

## Kubernetes release

```powershell
cargo xtask release k8s                           # manifests only: mosaikit/dist/mosaikit-<version>-k8s
cargo xtask release k8s --tag registry.example.com/mosaikit:1.0.0
```

**kustomize** manifests generated from the templates of `deploy/k8s` (placeholders
`{{id}}`, `{{image}}`, `{{version}}`... replaced with the data of the
distribution):

```
mosaikit/dist/mosaikit-1.0.0-k8s/
├── kustomization.yaml   namespace, images, generated ConfigMap and Secret
├── namespace.yaml
├── postgres.yaml        PostgreSQL (or PostGIS) StatefulSet + volume
├── app.yaml             Deployment (1 replica, Recreate) + Service + /data volume
├── ingress.yaml         two hostnames: app and plugins (separate origins)
├── config.env           MOSAIKIT_URL, MOSAIKIT_PLUGIN_URL... (ConfigMap)
├── secret.env           passwords (Secret)
├── initdb/
└── README.md            requirements, installation, managed database, backup
```

Installation: image in the registry of the cluster, hostnames and passwords to
edit, then `kubectl apply -k .`. If `kubectl` is installed, the release
checks the manifests with `kubectl kustomize` (no cluster is needed).

## Configuration

The file is `mosaikit.toml`: next to the executable, in the current folder,
or given with `--config` or `MOSAIKIT_CONFIG`. The `MOSAIKIT_*` variables
take precedence over the file. Every property, with its variable,
is described in **[mosaikit.example.toml](mosaikit.example.toml)**.

One address is enough:

```toml
url = "http://127.0.0.1:8080/mosaikit"   # with an optional base path
```

From `url` are derived:
- `plugin_url`: the same base on the next port, so a different origin
  for the plugin UIs;
- the listening ports (`listen`, `plugin_listen`): local only if the host is
  local.

Behind a reverse proxy set `plugin_url` (a second hostname) and the
internal ports. To check the resolved configuration: `mosaikit-server config`
(server) or `mosaikit.exe config` (desktop).

## Administration

```powershell
mosaikit-server migrate                                  # applies the migrations and exits
$env:MOSAIKIT_NEW_PASSWORD = "..."; mosaikit-server reset-password --user admin   # an Administrator
mosaikit-server reset-password --tenant alfa --user anna                   # a user of a tenant
mosaikit-server reset-totp --user admin    # lost phone and no recovery code
```

They are the **emergency access**: they require access to the machine, not to the web.
`reset-totp` removes the second factor; at the next sign-in the Administrator
registers the app again.

In the desktop version there is a single executable: the same commands are given to
`mosaikit.exe` (or `<product>.exe`) from a terminal, with the application closed,
for example `.\mosaikit.exe reset-password --user admin`.
The output appears in the terminal.

- **Administrator**:
  - **Tenants**: creates the tenants, each with its Tenant Manager. From *Users and
    managers* appoints or replaces a Tenant Manager (change of role or new
    account) and resets the password of a user of the tenant: users and roles,
    never the contents;
  - **System**: Administrators (creates the accounts, disables or
    reactivates them, at least one always stays active, resets password and second
    factor), theme of the platform, top bar;
  - **Plugins** and **global KPIs**.
- **Tenant Manager**: from *Manage*: users, invitations, groups; from *Tenant
  settings*: policies and theme; resources (reassignment) and KPIs of the tenant. They
  neither see nor touch the Administrator accounts; they cannot disable a user who is the only
  Tenant Manager of another tenant.
- **BI access to the KPIs** (PostgreSQL): the role `<prefix>_reporting` reads
  only the `kpi_*` views. It is created `NOLOGIN`; to enable it:
  `ALTER ROLE msk_mosaikit_reporting LOGIN PASSWORD '...'`.

## xtask commands

All of them accept `--dist <folder of the distribution>`.

| Command | Description |
|---|---|
| `cargo xtask dev [--no-ui]` | development environment with hot reload |
| `cargo xtask db up\|down\|reset\|url\|clean-tests` | development PostgreSQL |
| `cargo xtask plugin new <name> [--id] [--no-logic] [--into]` | new plugin from the template |
| `cargo xtask plugin build [--release]` | builds WASM and UI of the plugins of the distribution |
| `cargo xtask plugin pack [--release] [--out]` | signed packages + registry |
| `cargo xtask plugin keygen [--out]` | signing keys of the publisher |
| `cargo xtask plugin db-reset <id>` | resets the data of a plugin (development) |
| `cargo xtask test` / `e2e` / `ci` | tests and checks |
| `cargo xtask release bundle\|desktop\|docker\|k8s\|all` | releases of the distribution |
