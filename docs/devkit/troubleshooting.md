# Troubleshooting

The errors the kernel and the tools return, with cause and fix. The texts are quoted as the code produces them
(`crates/kernel`, `crates/mskp`, `crates/plugin-cli`). In the UI of a plugin always switch on the **code**, never on the
text ([UI reference](ui.md)).

## Installing a plugin

| You see | Cause | Fix |
|---|---|---|
| `invalid manifest: …` (often `unknown field …`) | `plugin.toml` has a key the kernel does not know, or a rule is broken | the message names the key or the rule; check the key in [Manifest reference](manifest.md). Unknown keys are refused on purpose; a kernel older than the key rejects it too |
| `invalid package: …` (`unsafe path`, `too many files`, `package over 64 MB`, `duplicate file`, `invalid migration name … (expected NNN_name.sql)`, `screenshot media/x is not in the package`) | the zip breaks a limit or a rule | see Limits in [Packaging and signing](packaging.md); rebuild with `mosaikit-plugin pack` |
| `unsigned package` | no `SIGNATURE` | `mosaikit-plugin pack` or `sign`; a development server can allow unsigned packages |
| `publisher key not trusted: <key>` | the signature is valid but the key is not in `trusted_keys` | the Administrator adds the public key (`keygen` prints it) to `trusted_keys` / `MOSAIKIT_TRUSTED_KEYS` |
| `invalid signature: the signature does not match the content` | a file changed after signing | pack again; do not edit the `.mskp` |
| `<id> <version> is in the blocklist of the registry` | the version was revoked | publish a new version |
| `downgrade not allowed (<old> -> <new>)` | an older version over a newer one | raise `version` |
| `<id> is loaded in development mode` | the plugin runs from a folder in a developer server | stop `dev` for it, or use another server |
| code `plugin_incompatible`: `the plugin works with Mosaikit <range> (this is <version>)` or `the plugin uses plugin API <n> (this Mosaikit supports <m>)` | `[requires]` excludes this platform | widen `mosaikit`, build for the API the platform speaks, or update the platform |
| `<name> requires PostgreSQL: this installation uses SQLite (database.backend)` | `[requires] database = "postgres"` on the desktop | use PostgreSQL, or remove the dependency |
| `<name> requires the PostgreSQL extension <ext>: install it in the database with CREATE EXTENSION <ext>; (a superuser is required)` | `[requires] extensions` | install the extension in the database |

## Migrations

| You see | Cause | Fix |
|---|---|---|
| `migration <name> differs from the one already applied` | an applied migration was edited | revert it and add a new `NNN` file. In development: reset the plugin data in Developer tools |
| `migration <name> was already applied and then changed: create a new migration or reset the data…` | same, on a development server | same |
| `migration <name>: statement not allowed in plugins: …` / `object not accessible to plugins: …` / `function not allowed in plugins: …` | the SQL guard | see [Data](data.md); use only the allowed statements and your own schema |
| `the KPI view <v> declared in the manifest does not exist` | `[[kpi]] view` has no matching `create view` | create `kpi_*` in a migration |
| `field <resource>.<field> is already of type <t>: it cannot change to …` | a field changed kind | keep the kind; add a new field and migrate the data |
| a table without `resource_id` or `tenant_id` | every plugin table needs both | add `resource_id uuid not null`, `tenant_id uuid not null` ([Data](data.md)) |
| `validate --strict`: `migrations are numbered 003 where 002 is expected`, `irreversible` | gap or `drop table`/`column`/`truncate` | number with no gap; migrations only add |
| `not accepted on SQLite: …` | a construct with no SQLite translation (`DISTINCT ON`, regular expressions, `json_agg` of rows…) | write it another way, or require PostgreSQL |

## Calls from the UI and the logic

| Code (HTTP) | Cause | Fix |
|---|---|---|
| `missing_permission` (403) | the permission profile does not allow it (`use`, `create`, `delete`, `share` or yours) | the Tenant Manager changes the profile or the plugin permissions |
| `plugin_off` (404) | the plugin is not available or not turned on in the tenant | Administrator: available; Tenant Manager: turn on |
| `base_off` | an extension's base plugin is off | turn the base on first |
| `sort_unknown` (400) | `sort` names a field that is not declared, is `hidden`, or not `created_at`, `updated_at`, `owner_name` | sort by a declared visible field |
| `quota_exceeded` | the tenant is at a quota | the Tenant Manager asks for a larger quota |
| `content_too_large` | an upload over the limit | send less |
| `incompatible_api` | the UI package asks for a newer plugin API than the shell speaks, or the shell is older than the package | update the platform or build against the API it speaks; `isIncompatible(e)` lets the page show a message |
| `plugin_error` | the logic returned an error without a code | read the message; give errors codes (`Error::coded`) |
| a code of your own | the logic returned `Error::coded("…", …)` | handle it in the UI |
| `maintenance`, `server_unavailable` | the platform is under maintenance or does not answer | retry |
| `the host did not answer <op>` | no answer in 120 s | the page is closed or the server is overloaded |
| `this page must be opened inside Mosaikit (the host is missing)` | the page was opened outside the shell | open it from the shell |

## Errors of the logic

