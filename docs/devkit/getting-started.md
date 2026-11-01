# Getting started

From nothing to a plugin running in a real Mosaikit in about ten minutes. You need Rust (with `rustup`) and Node.js;
you do not need a checkout of Mosaikit.

## 1. Install the kit

The kit is one folder (or archive) with:

| Part | What |
|---|---|
| `bin/mosaikit-plugin` | the command-line tool: `new`, `build`, `test`, `validate`, `pack`, `sign`, `keygen`, `install`, `dev`, `doctor` |
| `bin/mosaikit-server` | the Mosaikit server that `dev` starts (developer profile, SQLite) |
| `sdk/`, `plugin-api/` | the Rust SDK (`mosaikit-plugin-sdk`) and the UI package (`@mosaikit/plugin-api`), until a registry has them |
| `docs/` | these documents |

Put its `bin/` folder on your `PATH`, or point `MOSAIKIT_KIT` at it. The archives per platform are built by the packaging
phase of the plan: until you have one, build the two executables from the Mosaikit sources
(`cargo build --release -p mosaikit-plugin-cli -p mosaikit-server`) and use `--sdk-path` and `--plugin-api-path`
(or `MOSAIKIT_SDK_PATH`, `MOSAIKIT_PLUGIN_API_PATH`) in place of `--kit`.

Check the machine:

```
mosaikit-plugin doctor          # Rust, the wasm32-unknown-unknown target, Node
mosaikit-plugin doctor --fix    # installs the wasm32 target if it is missing
```

## 2. Make a plugin

```
mosaikit-plugin new acme-reports --kit /path/to/kit
cd acme-reports
```

The id of the plugin is `com.example.<name>` unless you give `--id com.acme.reports` (at least two segments of lower case letters, digits and `-`). The folder is
standalone: its own `Cargo.toml`, `ui/package.json`, `tsconfig.json`, `.oxlintrc.json`, `.gitignore`, `README.md`, a CI
file, a sample migration, tests, and texts in English, Italian and Spanish.

| Option | Choices |
|---|---|
| `--variant` | `app` (logic and UI, the default), `ui`, `service` (logic only), `extension`, `language`, `layout` |
| `--example` | `todo`, `insights`, `note-priority`: a complete commented plugin with a `WALKTHROUGH.md` |
| `--lang fr` | the code of a language pack (needs `--variant language`, or a name like `lang-fr`) |
| `--kit`, `--sdk-path`, `--plugin-api-path` | where the SDK and the UI package come from |

What is in an `app` folder:

```
plugin.toml        the manifest: data, pages, permissions, KPIs, translations
Cargo.toml         the logic (Rust, compiled to WebAssembly)
src/lib.rs         commands and hooks, with their tests (MockHost)
migrations/        SQL of the plugin (here: a KPI view)
ui/                the UI (Vite and TypeScript): ui/src/main.ts calls mountCrud
```

## 3. The development loop

```
mosaikit-plugin dev
```

`dev` builds the logic and the UI, writes a configuration in `.mosaikit-dev/`, starts `mosaikit-server` in the
**developer profile**, waits until it answers, opens the browser and prints the addresses and the test users:

| User | Role | Password |
|---|---|---|
| `admin` | Administrator (sign in at `#/admin`; no second factor in this profile) | `mosaikit-dev` |
| `manager` | Tenant Manager of the tenant `dev` | `mosaikit-dev` |
| `alice`, `bob` | Users of the tenant `dev` | `mosaikit-dev` |

The tenant `dev` comes with a group, a welcome notification, entries in the Log and, when your plugin declares a
resource, one item of it shared with Bob. Your plugin is loaded from its folder with hot reload: the server reloads the
manifest, the migrations, the UI (`ui/dist`) and the logic (the `.wasm` of the folder's `target/`) when they change,
and the tool rebuilds the logic and the UI when their sources change. A banner in the shell says the profile is on.

Open **Developer tools** in the shell to see the manifest as the server reads it, the host calls of the plugin with
their time and errors, the permissions of the signed-in user, the switch between the four users and a button that
deletes the data of the plugin and runs its migrations again. If you change a migration that already ran, the shell
asks whether to delete the data and start over: **a migration that was applied is never edited, you add a new one**
(see [Data](data.md)).

Options: `--port`, `--data`, `--no-open`, `--no-build`, `--no-watch`, `--fresh` (new database, tenant and users). The
server comes from `--server`, `MOSAIKIT_SERVER_BIN`, or the file next to the tool. The profile refuses to run where
somebody else could reach it (not loopback, a database on another host, a reverse proxy): it is for your computer only
(architecture §8.12).

To check migrations and row level security on the real database (PostgreSQL) use the Docker kit: image
`mosaikit-dev`, compose file `deploy/compose.devkit.yml` (built with `cargo xtask release devkit-docker`).

## 4. Change something

1. In `plugin.toml` add a field to the resource: `{ key = "due", label = "Due", kind = "date" }`. The server adds the column; the form and the table show it.
2. In `src/lib.rs` change what a hook does. The tool rebuilds; reload the page.
3. In `ui/src/main.ts` change the `mountCrud` options (`title`, `columns`, `empty`).

## 5. Test, pack, install

```
mosaikit-plugin test                       # strict validation, cargo test, tsc, lint and vitest of the UI
mosaikit-plugin pack                       # dist/<id>-<version>.mskp, signed with your key
mosaikit-plugin install dist/<file>.mskp --server http://localhost:8080 --user admin --password mosaikit-dev
```

`pack` signs with `--key`, else `MOSAIKIT_SIGNING_KEY`, else `MOSAIKIT_SIGNING_KEY_FILE`, else a development key the tool
makes once for you. A server installs a signed package only if it trusts the public key; the developer profile also
accepts unsigned ones. See [Packaging and signing](packaging.md) and [Testing](testing.md).

## Next

- Read the walkthrough of an example (`--example todo`): about 250 lines, in order.
- [Concepts](concepts.md) tells what a plugin may and may not do; [Manifest reference](manifest.md) is every field.
- When something fails: [Troubleshooting](troubleshooting.md).
