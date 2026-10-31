# Mosaikit — Plan for the development kit (plugins and applications)

A third party must be able to write, test, sign and ship a plugin, and to build a whole **application** on
top of Mosaikit (a *distribution*: its own brand, its choice of plugins and its own plugins, as the first
derived product does), **without the source code of Mosaikit** and without cloning any of its repositories.
This plan builds the kit that makes that possible: a compiled Mosaikit to develop against, the tools, the
packages the code imports, and the documentation.

The plan has two tracks that share the same base: **Track A, plugins** (phases 0–8) and **Track B,
applications** (phases 9–14).

Status: proposal, 2026-10-29. Estimates are working days of one developer with the existing code base
(agent-assisted work shortens the coding, not the decisions, the reviews or the pilot).

## 1. Where we are

What already exists and is reused:

| Piece | State today |
|---|---|
| `cargo xtask plugin new / build / pack` | Scaffold (`xtask/templates/plugin`), build of logic (WASM) and UI, `.mskp` v3 package with `MANIFEST.sha256` and ed25519 signature. Lives in `xtask`, inside the `mosaikit` repository. |
| Development mode | `MOSAIKIT_DEV_PLUGINS` and `[plugins] dev` load plugins from their source folders with hot reload; `allow_unsigned` accepts unsigned packages (development only). |
| SDK of the logic | Crate `mosaikit-plugin-sdk` (`abi`, `host`, `values`, and `testing::MockHost` for native tests of the logic). Version taken from the Cargo workspace of `mosaikit`. |
| SDK of the UI | npm package `@mosaikit/plugin-api` 1.0.0 (`mountCrud`, `gridTable`, `emptyState`, `Msk` client, styles). Plugins reference it by the path `file:../../../mosaikit/ui/plugin-api`. |
| Distributions | `distribution.toml` (product, brand, plugin folders and selection, desktop database and port, Docker image, own tests), `brand.toml`, `cargo xtask --dist <folder> dev / test / release desktop|docker|k8s` (architecture §14). The kernel does not change; the product adds a brand, a choice of plugins and its own plugins. It works only from a checkout of `mosaikit` (it builds the server and the UI from source). |
| Compiled Mosaikit | Windows desktop release (`dist/`, SQLite), Docker image and compose files (`deploy/`, PostgreSQL), both built by `cargo xtask`. |
| Official plugins | Repository `mosaikit-plugins`: a Cargo workspace and an npm workspace at the root, one folder per plugin. |
| Compatibility | The manifest carries `abi` (kernel supports one value). No range of Mosaikit versions, no version of the UI API. |
| Documents | `docs/architecture.md` §8 (manifest, ABI, UI, package, extensions) and the user guides. No guide for authors. |

What stops an outside developer today:

1. The tools are `xtask` commands of the `mosaikit` repository.
2. The plugin workspace depends on the root `Cargo.toml` / `package.json` of `mosaikit-plugins` and on a sibling
   checkout of `mosaikit` (`file:` dependency, `workspace = true` inheritance).
3. No way to start a ready server to try the plugin that does not need a build of the platform.
4. The plugin API is not declared stable, and the manifest cannot say which Mosaikit versions it supports.
5. No guide, no reference of the host operations, no complete example outside the official plugins.
6. A distribution is built with `xtask --dist` from the source of Mosaikit: a third party cannot make a product
   from a compiled Mosaikit, and nothing describes what a product may change and what it may not.

## 2. Target

A developer installs one archive (or one container image) and runs, with no other prerequisite than Rust and
Node:

```
mosaikit-plugin new acme-reports      # a standalone folder: its own Cargo, npm, tsconfig, lint, CI
cd acme-reports
mosaikit-plugin dev                   # starts the bundled Mosaikit with a test tenant, loads this folder, hot reload
mosaikit-plugin test                  # unit tests of the logic (MockHost), checks of the manifest, migrations, permissions
mosaikit-plugin pack --sign key.pem   # .mskp ready to install
```

The plugin folder is self-contained: it depends only on published versions of `mosaikit-plugin-sdk` and
`@mosaikit/plugin-api`. The official plugins are rebuilt on the same basis, so there is a single path.

For an application (a product based on Mosaikit):

```
mosaikit-product new acme-portal       # a standalone folder: distribution.toml, branding, plugins/, tests, CI
cd acme-portal
mosaikit-product dev                   # the bundled Mosaikit with the brand, the plugins of the product and a test tenant
mosaikit-product test                  # smoke and conformance tests of the whole product
mosaikit-product build desktop|docker  # release from the compiled Mosaikit of the kit, no source needed
```

