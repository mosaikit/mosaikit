# Changelog of mosaikit-plugin-cli

One version for the whole dev kit, the one of the platform (docs/plugin-devkit-plan.md, D6).

## 1.0.0

First version: the executable `mosaikit-plugin`.

- `new`, `build` and `pack` move here from `xtask`, which keeps `cargo xtask plugin ...` as a thin wrapper over the
  `mosaikit_plugin_cli` library. The template of a new plugin is inside the executable and now declares
  `[requires] mosaikit` and `api`.
- `new` makes a standalone project (its own Cargo workspace; the SDK and `@mosaikit/plugin-api` from the published
  versions or from `--sdk-path` / `--plugin-api-path`). Inside a folder that already has a Cargo workspace with the
  SDK and an npm workspace, the plugin joins them, as before.
- New: `test`, `sign`, `validate` (manifest, migrations against the SQL allow-list of the server, permissions,
  `.mskp` integrity and signature), `install --server`, `doctor`, and `keygen` that never overwrites a key.
- `build` installs the `wasm32-unknown-unknown` target with rustup when it is missing.
- `dev` (phase 4): starts the server of the kit in the developer profile for a plugin folder (`--server`, `MOSAIKIT_SERVER_BIN`, or
  the binary next to the tool), builds and rebuilds the logic and the UI, opens the browser and prints the addresses and the
  test users; `--port`, `--data`, `--no-open`, `--no-build`, `--no-watch`, `--fresh`. New plugin folders ignore `.mosaikit-dev/`.
- `new` (phase 3): `--variant` (app, ui, service, extension, language, layout), `--example` (todo, insights,
  note-priority, each with a walkthrough), `--lang`, `--kit` / `MOSAIKIT_KIT` and the environment variables
  `MOSAIKIT_SDK_PATH`, `MOSAIKIT_PLUGIN_API_PATH`. A standalone folder has its own lint, `.gitignore`, README, CI file,
  tests and texts in English, Italian and Spanish; the build tools are `typescript ~7.0.2`, `vite ^8.3.4`, `vitest ^5.0.5`, `oxlint ^1.89.0`.
- `test` also runs the `lint` and `test` scripts of the UI.
- `validate --strict` (phase 5): the conformance suite (description, author and license required; permissions against the host
  operations the logic calls, read from the source or from `logic.wasm`; migrations numbered with no gap, no irreversible
  statement and accepted for SQLite; the UI: size, outside requests, CSP; i18n coverage; the layout contract of `mountCrud` pages).
  `test` runs it. The templates now carry `author` and `license` placeholders.
- `self-update` (phase 7): updates the kit from a GitHub Release (or `--from-dir` a folder with the release files). It checks the
  signature of `SHA256SUMS` against the key in `trusted_key.txt` of the kit (`--trusted-key`, `MOSAIKIT_KIT_KEY`), then the hash of the archive,
  prints the «Breaking changes» of the release notes and asks for `--yes` when there are some or the major version changes;
  `--check` only reports. The crate publishes metadata for `cargo install` (with `mosaikit-mskp` and `mosaikit-sql-guard`).
