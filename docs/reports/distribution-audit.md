# Distribution audit (dev kit, phase 9)

What a product (a *distribution*) may change, what is fixed, and the contract between the base (the compiled
Mosaikit) and a product. Written from the code: `xtask/src/dist.rs`, `xtask/src/release.rs`, `crates/kernel/src/config.rs`,
`deploy/`. Decision D7 (what a product may change) and D8 (how a product is built from a compiled base) are
in `docs/plugin-devkit-plan.md`.

## 1. What a product may change

| Area | How | Where |
|---|---|---|
| Identity | name, id, version, executable name | `[product]` of `distribution.toml` |
| Brand | name, phrase and message of the sign-in page, footer, support address, logo, favicon, `.ico`, theme colours (`#rrggbb`) | `brand.toml`, `[brand] dir` |
| Plugins | folders of its own plugins, the included official plugins by id | `[plugins] roots / include` |
| Desktop | database (`sqlite` or embedded `postgres`), port | `[desktop]` |
| Docker | image name, PostgreSQL image | `[docker]` |
| Extra processes | sidecars (long-running and one-shot), files placed for them | `[[sidecars]]` (architecture §14.0) |
| Seeded settings | plugin settings and platform keys, by reference to `env:` or `file:` | `[[plugin_settings]]`, `[[service_key_values]]` (§14.2) |
| Navigation | groups of the sidebar | `[[nav_groups]]` (§14.3) |
| Layouts | official `layout` plugins and the style of the shell | §14.1 |
| Own tests | cargo integration tests | `[tests] cargo` |
| From phase 11 | default and locked settings, languages, first start, required database extensions, ports and folders, About | `[defaults]`, `[locked]`, `[languages]`, `[bootstrap]`, `[database]`, `[ports]`, `[about]` |

## 2. What is fixed

A product never changes: the kernel (tenants, users, the three roles, resources, ACL, public links, KPIs), the
security rules (CSP of user contents and plugins, the sandbox of the logic, RLS, the allow-list of the SQL of
migrations, rate limits), the origins model (app origin and plugin origin), the signature model of the packages
(ed25519, trusted keys), the plugin API (`[requires] api`), the format of the data. The kernel refers to no
product; the dependency goes one way (architecture §14).

## 3. The contract of the base

A product is built on one of two **base artifacts**. Both carry the host UI inside the executable.

### Desktop archive (SQLite or embedded PostgreSQL)

```
<product>.exe          the executable (name, version and icon of the product; the base uses mosaikit.exe)
mosaikit.toml          configuration written by the builder (commented; read at start)
mosaikit.example.toml  every property, described
registry/              index.json, trusted_key.txt and the signed .mskp packages of the plugins
branding/              brand.toml, logo, favicon, icon (when the product has a brand)
distribution.toml      only when the product seeds settings or has navigation groups
sidecars/, sidecars.toml   when the product has sidecars
```

### Docker image

`/app` holds the same files (the server executable `mosaikit-server`, `mosaikit.toml`, `registry/`, `branding/`),
`/data` is the volume for the data folder, the ports are `8080` (app) and `8081` (plugins), the user is `mosaikit`
(uid 10001), the entry point is `/app/mosaikit-server serve`, `HEALTHCHECK` asks `/api/health`. The PostgreSQL client
(`pg_dump`) is inside, for the scheduled backups. Compose and Helm files come from `deploy/`.

### Extension points (the only places a product touches)

1. `mosaikit.toml` (or the environment) for configuration.
2. `registry/` for the plugins (a product adds its signed packages and keeps the official ones it includes).
3. `branding/` for the brand.
4. `distribution.toml` for seeds, navigation groups and, from phase 11, defaults and first start.
5. `sidecars/` for extra processes.

### Environment variables (they win over `mosaikit.toml`)

`MOSAIKIT_URL`, `MOSAIKIT_PLUGIN_URL`, `MOSAIKIT_LISTEN`, `MOSAIKIT_PLUGIN_LISTEN`, `MOSAIKIT_DATA_DIR`, `MOSAIKIT_DATABASE`,
`MOSAIKIT_DATABASE_URL` (also `DATABASE_URL`), `MOSAIKIT_SECRET_KEY`, `MOSAIKIT_REGISTRY`, `MOSAIKIT_TRUSTED_KEYS`,
`MOSAIKIT_PREINSTALL`, `MOSAIKIT_INITIAL_TENANT`, `MOSAIKIT_INITIAL_PASSWORD`, `MOSAIKIT_ADMIN_TOTP`, `MOSAIKIT_BRAND`,
`MOSAIKIT_PLUGIN_SETTINGS_FILE`, `MOSAIKIT_ALLOW_PRIVATE_FETCH`, `MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS`, `MOSAIKIT_TRUST_PROXY`,
`MOSAIKIT_OPEN_BROWSER`, `MOSAIKIT_LOG`. For development only: `MOSAIKIT_ALLOW_UNSIGNED`, `MOSAIKIT_DEV_PLUGINS`,
`MOSAIKIT_DEVELOPER_PROFILE` (and `_ALLOW_REMOTE`).

### Ports and data

Desktop: app `48080`, plugins the next one (`[desktop] port`). Docker: `8080` and `8081`. The data folder holds the
database (SQLite), `blobs/`, `logs/`, `exports/` and the backups; the product never writes elsewhere.

### Versioning

- The base has one version (the workspace version). The plugin API has its own integer (`[requires] api`).
- A **product release states the range of base versions it works with** (`[product] base`, phase 11). At start the
  base checks that its own version is inside the range and says why when it is not.
- A plugin states `[requires] mosaikit` (a range); the server refuses a plugin outside it (already in the kernel).
- Rules for a base upgrade: the migrations of the base and of the plugins run as today; a change of the plugin API
  comes only with a new major or in an additive way (D3).

## 4. Gaps found, and where they are closed

| Gap | Closed in |
|---|---|
| A product cannot say which base versions it works with | phase 11: `[product] base`, checked at start |
| No defaults or locked settings from a product | phase 11: `[defaults]`, `[locked]` |
| Languages enabled and default cannot be set by a product | phase 11: `[languages]` |
| First start only through `MOSAIKIT_INITIAL_TENANT/PASSWORD` and `MOSAIKIT_PREINSTALL` | phase 11: `[bootstrap]` |
| A product cannot require a database extension (a plugin can) | phase 11: `[database] extensions`, checked at start |
| The About dialog has no product licence or base version | phase 11: `[about]` |
| A product is built only from source (`cargo xtask --dist`) | phase 10: `mosaikit-product build` from the compiled base |
| No document of the rights and duties of the publisher | phase 13 (D9) |

Nothing in the kernel needs to change for the contract itself: the extension points above exist today.