A product is built **from compiled artifacts** (the base desktop archive and the base Docker image of the
kit), adding its brand, its plugins (official and its own), its default settings and its database extensions.
The kernel is never modified: what a product can change is a defined, documented list (phase 9).

## 3. Decisions to take before phase 1

| # | Decision | Options | Proposal |
|---|---|---|---|
| D1 | Where the packages are published | public crates.io and npm; a private registry; archives in the kit | Private registry or archives in the kit first, public later. The kit works offline with a local registry folder. |
| D2 | Licence of the kit | binary, SDK, examples, documents | SDK, templates, examples and documents under Apache-2.0 (as the official plugins). The server binary: terms for development use, to be set by the owner. |
| D3 | How stable the API is | declare 1.0; or mark 0.x unstable | Declare **plugin API 1** after the audit of phase 1; changes after that only with a new major or an additive way. |
| D4 | Third-party signing | one key per publisher, the Administrator trusts keys | Keep the current model (trusted keys in the configuration); the kit generates a development key. |
| D5 | Which compiled Mosaikit | desktop only; Docker only; both | Both: the desktop archive (SQLite, nothing to install) for the daily loop; the Docker image (PostgreSQL) for the check against the real database. |
| D6 | Support channel and versioning of the kit | | One version number for the kit; releases on the same cadence as the platform; a compatibility table in the documents. |
| D7 | What a product may change | brand and plugins only; plus default settings, locked settings, languages, bootstrap data, database extensions | The list of phase 9: brand, plugin selection, own plugins, default and locked settings, languages, first-run bootstrap, extensions of PostgreSQL, ports and data folder. Never the kernel, the isolation of the origins or the signature rules. |
| D8 | How a product is built from a compiled Mosaikit | repack the base archive; derive from the base image; rebuild from source | Repack the base desktop archive and derive from the base Docker image; keep `xtask --dist` for builds from source. |
| D9 | Rights and responsibilities of a product's publisher | | Licence terms for redistributing the compiled base, the product's own name and brand, who supports what, what happens on a platform upgrade. |

**Decided (2026-10-31).** D1: archives in the kit and a private registry first, public registries later. D2: Apache-2.0 for the SDK, templates, examples and documents. D3: declare plugin API 1 after the audit of phase 1. D4: keep the current signing model (trusted keys in the configuration), the kit generates a development key. D5 and D6 keep the proposals above until the owner says otherwise. The audit of phase 0 is in [reports/plugin-api-audit.md](reports/plugin-api-audit.md); its list of changes opens phase 1.

**Baseline already in the code** (phases 9 to 11): `[[sidecars]]` (long-running and `kind = "oneshot"`, with the `files` overlay), seeding of plugin settings and service keys (`[[plugin_settings]]`, `[[service_key_values]]`), `[permissions] script_eval` and `allow_private_fetch_hosts`; see architecture §14.

## 4. Phases

Each phase ends with its tests green (`cargo xtask ci`, the e2e tests that apply), its documents written and a
commit, as in [ui-plan.md](ui-plan.md).

### Phase 0 — Decisions and audit (2 days)

- Take D1–D6 with the owner.
- List the public surface that a plugin touches: manifest fields, host operations (`host.rs`), commands and hooks
  of the logic, the `Msk` client and `mountCrud` options of the UI, the events and the extensions.
- Mark every item *stable*, *to change* or *internal*; write the result in `docs/reports/plugin-api-audit.md`.

Output: decisions recorded, audit report, the list of changes of phase 1.

### Phase 1 — A stable, versioned plugin API (5 days)

- Fix what the audit marks *to change* (names, optional fields, error codes) while nothing outside depends on it.
- Manifest: `[requires] mosaikit = ">=1.2, <2"` and `api = 1`; the kernel refuses a plugin outside its range
  with a translatable message and shows the reason in Plugins › Updates.
- Version the UI API: `@mosaikit/plugin-api` exports its version; the shell tells the plugin which version it
  speaks (handshake), the plugin adapts or declares itself incompatible.
- Make the SDK crate and the UI package independent of the workspace of `mosaikit` (own version, own changelog,
  own README, `publish = true`, `files` of the npm package).
- Document the deprecation rule: a deprecated item stays for one major version and logs a warning in development.
- Tests: kernel tests for the range check; unit tests for the handshake; plugin_lifecycle updated.

