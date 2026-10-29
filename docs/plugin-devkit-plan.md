# Mosaikit — Plan for the plugin development kit

A third party must be able to write, test, sign and ship a plugin **without the source code of Mosaikit**
and without cloning any of its repositories. This plan builds the kit that makes that possible: a compiled
Mosaikit to develop against, the tools, the packages the plugin imports, and the documentation.

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

## 3. Decisions to take before phase 1

| # | Decision | Options | Proposal |
|---|---|---|---|
| D1 | Where the packages are published | public crates.io and npm; a private registry; archives in the kit | Private registry or archives in the kit first, public later. The kit works offline with a local registry folder. |
| D2 | Licence of the kit | binary, SDK, examples, documents | SDK, templates, examples and documents under Apache-2.0 (as the official plugins). The server binary: terms for development use, to be set by the owner. |
| D3 | How stable the API is | declare 1.0; or mark 0.x unstable | Declare **plugin API 1** after the audit of phase 1; changes after that only with a new major or an additive way. |
| D4 | Third-party signing | one key per publisher, the Administrator trusts keys | Keep the current model (trusted keys in the configuration); the kit generates a development key. |
| D5 | Which compiled Mosaikit | desktop only; Docker only; both | Both: the desktop archive (SQLite, nothing to install) for the daily loop; the Docker image (PostgreSQL) for the check against the real database. |
| D6 | Support channel and versioning of the kit | | One version number for the kit; releases on the same cadence as the platform; a compatibility table in the documents. |

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

## 5. Summary

| Phase | Days | Depends on |
|---|---|---|
| 0 Decisions and audit | 2 | — |
| 1 Stable, versioned API | 5 | 0 |
| 2 Command-line tool | 6 | 1 |
| 3 Templates and examples | 5 | 1, 2 |
| 4 Development servers | 7 | 2 |
| 5 Tests and conformance | 5 | 2, 4 |
| 6 Documentation | 8 | in parallel with 2–5 |
| 7 Packaging and distribution | 4 | 2–6 |
| 8 Pilot | 5 | 7 |
| **Total** | **47 days** (about 10 weeks of one developer; about 7 weeks with two, phases 3–6 in parallel) | |

Critical path: 0 → 1 → 2 → 4 → 5 → 7 → 8.

## 6. Risks

| Risk | Effect | Answer |
|---|---|---|
| The API is frozen too early | Breaking changes pile up behind a version | The audit of phase 0 and a deprecation rule; additive changes first |
| Extracting the tool from `xtask` breaks the workflows of the repository | Slower releases | `xtask` keeps wrapper commands; CI runs both |
| The kit and the platform drift apart | Plugins break after an update | Compatibility range in the manifest; the kit is built by the platform pipeline |
| The desktop kit differs from the real server (SQLite and PostgreSQL) | Bugs found only in production | The Docker kit and the SQL guard checks for both databases |
| Support load | Questions block the team | Troubleshooting document, an issue template, a pilot first |
| Licence limits on the binary | Third parties cannot use the kit | Decide D2 in phase 0 |

## 7. What is not included

- A public marketplace or a review process for third-party plugins.
- Paid distribution, billing or telemetry of plugins.
- A graphical builder for plugins.
- Support for logic written in languages other than Rust (the ABI allows it; templates for other languages can
  follow once the kit is stable).
