# Getting started

From nothing to a plugin running in a real Mosaikit in about ten minutes. You need Rust (with `rustup`) and Node.js;
you do not need a checkout of Mosaikit.

## 1. Install the kit

The kit is one folder (or archive) with:

| Part | What |
|---|---|
| `bin/mosaikit-plugin` | the command-line tool: `new`, `build`, `test`, `validate`, `pack`, `sign`, `keygen`, `install`, `dev`, `doctor`, `self-update` |
| `bin/mosaikit-server` | the Mosaikit server that `dev` starts (developer profile, SQLite) |
| `sdk/`, `plugin-api/` | the Rust SDK (`mosaikit-plugin-sdk`) and the UI package (`@mosaikit/plugin-api`), until a registry has them |
| `docs/` | these documents |

Download the archive of your platform from the GitHub Releases of `mosaikit/mosaikit`
(`mosaikit-devkit-<version>-<platform>`), check it ([Releasing the kit](releasing.md)), unpack it, and put its `bin/`
folder on your `PATH` (or point `MOSAIKIT_KIT` at the folder). The Windows archive has the server; on Linux and macOS the
development server is the Docker image (`docker/README.md` in the kit). `mosaikit-plugin self-update` brings the kit
to the next release. Without an archive, build the two executables from the Mosaikit sources
(`cargo build --release -p mosaikit-plugin-cli -p mosaikit-server`) and use `--sdk-path` and `--plugin-api-path`
(or `MOSAIKIT_SDK_PATH`, `MOSAIKIT_PLUGIN_API_PATH`) in place of `--kit`.

Check the machine:

```
mosaikit-plugin doctor          # Rust, the wasm32-unknown-unknown target, Node
mosaikit-plugin doctor --fix    # installs the wasm32 target if it is missing
```

## 2. Make a plugin

```
mosaikit-plugin new acme-reports --kit <the folder where you unpacked the kit>
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

`ui/package.json` points at the UI package of the kit with a relative `file:` path (for example
`file:../../../mosaikit-devkit/plugin-api`). The path is relative to `ui/`: if you move the plugin or the kit, edit it
(or run `npm pkg set "dependencies.@mosaikit/plugin-api=file:<new path>"` in `ui/`). The templates hold non-ASCII text
(accents): edit them with a UTF-8 editor (a script that reads them as cp1252 on Windows corrupts them).

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
in the kit's `docker/` folder: `docker compose up -d` there (`docker/README.md` says where the image comes from, how to load
it offline and how to set a trusted key).

## 4. Change something

1. In `plugin.toml` add a field to the resource: `{ key = "due", label = "Due", kind = "date" }`. The server adds the column; the form and the table show it. Then give the field a label in each language the plugin declares, or `mosaikit-plugin test` fails with `[i18n.it] is incomplete`: in `[i18n.it.resources.<resource>]` and in `[i18n.es.resources.<resource>]` add `due = "..."` to `fields` (for example `Scadenza`, `Vence`).
2. In `src/lib.rs` change what a hook does. The tool rebuilds; reload the page.
3. In `ui/src/main.ts` change the `mountCrud` options (`title`, `columns`, `empty`).

## 5. Test, pack, install

```
mosaikit-plugin test                       # strict validation, cargo test, tsc, lint and vitest of the UI
mosaikit-plugin pack                       # dist/<id>-<version>.mskp, signed with your key
mosaikit-plugin install dist/<file>.mskp --server http://localhost:8080 --user admin --password mosaikit-dev   # on the Docker kit, section 6
```

`pack` signs with `--key`, else `MOSAIKIT_SIGNING_KEY`, else `MOSAIKIT_SIGNING_KEY_FILE`, else a development key the tool
makes once for you. A server installs a signed package only if it trusts the public key; the developer profile also
accepts unsigned ones. See [Packaging and signing](packaging.md) and [Testing](testing.md).

What the three commands do:

- `test` checks the plugin without a server: the manifest and its rules (`validate --strict`), the migrations on PostgreSQL and SQLite, the translations, then the Rust tests, `tsc`, the lint and the tests of the UI.
- `pack` builds the plugin and writes one file, `dist/<id>-<version>.mskp`: the logic, the UI, the migrations and the manifest, with a signature. Nothing is sent anywhere.
- `install` uploads that file to a **running** Mosaikit server: it signs in as an Administrator (`--user`, `--password`) and sends the package. The server checks the signature against its trusted keys and installs it. `--server` is the address of that server.

## 6. Install on the Docker kit

`dev` runs your plugin from its folder, so it cannot also install the `.mskp`: a server that loaded a plugin from a folder
refuses a package of the same plugin (`is loaded in development mode`), and removing the plugin in the web page does not
last, because `dev` loads it again. The package goes to **another** server: the Docker kit, which is the nearest thing to
a real installation (PostgreSQL, the roles and the row level security the platform makes for the plugin, a list of trusted
keys). Do this once the plugin passes `test`.

1. **Stop `dev`** (Ctrl+C in its window). It holds port 8080.
2. **Make a signing key** and keep the public key it prints:
   `mosaikit-plugin keygen --out publisher.key`
3. **Trust the key in the kit.** In `docker/.env` set `MOSAIKIT_TRUSTED_KEYS=<the public key>`. Leave `PLUGIN_DIR` as it is: if it points at your plugin folder the plugin is "in development" again and `install` fails.
4. **Start the kit**, in the `docker/` folder of the kit: `docker compose up -d`. The first start pulls the image; if the pull is refused, see `docker/README.md` (an image archive can be loaded offline). Open `http://localhost:8080`.
5. **Pack with that key**, in the folder of the plugin:
   `mosaikit-plugin pack --key publisher.key`
6. **Install**:
   `mosaikit-plugin install dist/<file>.mskp --server http://localhost:8080 --user admin --password mosaikit-dev`
   (the Docker kit is a developer profile too: same test users as `dev`).
7. **Turn the plugin on.** After `install` it is only "installed": open `#/admin`, Platform > Plugins > your plugin > **Turn on** (then it is `active` and available to the tenant `dev`). Until then its page does not appear in the shell.
8. **Use it.** Sign in as `alice` or `manager` (tenant `dev`) and create, change and delete an entry.
9. **Check that the key matters.** Pack again with another key that the kit does not trust (`mosaikit-plugin keygen --out other.key`, `pack --key other.key`) and run `install` again: it must be refused with `publisher key not trusted: <key>`. Without this, you have not shown that the kit checks who published a package.

Without a server running, `install` stops with `reaching <address>` and `os error 10061` (connection refused). To start again
from nothing: `docker compose down -v`. The ports, the `.env` and the folder of the plugin are in `docker/README.md`.

## Next

- Read the walkthrough of an example (`--example todo`): about 250 lines, in order.
- [Concepts](concepts.md) tells what a plugin may and may not do; [Manifest reference](manifest.md) is every field.
- When something fails: [Troubleshooting](troubleshooting.md).