| You see | Cause | Fix |
|---|---|---|
| `unknown command: <name>` | the name is not registered in `plugin!` | check the string in `commands:` and in `msk.call` |
| `instruction limit exceeded` | more than 2,000,000,000 (commands) or 500,000,000 (hooks) instructions | do less per call; do the work in SQL; split it |
| `the plugin ended with an error: …` | a panic or trap in the WASM | no `unwrap` on input; read the trap text; test with `MockHost` |
| `invalid message from the plugin: answer too large` | a message over 16 MiB | return less; page it |
| `db.query requires SELECT or RETURNING: use db.exec` | a statement with no rows sent to `query` | use `exec` |
| `invalid SQL`, `statement not allowed in plugins`, `object not accessible to plugins`, `function not allowed in plugins`, `one statement per call only` | the SQL guard | see [Data](data.md) |
| `the plugin does not declare notify in [permissions]` | `notify` without `notify = true` | add it; `validate --strict` finds it |
| `invalid notification: …`, `too many notifications` | wrong shape, or over 30 a minute per person and plugin | check title (160) and body (600); throttle |
| `origin not declared in permissions.network: <origin>` | `http.fetch` to an undeclared origin | add the origin (`https://host`, no path) |
| `HTTP response over 4 MB`, `method not allowed: <m>` | `http.fetch` limits | page the source; use GET, POST, PUT or DELETE |
| `plugin not declared in permissions.calls: <id>` | `call_plugin` to an undeclared plugin | add it to `calls` |
| `too many nested calls between plugins` | more than 3 levels | flatten |
| `plugin.call requires PostgreSQL` | `call_plugin` on SQLite | use PostgreSQL |
| `the plugin does not declare the service <s> in [[service_keys]]`, `no key of the service <s> is set` | `service_key` / `fetch_with_key` | declare the service; set a key (personal, tenant or platform) |
| `permission_denied` (files) | no `files_read` | add `files_read = true`; it is sensitive |
| `not_found` (files) | missing or not visible to the caller | the two look the same on purpose |
| `invalid_argument` (files) | bad id, a folder to `files.read`, bad `max_bytes` | fix the call |
| `MockHost: no answer for <op>` | a test with no programmed answer | `.on("<op>", …)` |

## The UI does not load or breaks

| You see | Cause | Fix |
|---|---|---|
| a blank page, console CSP violations | inline script, `on…=` handler, `javascript:`, an outside origin, or `eval` | ship files in `ui/dist`; declare origins in `network` / `frame_src`; `script_eval` only if you must. `validate --strict` lists them |
| a browser error on `localStorage` in an extension tab | tabs are sandboxed without `allow-same-origin` | do not use storage in a tab page |
| CSS or font does not apply | `style.css` not imported | `import '@mosaikit/plugin-api/style.css'` |
| the theme does not change | colours fixed in CSS | use the variables ([UI reference](ui.md)) |
| a page is not in the sidebar | an `extension` or `service` has no sidebar entry; or `use` is missing | only an `app` with `[ui]` is listed |

## The tools

| You see | Cause | Fix |
|---|---|---|
| `mosaikit-plugin doctor` reports the wasm target missing | no `wasm32-unknown-unknown` | `mosaikit-plugin doctor --fix` (also installed on first build) |
| `invalid id: … (e.g. com.company.<name>)` | the id breaks the rule | at least two segments, lower case, digits, `-` |
| `new` cannot find the SDK or the UI package | no registry yet | `--kit <folder>`, `MOSAIKIT_KIT`, or `--sdk-path` and `--plugin-api-path` |
| `dev`: `the server executable … does not exist (--server / MOSAIKIT_SERVER_BIN)` | no `mosaikit-server` next to the tool | `--server <path>` or `MOSAIKIT_SERVER_BIN` |
| `dev`: `the ports N and N+1 are not both free: choose another with --port` | the app and the plugin origin need two ports | `--port` |
| `dev`: `the server stopped at start …` | the developer profile refuses to run here: not loopback, a database on another host, `trust_proxy`, or the database already has tenants besides `dev` | read the message above it; use `--fresh` or `--data` for a clean folder. Do not lift the guard |
| `dev`: `the server does not answer on <url> after 90 seconds` | slow start, a crash, a port in use | read the server output; try `--port` |
| `<id>: the plugin does not validate: fix the manifest first` | `dev` validates before it starts | run `mosaikit-plugin validate` |
| `install`: `an Administrator is needed: --user and --password …` | missing credentials | give them or the `MOSAIKIT_ADMIN_*` variables |
| `install`: `this Administrator needs a second factor … add --totp <code>` / `the second factor … is not set up yet` | the account has a second factor (not in the developer profile) | `--totp`, or sign in once in the shell |
| changes do not show in `dev` through a Docker bind mount | file events may not cross from Windows or macOS into the container | restart the app, or use the desktop kit |

## FAQ

**Can a plugin read another plugin's data?** No. Call its commands (`calls`); it applies its own rules for the same user.

**Why does my SQL work on PostgreSQL and not on the desktop?** SQLite uses a translation; run `validate --strict`, or
require PostgreSQL.

**Can I edit a migration?** Not after it ran anywhere. Add a new one.

**How do I show a translated error?** Return `Error::coded("code", "English text")` from the logic; the UI maps the code
to a text in the language of `msk.context.lang`.

**Where do I find which permissions a user has?** Developer tools › Permissions in the shell, and `msk.perms`.

**What is experimental?** The surface has kernel tests but no official sample yet; API 1 does not promise it will
stay as it is ([Changelog and compatibility](changelog.md)).
