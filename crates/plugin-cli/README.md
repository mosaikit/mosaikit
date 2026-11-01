# mosaikit-plugin

The command-line tool of [Mosaikit](https://github.com/mosaikit) plugin developers. One executable does the
whole loop, with no dependency on the layout of the `mosaikit` repository: a plugin is a folder with a
`plugin.toml`, wherever it is.

```text
mosaikit-plugin doctor                       toolchain: Rust, the wasm32 target, Node
mosaikit-plugin new acme-reports             a standalone plugin folder (--variant, --example, --lang, --kit, --id, --into)
mosaikit-plugin build [dir] [--release]      logic (WASM) and UI; installs the wasm32 target if it is missing
mosaikit-plugin test [dir]                   strict validation, tests of the logic (native, MockHost), type check, lint and tests of the UI
mosaikit-plugin pack [dir] [--key file]      build, validate, sign: dist/<id>-<version>.mskp
mosaikit-plugin validate [dir|file.mskp] [--strict]   manifest, migrations (SQL allow-list), permissions, package integrity; --strict: the conformance suite
mosaikit-plugin keygen --out publisher.key   a signing key pair (the public key goes in the server's trusted_keys)
mosaikit-plugin sign file.mskp --key k       sign a package again with another key
mosaikit-plugin install file.mskp --server <url> --user admin --password ... [--totp code]
mosaikit-plugin dev [dir] [--server path]    the development server (developer profile) for the folder: builds, starts, opens the browser
```

**Variants and examples.** `new --variant app|ui|service|extension|language|layout` (`app` is the default; a
language needs `--lang fr` or a name like `lang-fr`) and `new --example todo|insights|note-priority`, a complete commented
plugin with a `WALKTHROUGH.md`. The folder is standalone: own `Cargo.toml`, `ui/package.json`, `tsconfig.json`, `.oxlintrc.json`,
`.gitignore`, README, CI file, sample migration, tests and texts in English, Italian and Spanish.

**SDK and UI package.** Until a registry has them, `new` takes them from `--sdk-path` / `--plugin-api-path`
(`MOSAIKIT_SDK_PATH`, `MOSAIKIT_PLUGIN_API_PATH`), else from the folders `sdk/` and `plugin-api/` of the kit
(`--kit <folder>`, `MOSAIKIT_KIT`), else it asks for the published versions.

`validate` exits with 1 when it finds an error; warnings (old keys, no `[requires]`, an unsigned package) do not
change the exit code.

**`validate --strict`** is the conformance suite a plugin passes before it is proposed to an Administrator. It is static (no
server, no browser) and works on a folder and, for what a package holds, on a `.mskp`. `test` runs it first.

| Check | How |
|---|---|
| Manifest | the schema (`plugin.toml` is read with unknown keys refused) and, in strict mode, `description`, `author` and `license` are required |
| Permissions against the calls of the logic | in a folder, the Rust source of the logic (`src/**/*.rs`, up to `#[cfg(test)]`, comments left out) is scanned for the SDK calls `.files()`, `.notify(`, `.call_plugin("id"`, `.http()`, `.service_key(` and for the literal names of host operations; in a package, `logic.wasm` is scanned for the literals the SDK links in (`files.*`, `plugin.call`, `http.fetch`, `key.get`; `notify` has no safe literal in the binary, so it is checked in the source only). A call with no permission is an error; `files_read`, `notify` and `calls` asked for and never used are errors too; a listed hook with no registered `"<resource>.<hook>"` is an error |
| Migrations | `NNN_name.sql` numbered from 001 with no gap or duplicate, names in lower case, no `drop table`, `drop column` or `truncate` (migrations only add), SQL accepted by the guard of PostgreSQL (own schema only) and by the translation for SQLite that the desktop uses |
| UI | built `ui/dist` (or, if not built, the sources in `ui/`): at most 10 MiB; no script, `<link>`, image, frame or media from an outside origin, no `url()` or `@import` of one, no `fetch`, `import()`, `WebSocket`... of an outside literal address unless the origin is in `network` or `frame_src`; nothing the CSP of plugin pages blocks (inline `<script>`, `on...=` handlers, `javascript:`); `eval` and `new Function` are a warning without `script_eval`; the entry page has a title, a charset and a viewport |
| i18n | every declared `[i18n.<lang>]` covers `description`, `details`, the label, the resources and their visible fields, the navigation, the KPIs and the user permissions of the English manifest (a language plugin is exempt) |
| Layout contract of `mountCrud` pages | on the sources of the UI, best effort: the resource of the call is declared in `[[resources]]`, the UI imports `@mosaikit/plugin-api/style.css` and calls `connect()`, the page has a `title` option (a warning), its own `<table>` instead of `gridTable` is a warning |

Not covered by the static suite: the accessibility smoke test (axe) runs in a browser, against the development server, with the
`expectAccessible` helper of `@mosaikit/plugin-testing`. A missing `[requires]` stays a warning.

**Testing the logic.** `mosaikit_plugin_sdk::testing::MockHost` runs commands and hooks natively against the answers you program
(`on`, `with_perms`, `with_plugin_command`, `with_files`, `deny`); the documentation of the module has a recipe for `db.query`, `notify`,
`call_plugin`, permissions and the Files area. **End to end**, `@mosaikit/plugin-testing` (`ui/plugin-testing` in the Mosaikit
repository) starts or attaches to `mosaikit-plugin dev`, signs in as a test user, opens the plugin and creates an item.

**Signing key.** `--key <file>`, else `MOSAIKIT_SIGNING_KEY` (base64), else `MOSAIKIT_SIGNING_KEY_FILE`, else a
development key that the tool makes once in the configuration folder of the user (`%APPDATA%\mosaikit\signing.key`,
`~/.config/mosaikit/signing.key`). A server installs a signed package only if it trusts the public key.

**`install`** signs in to the server as an Administrator (the same door as the shell, with the second factor if the
account has one) and uploads the package the way Plugins › Install from a file does. Give the address with its base
path (`http://localhost:8080/mosaikit`). The user and the password can come from `MOSAIKIT_ADMIN_USER` and
`MOSAIKIT_ADMIN_PASSWORD`.

**`dev`** starts the server of the kit in the **developer profile** for the plugin folder and keeps the builds going. It builds the
logic (debug) and the UI, writes a configuration in `.mosaikit-dev/` of the folder (loopback ports, a SQLite database, the profile
on), starts `mosaikit-server`, waits until it answers, opens the browser on the plugin and prints the addresses and the test
users (`admin`, `manager`, `alice`, `bob`, password `mosaikit-dev`; the three of the tenant `dev`, and the Administrator at
`#/admin`). The server reloads the manifest, the migrations, the UI and the logic when they change; the tool rebuilds the logic
or the UI when their sources change (`--no-watch` stops that, `--no-build` skips the builds). The banner of the shell says the profile is on, and
**Developer tools** shows the manifest as the server reads it, the host calls with their timings and errors, the permissions, the
switch of users and the reset of the data of the plugin. Options: `--port` (default the first free pair from 8080; the plugins
use the next port), `--data`, `--no-open`, `--fresh` (new database, tenant and users).

The server executable comes from `--server <path>`, else the variable `MOSAIKIT_SERVER_BIN`, else the file `mosaikit-server` next
to this tool (the kit puts them together); otherwise `dev` stops and says so. The profile refuses to run where somebody else
could reach it (another address than loopback, a database on another host, a reverse proxy): the tool never sets the flag that
lifts those guards and removes the variables of the environment that could (`MOSAIKIT_DEVELOPER_PROFILE_ALLOW_REMOTE`,
`DATABASE_URL`, `MOSAIKIT_URL`, ...). The Docker kit (`mosaikit-dev`, with PostgreSQL) is for the check against the real database.

`cargo xtask plugin new|build|pack|keygen` of the `mosaikit` repository call the same code (the `mosaikit_plugin_cli`
library) for the plugins of a distribution.

## Distribution (prepared, nothing is published)

- Archives per platform: `cargo build --release -p mosaikit-plugin-cli` on Windows, Linux and macOS, then zip the
  `mosaikit-plugin` executable with this README and a `SHA256SUMS` file. The release workflow that does it, and the
  choice of the registry (D1 of the plan), belong to phase 7.
- `cargo install mosaikit-plugin-cli`: the metadata is ready (`description`, `license`, `readme`, `include`). Before the
  first publish, `mosaikit-mskp` and `mosaikit-sql-guard` must be published too, and the workspace dependencies on them
  need a `version` next to their `path`.
- One version for the whole kit, on the cadence of the platform (D6): this crate takes the workspace version.
