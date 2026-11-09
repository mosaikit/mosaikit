# Getting started

From nothing to a plugin running in a real Mosaikit in about ten minutes. You need Rust (with `rustup`) and Node.js;
you do not need a checkout of Mosaikit.

## 1. Install the kit

**What do I download?** Mosaikit has two things to download, and the platform release holds both:

| I want to | I need | Where |
|---|---|---|
| Make a **plugin** | the **Dev Kit**: `mosaikit-plugin`, the documents, the examples | the archive `mosaikit-devkit-<version>-<platform>` in the **Assets** of a release |
| Make a **product** (an application) | the Dev Kit (`mosaikit-product` is in it) **and** the **Base**: Mosaikit compiled, which the product is built on | the Base is in the same release: the desktop zip `mosaikit-<version>-desktop-windows-x86_64.zip` and the image `ghcr.io/mosaikit/mosaikit:v<version>` |

The releases named `v<version>` (for example `v1.0.0`) have everything: the Dev Kit for every system, the desktop zip of the Base and the
notes. The releases named `kit-v<version>` (for example `kit-v1.0.0-rc3`) have the Dev Kit alone, for a version still being tried. A
plugin needs only the Dev Kit; the Base is for products ([Building an application](building-an-application.md)).

The kit is one folder (or archive) with:

| Part | What |
|---|---|
| `bin/mosaikit-plugin` | the command-line tool: `new`, `build`, `test`, `validate`, `pack`, `sign`, `keygen`, `install`, `dev`, `doctor`, `self-update` |
| `bin/mosaikit-server` | the Mosaikit server that `dev` starts (developer profile, SQLite) |
| `sdk/`, `plugin-api/` | the Rust SDK (`mosaikit-plugin-sdk`) and the UI package (`@mosaikit/plugin-api`), until a registry has them |
| `docs/` | these documents |

**Download.** Open the releases of `mosaikit/mosaikit`: <https://github.com/mosaikit/mosaikit/releases>. The kit is the
release whose name starts with `kit-v` (for example `kit-v1.0.0-rc3`; a pre-release is a kit that is still being tried). At
the end of its page, open the list **Assets** and download the archive of your system,
`mosaikit-devkit-<version>-<platform>.zip` (Windows) or `.tar.gz` (Linux, macOS), and also `SHA256SUMS` and
`SHA256SUMS.sig`. Check them ([Releasing the kit](releasing.md)) and unpack the archive in a folder of your choice.

**Put `bin/` on your `PATH`.** This is required: the commands `mosaikit-plugin` and `mosaikit-server` are in the `bin/` folder
of the kit, and the system finds them only through `PATH`. Setting only `MOSAIKIT_KIT` does not work: that variable says where
the kit is (the default of `--kit` in `mosaikit-plugin new`), it does not make the commands available. With the kit unpacked in
`C:\Tools\mosaikit-devkit-1.0.0-windows-x86_64`:

- Windows, for the current PowerShell window: `$env:Path = "C:\Tools\mosaikit-devkit-1.0.0-windows-x86_64\bin;" + $env:Path`. For
  every window: Start > "Edit the system environment variables" > Environment Variables > `Path` of your user > New >
  the full path of the `bin` folder; then open a new window.
- Linux and macOS: `export PATH="$HOME/mosaikit-devkit/bin:$PATH"` (put the line in `~/.profile` or `~/.zshrc` to keep it).

Check it in a **new** window: `mosaikit-plugin doctor`. Optional, to skip `--kit` in `mosaikit-plugin new`: set
`MOSAIKIT_KIT` to the folder of the kit (the one that holds `bin/`, `sdk/` and `docs/`). The Windows archive has the server; on Linux and macOS the
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