Output: plugin API 1 declared, compatible/incompatible handled end to end.

Delivered (2026-10-31), following section 8 of the audit: `[requires] mosaikit` and `api` with `abi` and `min_kernel` as
deprecated aliases, the refusal `plugin_incompatible` and its reason in Plugins › Updates, the UI handshake
(`API_VERSION`, `Hello.api`, `incompatible_api`), error `code` from the logic to `BridgeReply.code` (`ErrorCode`),
the hygiene of the SDK and of the UI package, own version, changelog and README for both, the deprecation rule and
the experimental list (architecture §8.11), manual checks `API-01..05`. Left for the owner: audit item 5
(`Resources::create/delete` and `resource.create` values: they are listed as experimental), `CrudOptions.panel`
(kept, experimental), making `kind` mandatory (it would reject old manifests), the name `web`, and a sample plugin
per experimental feature (phase 3). The crates and the npm package still sit in the workspaces of `mosaikit` for
lints and dependencies; they publish with their own metadata.

### Phase 2 — The command-line tool `mosaikit-plugin` (6 days)

- Extract `plugin new / build / pack` from `xtask` into a crate `mosaikit-plugin-cli` (a binary of its own),
  keeping `xtask` as a thin wrapper so the repository workflows do not change.
- Add `dev` (starts the bundled server, see phase 4), `test`, `sign`, `keygen`, `validate` (manifest, migrations,
  permissions, `.mskp`), `install --server <url>` (uploads a package to a test server), `doctor` (toolchain,
  versions, wasm target, Node).
- No dependency on the layout of the `mosaikit` repository: toolchain checks and `wasm32` target installed on demand.
- Distribution: archive per platform (Windows, Linux, macOS) with checksums; `cargo install` from the registry
  of D1.
- Tests: the CLI against a temporary folder (new → build → pack → validate) in CI on the three platforms.

Output: one executable that does the whole loop, usable without `xtask`.

### Phase 3 — Standalone templates and examples (5 days)

- Template that creates a **self-contained folder**: own `Cargo.toml` (versions pinned to the published SDK),
  `package.json`, `tsconfig.json`, `.oxlintrc.json`, `.gitignore`, `README.md`, CI file, sample migration,
  tests, i18n files (`en`, `it`, `es`).
- Variants: logic + UI, UI only, logic only (service), extension of another plugin, language pack, layout.
- Three complete examples with comments and a walkthrough each:
  1. *Todo-like* CRUD with the shared list and the detail panel (`mountCrud`, empty state, views).
  2. A plugin with its own page and charts, search and a KPI.
  3. An extension that adds fields and an action to Notes.
- Convert `mosaikit-plugins` to use the same standalone structure (one folder = one buildable plugin, plus a
  light root only for the monorepo convenience); remove the `file:` dependency on a sibling checkout.
- Tests: the generated folder builds on a clean machine in CI with no `mosaikit` checkout present.

Output: `mosaikit-plugin new` yields a project that builds alone; the official plugins build the same way.

### Phase 4 — Development servers (7 days)

- **Desktop kit** (SQLite): reduced archive of the existing desktop release with a *developer profile*:
  - tenant `dev`, an Administrator, a Tenant Manager and two Users with known development passwords;
  - sample content to test sharing, notifications and the log;
  - development mode on, unsigned packages allowed, plugin origin on `*.localhost`, hot reload of the logic,
    the UI and the manifest, migration re-run with a confirmation;
  - one command from the CLI (`mosaikit-plugin dev`) starts it, opens the browser and prints the addresses.
- **Docker kit** (PostgreSQL): compose file and image tag `mosaikit-dev`, same developer profile, volume for the
  plugin folder, to check migrations and RLS against the real database.
- Developer tools in the shell, visible only in development mode: panel with the manifest as the server reads it,
  host calls with timings and errors, the permissions of the signed-in user for this plugin, a button to reset the
  data of the plugin, a switch between the four test users.
- Tests: e2e that starts the kit, installs the example plugin from a folder and changes a file (hot reload).

Output: a developer runs one command and sees the plugin in a real Mosaikit within a minute.

### Phase 5 — Tests and conformance (5 days)

- `mosaikit-plugin test`: runs the unit tests of the logic with `MockHost` (documented, with recipes for
  `db.query`, `notify`, `call_plugin`, permissions), and the checks of the package.
