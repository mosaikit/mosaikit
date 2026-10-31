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
- `dev` is a stub that points at phase 4.