You choose where to start: a **new** plugin (the commands below), or a **copy of an example** (`--example todo`, `insights` or `note-priority`: complete, commented, with a `WALKTHROUGH.md`; see [An example plugin to read](#an-example-plugin-to-read)). Both make a standalone folder you then change.

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
2. In `src/lib.rs` change what a hook does. The tool rebuilds; reload the page. Example: the hook `before_save` refuses a title shorter than 3 characters; ask for 5. Change the two places that say 3:

   ```rust
   if title.len() < 5 {
       return Err(Error::msg("the title must have at least 5 characters"));
   }
   ```

   Wait for `dev` to print that it rebuilt the logic, reload the page and save an item titled `abc`: the form shows the message and
   saves nothing. `mosaikit-plugin test` still passes (the unit test of the template uses a title of 5 characters).
3. In `ui/src/main.ts` change the `mountCrud` options (`title`, `columns`, `empty`). Example: choose the columns of the table, and
   write your own text for the empty page. In `main.ts`, in the options of `mountCrud`, add the line `columns`:

   ```ts
   return mountCrud(app, msk, 'acme_reports', {
     title: t.title,
     columns: ['title', 'status', 'due'],   // the table shows these fields, in this order
     newLabel: t.newLabel,
     empty: { art: 'generic', title: t.emptyTitle, text: t.emptyText },
   })
   ```

   The texts (`title`, `empty`) are in `ui/src/i18n.ts`, one per language: change `emptyText` (English `'Add the first item to start.'`) to
   `'No report yet: add the first one.'`, and the Italian and Spanish ones the same way. `dev` rebuilds the UI by itself; reload the
   page: the table has three columns and the empty page has your text (an empty list shows it).

## 5. Test, pack, install

```
mosaikit-plugin test                       # strict validation, cargo test, tsc, lint and vitest of the UI
mosaikit-plugin pack                       # dist/<id>-<version>.mskp, signed with your key
mosaikit-plugin install dist/com.example.acme-reports-0.1.0.mskp --server http://localhost:8080 --user admin --password mosaikit-dev   # on the Docker kit, section 6; the file is the one `pack` printed
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
3. **Trust the key in the kit.** In `docker/.env` set `MOSAIKIT_TRUSTED_KEYS=<the public key>` **and** `MOSAIKIT_DEVELOPER_PROFILE_STRICT_SIGNATURES=1`. Without the second line the developer profile accepts a package signed with any key, and the check in step 9 cannot fail. Leave `PLUGIN_DIR` as it is: if it points at your plugin folder the plugin is "in development" again and `install` fails.
4. **Start the kit**, in the `docker/` folder of the kit: `docker compose up -d`. The first start pulls the image; if the pull is refused, see `docker/README.md` (an image archive can be loaded offline). Open `http://localhost:8080`.
5. **Pack with that key**, in the folder of the plugin:
   `mosaikit-plugin pack --key publisher.key`
6. **Install**:
   `mosaikit-plugin install dist/com.example.acme-reports-0.1.0.mskp --server http://localhost:8080 --user admin --password mosaikit-dev` (the name of the file `pack` printed; do not type `<file>`)
   (the Docker kit is a developer profile too: same test users as `dev`).
7. **Turn the plugin on.** After `install` it is only "installed": open `#/admin`, Platform > Plugins > your plugin > **Turn on** (then it is `active` and available to the tenant `dev`). Until then its page does not appear in the shell.
8. **Use it.** Sign in as `alice` or `manager` (tenant `dev`) and create, change and delete an entry.
9. **Check that the key matters.** Pack again with another key that the kit does not trust (`mosaikit-plugin keygen --out other.key`, `pack --key other.key`) and run `install` again: it must be refused with `publisher key not trusted: <key>`. Without this, you have not shown that the kit checks who published a package.

Without a server running, `install` stops with `reaching <address>` and `os error 10061` (connection refused). To start again
from nothing: `docker compose down -v`. The ports, the `.env` and the folder of the plugin are in `docker/README.md`.

## An example plugin to read

Before you write your own, read a finished one. In the kit the three examples are in `examples/`
(`todo`, `insights`, `note-priority`); each has a `WALKTHROUGH.md` that explains the plugin file by file, in order
(about 250 lines). To get a working copy to run and change:

```
mosaikit-plugin new my-todo --kit /path/to/kit --example todo
cd my-todo
mosaikit-plugin dev
```

Start with `todo` (a list with a form, a stored value and a test). `insights` adds KPIs and a view; `note-priority`
extends another plugin ([Extensions and layouts](extensions-layouts.md)).

## A plugin or a product?

| | Plugin | Product (application) |
|---|---|---|
| What it is | One feature that runs inside Mosaikit: logic (WASM), a UI, its own data | Mosaikit with a name, a brand, a choice of plugins and defaults that are yours |
| You make it with | `mosaikit-plugin` | `mosaikit-product` |
| You ship | A signed `.mskp` file that an Administrator installs | A desktop archive and a Docker image that carry your brand and your plugins |
| It changes | What users can do | What users get on first start: name, logo, colours, plugins, settings, first tenant |
| It cannot change | The kernel, the security rules, the plugin API | The kernel, the security rules, the origins, the signature model |
| Start with | This document | [Building an application](building-an-application.md), then [Reference product](reference-product.md) |

A product contains plugins: its own (made with `mosaikit-plugin new <name> --into plugins`) and official ones it
keeps. Make a plugin when you add a feature to an existing Mosaikit; make a product when you want to hand out your own
application. To start a product: `mosaikit-product new acme-maps`.

## Next

- Read the walkthrough of an example (`--example todo`): about 250 lines, in order.
- [Concepts](concepts.md) tells what a plugin may and may not do; [Manifest reference](manifest.md) is every field.
- When something fails: [Troubleshooting](troubleshooting.md).