- Conformance suite (`mosaikit-plugin validate --strict`): manifest schema, declared permissions against the
  host operations the logic calls, migrations (reversible naming, no access to other schemas, SQL accepted by the
  SQL guard for both PostgreSQL and SQLite), the UI (size, no external requests, CSP-compatible), i18n coverage,
  accessibility smoke test (axe) of the plugin pages in the dev server, the layout contract of the shell
  (header, table pattern, empty state) for the pages built with `mountCrud`.
- A Playwright helper package (`@mosaikit/plugin-testing`) to write end-to-end tests of a plugin against the
  development server: sign in as a test user, open the plugin, create an item.
- Tests: the suite passes on the official plugins and fails on deliberately broken fixtures.

Output: a plugin that passes `validate --strict` can be proposed to an Administrator with confidence.

### Phase 6 — Documentation (8 days, in parallel with phases 2–5)

Written in English with the Italian translation, in `docs/devkit/` and packaged in the kit:

| Document | Content |
|---|---|
| Getting started | Install, first plugin in ten minutes, the development loop |
| Concepts | Tenants, roles, ownership and sharing, resources, the three levels of settings, what a plugin may and may not do |
| Manifest reference | Every field of `plugin.toml`, with an example and the validation rule; kinds (app, service, extension, layout, language) |
| Logic reference | ABI, commands, hooks, host operations (`db`, `notify`, `call_plugin`, `files`, `web`, `groups`), errors, limits, `MockHost` |
| UI reference | `Msk` client, `mountCrud` and its options, `gridTable`, `emptyState`, `pageHead`, theme and style tokens, i18n, accessibility rules |
| Data | Migrations (PostgreSQL and SQLite), the security context, RLS and what the SQL guard allows |
| Security | Origins and CSP of plugin UIs, permissions, what is signed, secrets, untrusted content |
| Extensions and layouts | How to extend another plugin; how to write a layout or a language pack |
| UI guidelines | The rules of `refactoring-ui.md` that apply to plugins: header, table, empty state, detail panel, colours, density |
| Packaging and signing | `.mskp`, keys, trusted keys, the blocklist, versioning and updates, the registry `index.json` |
| Testing | Unit, conformance, end to end, CI recipes |
| Troubleshooting | The errors the kernel returns, with cause and fix; FAQ |
| Changelog and compatibility | Table of kit, platform, SDK, UI API versions; deprecations |

Plus API reference generated from the sources (`cargo doc`, TypeDoc) and published with the kit.

Output: a developer who has never seen the code can build the three examples from the documents alone
(checked in phase 8).

### Phase 7 — Packaging, signing and distribution (4 days)

- Build pipeline of the kit: archive per platform with the CLI, the desktop server, the Docker image tag, the
  packages of D1, the documents, the examples, `SHA256SUMS` and a signature of the archive.
- Developer signing: `keygen`, how an Administrator adds a publisher key, a revocation procedure.
- Release notes and the compatibility table generated from the manifests.
- Licence files, third-party notices of the bundled server and packages (checked with `cargo deny` and the npm
  licence report already used by `dependencies.md`).
- Update path: `mosaikit-plugin self-update` and a note in each kit release about breaking changes.

Output: a reproducible release of the kit with one command.

### Phase 8 — Pilot with an outside developer (5 days, mostly waiting)

- One developer outside the team builds a plugin from the documents alone, on a clean machine, with no help except
  the support channel; every question is logged.
- Fix the documents and the tools for every stumble; add the missing troubleshooting entries.
- Exit criteria: first plugin running in the development server in under 30 minutes; `validate --strict` passes;
  the `.mskp` installs in a production-like server (Docker kit) with a trusted key.

Output: the kit is declared ready (v1.0).

## 5. Track B — Applications based on Mosaikit (distributions)

An application is a distribution: a product with its own name, brand, plugins and defaults on top of the
unchanged kernel. Track B starts when phases 1, 2 and 4 of Track A are done (it reuses the stable API, the
command-line tool and the base servers) and adds what only a product needs.

### Phase 9 — What a product may change, and the contract of the base (3 days)

- Audit the distribution mechanism (architecture §14, `distribution.toml`, `brand.toml`, `xtask --dist`) and
  write what a product may change (D7) and what is fixed: kernel, security rules, origins, the signature model.
- Define the **contract of the base artifacts** a product builds on: the desktop archive and the Docker image of
  the kit, their folders (`plugins/`, `brand/`, configuration, data), the environment variables, the ports, the
  data folder, the extension points (brand, defaults, bootstrap, plugin registry), the versioning rule (a base
  version range per product release).
- Write it down in `docs/reports/distribution-audit.md` and fix in the kernel and the server what the audit
  marks as a gap, as phase 1 does for the plugin API.

Output: a documented, versioned contract between the base and a product.

### Phase 10 — The product builder `mosaikit-product` (8 days)

- A command-line tool (same family and installation as `mosaikit-plugin`; a crate `mosaikit-product-cli`):
  - `new`: standalone folder with `distribution.toml`, `branding/` (brand.toml, logo, favicon, icon),
    `plugins/` (its own plugins, standalone as in phase 3), `shared/` for code used by several plugins,
    tests, a CI file, a README;
  - `dev`: starts the bundled Mosaikit with the brand and the plugins of the product loaded from their folders
    (hot reload), a test tenant and the four test users;
  - `build desktop`: takes the base desktop archive, adds the signed plugins and the registry, applies the brand
    (name, icon and version of the executable through a resource edit, colours, texts), writes the commented
    configuration; no compilation of the kernel;
  - `build docker`: `FROM` the base image, adds plugins, brand and configuration; optional database image with
    extensions (for example PostGIS) and the compose file;
  - `build k8s`: the kustomize manifests for the product;
  - `sign`, `validate`, `doctor` as in phase 2.
- Keep `cargo xtask --dist` for builds from source; both paths read the same `distribution.toml`.
- A product can keep several plugin folders (`roots`) and the official plugins by id and version, taken from the
  registry of the kit (offline) or from the one of D1.
- Tests: from a clean folder, `new` → `build desktop` → start → sign in → the brand and the plugins are there;
  the same with Docker; in CI on the supported platforms.

Output: a product is built from the compiled kit with one command, with no Mosaikit source.

### Phase 11 — Defaults, bootstrap and database extensions of a product (6 days)

- `distribution.toml` grows the sections that make a product behave as one, all optional:
  - `[defaults]` values of the settings on the three levels, and `[locked]` the ones the Administrator and the
    tenants cannot change (the *managed* kind of the settings, set from the product);
  - `[languages]` enabled and default languages, language packs included;
  - `[bootstrap]` first start: first Administrator, first tenant, trial and quotas, and a hook for seed data
    of a plugin (an idempotent command run once);
  - `[database]` required extensions (PostGIS, others) checked at start with a clear message, embedded
    PostgreSQL with extensions for the desktop product, SQLite or PostgreSQL by product;
  - `[ports]`, data folder, backup folder;
  - `[about]` the product name, version, licence and the version of the base shown in the About dialog and the log.
- Kernel and server read them at start from the configuration file the builder writes (no code change per product).
- The upgrade rule: the base checks that the version of the product's base range includes it and says why when
  not; the migrations of the base and of the plugins run as today.
- Tests: kernel tests for defaults and locked settings; a bootstrap test (first start creates tenant and
  Administrator once); the missing-extension message.

Output: a product sets its identity, defaults and first start in `distribution.toml`.

### Phase 12 — Tests and conformance of a product (4 days)

- `mosaikit-product test`: smoke test (start, sign in as each test user, open each plugin page, the brand, the
  About dialog), the checks of every included plugin (`validate --strict` of phase 5), the layout contract of the
  shell with the product's brand, the accessibility smoke test, an upgrade test (the product built on the base
  version N runs on N+1).
- Playwright helpers of phase 5 extended to start a product's server and sign in as the product's roles.
- Tests: the suite passes on the reference product and fails on deliberately broken fixtures (a plugin outside
  the base range, a missing extension, an unsigned plugin in a production build).

Output: a product publisher can prove their build is sound before shipping it.

### Phase 13 — Documentation for building applications (5 days, in parallel with phases 10–12)

Written in English with the Italian translation, in `docs/devkit/` next to the plugin documents:

| Document | Content |
|---|---|
| Building an application | What a product is, what the base gives, what a product adds, what it cannot change; the structure of a product folder |
| Brand and identity | `brand.toml`, logo and icons, colours and the contrast check, texts of the sign-in page, executable name and icon, the About dialog |
| Choosing and writing plugins | Official plugins by id and version, own plugins, shared code between plugins, nothing to fork |
| Settings, languages and first start | `[defaults]`, `[locked]`, `[languages]`, `[bootstrap]`, seed data, trial and quotas |
| Data and extensions | PostgreSQL and SQLite, required extensions (PostGIS), migrations, backup and restore of a product |
| Build and release | `mosaikit-product build`, signing, the registry of the product, desktop, Docker and Kubernetes, checksums |
| Upgrades | The base version range, how to move a product to a new base, deprecations, the compatibility table |
| Operations | Monitoring, maintenance mode, backups, the log, support information to collect |
| Licensing and responsibilities | D9: what can be redistributed, names and brands, who supports what |
| Reference product | A small but complete example product (a brand, three official plugins, one own plugin with logic and UI, its defaults and first start), walked through step by step |

Output: someone who has never seen the code builds the reference product from the documents alone (checked in
phase 14).

### Phase 14 — Pilot with an outside product (5 days, mostly waiting)

- One team outside the project builds a product from the documents alone (brand, plugins, defaults,
  a desktop and a Docker release); every question is logged and answered in the documents.
- Exit criteria: first product running in under one working day; `mosaikit-product test` passes; the Docker
  release is installed on a clean machine and survives an upgrade of the base.

Output: the kit is declared ready for applications (v1.0 of Track B).

## 6. Summary

| Phase | Days | Depends on |
|---|---|---|
| **Track A — plugins** | | |
| 0 Decisions and audit | 2 | — |
| 1 Stable, versioned API | 5 | 0 |
| 2 Command-line tool | 6 | 1 |
| 3 Templates and examples | 5 | 1, 2 |
| 4 Development servers | 7 | 2 |
| 5 Tests and conformance | 5 | 2, 4 |
| 6 Documentation | 8 | in parallel with 2–5 |
| 7 Packaging and distribution | 4 | 2–6 |
| 8 Pilot | 5 | 7 |
| *Subtotal Track A* | *47* | |
| **Track B — applications** | | |
| 9 What a product may change, contract of the base | 3 | 1 |
| 10 The product builder | 8 | 2, 4, 9 |
| 11 Defaults, bootstrap, database extensions | 6 | 9 |
| 12 Tests and conformance of a product | 4 | 5, 10, 11 |
| 13 Documentation for applications | 5 | in parallel with 10–12 |
| 14 Pilot with an outside product | 5 | 12, 13 |
| *Subtotal Track B* | *31* | |
| **Total** | **78 days** (about 16 weeks of one developer; about 11 weeks with two: Track B phases 9–13 run beside phases 5–8 of Track A, and the two pilots can be one) | |

Critical path: 0 → 1 → 2 → 4 → 5 → 7 → 8 for plugins; 1 → 9 → 10 → 12 → 14 for applications (after phases 2 and 4).
Track A alone (plugins) is 47 days and can be released first.

## 7. Risks

| Risk | Effect | Answer |
|---|---|---|
| The API is frozen too early | Breaking changes pile up behind a version | The audit of phase 0 and a deprecation rule; additive changes first |
| Extracting the tool from `xtask` breaks the workflows of the repository | Slower releases | `xtask` keeps wrapper commands; CI runs both |
| The kit and the platform drift apart | Plugins break after an update | Compatibility range in the manifest; the kit is built by the platform pipeline |
| The desktop kit differs from the real server (SQLite and PostgreSQL) | Bugs found only in production | The Docker kit and the SQL guard checks for both databases |
| Support load | Questions block the team | Troubleshooting document, an issue template, a pilot first |
| Licence limits on the binary | Third parties cannot use the kit | Decide D2 in phase 0 |
| A product changes more than the contract allows | Updates of the base break it | The list of phase 9, the base version range in the product, `mosaikit-product test` with the upgrade test |
| Repackaging the base desktop archive (resource edit of the executable) is fragile | Brand not applied on some systems | Test on the supported platforms in CI; fall back to the brand in the configuration and the shell when the executable cannot be edited |
| Database extensions (PostGIS) differ between the embedded and the server database | A product works on one and not on the other | `[database]` checks at start with a clear message; the Docker kit with the product's database image |
| Two separate pilots delay the release | Longer path | Release Track A first; run the pilot of Track B on the first product made with the kit |

## 8. What is not included

- A public marketplace or a review process for third-party plugins.
- Paid distribution, billing or telemetry of plugins.
- A graphical builder for plugins or products.
- Changes to the kernel for a single product (a product needing one asks for a change in the base, for all).
- Hosting, billing or tenancy management of a product's customers.
- Support for logic written in languages other than Rust (the ABI allows it; templates for other languages can
  follow once the kit is stable).
