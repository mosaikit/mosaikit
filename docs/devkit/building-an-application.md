# Building an application on Mosaikit

An **application** (a *product*, in the code a *distribution*) is Mosaikit with a name, a brand, a choice of plugins
and a way of starting that are yours. You build it from the **compiled** Mosaikit (the desktop kit and the Docker
image): no source of Mosaikit, no fork, no compilation of the kernel. The tool is `mosaikit-product`.

A worked example, step by step, is in [Reference product](reference-product.md). The terms of redistribution are in
[Licensing and responsibilities](product-licensing.md). The contract between the base and a product is in
[../reports/distribution-audit.md](../reports/distribution-audit.md).

## 1. What a product is

| The base gives (never changes) | A product adds |
|---|---|
| Tenants, users, the three roles, resources, sharing, public links, KPIs, search, notifications | A name, a version and an executable name |
| The security rules: CSP of the contents and of the plugins, the sandbox of the logic, row level security, the SQL guard | A brand: logo, icon, colours, texts of the sign-in page |
| The origins model (app origin and plugin origin) and the signature model of the packages | The plugins of the release: its own and the official ones it keeps |
| The plugin API 1 and its compatibility rules | Defaults and locked settings, languages, the first start, required database extensions |
| The desktop and Docker packaging, the migrations of the base | Seeds (plugin settings, platform keys), navigation groups, sidecars |

**What a product cannot change:** the kernel, the security rules, the origins, the signature model, the plugin API,
the format of the data. Everything it may change is listed in the audit report and is set in `distribution.toml`.

## 2. The product folder

```text
acme-maps/
  distribution.toml      the product: identity, plugins, defaults, first start, extensions
  branding/              brand.toml, logo, favicon, icon
  plugins/               its own plugins, one standalone folder each (mosaikit-plugin new <name> --into plugins)
  shared/                code several of its plugins use (a Rust crate, an npm package), by path
  tests/                 its own tests
  .github/workflows/     CI
  README.md  .gitignore
```

`mosaikit-product new acme-maps` makes it. `mosaikit-product validate` checks it; `mosaikit-product dev` starts it.

## 3. `distribution.toml`

```toml
[product]
id = "acme-maps"            # file names and Docker image: lower case, digits, '-'
name = "Acme Maps"          # shown to users
version = "1.2.0"           # your version, not the one of Mosaikit
base = ">=1.0, <2"          # the versions of the base this release works with
executable = "acme-maps"    # the desktop executable

[brand]
dir = "branding"

[plugins]
roots = ["plugins"]                                         # folders with your plugins
include = ["com.acme.parcels", "com.mosaikit.notes"]        # yours and the official ones you keep ("*" = every plugin of the roots)

[desktop]
database = "sqlite"         # or "postgres" (embedded)
port = 48080

[docker]
image = "acme-maps"
postgres_image = "postgis/postgis:17-3.5-alpine"
```

## 4. Brand and identity

`branding/brand.toml`: `name`, `tagline`, `login_message`, `footer`, `support_url`, `logo` (svg, png or webp, about 64 px
high), `favicon`, `icon` (a `.ico` of 16–256 px, for the desktop executable and the notification area) and `[colors]` (`#rrggbb`
only; the transparent variants of the accent are computed). The plugin UIs receive the same colours. `validate` checks that
the files exist and that the colours are `#rrggbb`.

On the **desktop**, the name, version and icon of the executable are written with
[`rcedit`](https://github.com/electron/rcedit) when it is on the PATH (Windows); without it the build says so and leaves the
executable as it is. The Administrator and each tenant can still change name, logos and theme from Settings, unless you lock
them (section 6).

The **About** data (`[about]`: licence and a text, plus the product, its version and the base it runs on) are written to the
log at start and returned by `GET /api/brand` as `about`.

## 5. Choosing and writing plugins

- **Official plugins** are listed by id in `include`; they are copied, with their own signature, from the registry of the base.
  An id the base does not have is an error. You never fork one: if you need another behaviour write an *extension* plugin
  ([Extensions and layouts](extensions-layouts.md)).
- **Your plugins** live in `roots`. Each is a standalone project made with `mosaikit-plugin new` and checked with
  `mosaikit-plugin test` ([Testing](testing.md)); `mosaikit-product validate` runs the strict checks of all of them. A release signs
  them with the key of the product.
- **Shared code** goes in `shared/` and each plugin refers to it by path, so the plugins stay standalone.
- A plugin states `[requires] mosaikit = ">=1.0, <2"`; `validate` refuses a plugin whose range does not include the base.

## 6. Settings, languages and first start

All of these are tables of `distribution.toml`, read by the base at start; the base refuses to start with a wrong entry and
names the key.

```toml
[defaults]                       # values of the settings of the platform in place of the built-in ones
"identity.welcome" = "Welcome to Acme Maps"
"security.password_min" = 12

[locked]                         # settings nobody can change: the Administrator and the tenants see them locked
keys = ["identity.name", "theme"]

[languages]                      # sugar for lang.enabled and lang.default
enabled = ["en", "it"]
default = "en"

[bootstrap]                      # first start (the environment variables MOSAIKIT_INITIAL_TENANT, ... win)
tenant = "main"                  # slug of the first tenant
tenant_name = "Acme Maps"
trial_days = 30                  # optional trial of that tenant
admin_email = "ops@acme.example"
```

The keys of `[defaults]` and `[locked]` are the settings of the platform (identity, theme, languages and formats, passwords and
sessions, notifications, retention, layout). A value a setting refuses is an error at start. A locked setting ignores what is stored
and keeps the default of the product. In the developer profile (`mosaikit-product dev`) the first tenant of `[bootstrap]` is not
created: the profile brings its own tenant and users.

**Seeds** (`[[plugin_settings]]`, `[[service_key_values]]`) put the settings and keys of plugins in place at the first start,
by reference (`env:NAME`, `file:PATH`): never write a secret in the file ([architecture §14.2](../architecture.md)).
**Seed data** of a plugin (an idempotent command run once) is a `kind = "oneshot"` sidecar ([architecture §14.0](../architecture.md)).

## 7. Data and extensions

- **Desktop**: SQLite (a file `data/mosaikit.db`) or embedded PostgreSQL (`[desktop] database = "postgres"`).
- **Docker and Kubernetes**: PostgreSQL. A PostGIS image: `[docker] postgres_image`.
- **Required extensions**: `[database] extensions = ["postgis"]`. At start, on PostgreSQL, the base checks that they are installed and
  stops with a message that names them and says how to install them. SQLite has no extensions: `build desktop` refuses a product that
  asks for them without `[desktop] database = "postgres"`.
- **Migrations**: those of the base and of the plugins run at start, as for any installation ([Data](data.md)).
- **Backup and restore**: a desktop product copies the `data/` folder with the program stopped; Docker uses the scheduled backups of the
  Administrator (System › Backup and restore) and the volumes ([deploy/README.docker.md](../../deploy/README.docker.md)).

## 8. Build and release

```text
mosaikit-product build desktop --base <desktop kit folder or .zip>      dist/<id>-<version>-desktop
mosaikit-product build docker  --base <desktop kit> --base-image mosaikit:1.0.0 [--build]   dist/<id>-<version>-docker
mosaikit-product build k8s     --base-k8s <k8s folder of the kit>       dist/<id>-<version>-k8s
```

- **Desktop**: the executable of the base renamed, `registry/` (your signed packages and the official ones you keep), `branding/`,
  `distribution.toml`, `mosaikit.toml` (written, commented) and `START.txt`. The configuration trusts the key of the product and,
  if you keep official plugins, the official key.
- **Docker**: a `Dockerfile` `FROM` the base image that adds the registry, the brand and the configuration, and a `compose.yml` with
  the database (`--build` runs `docker build`).
- **Kubernetes**: a kustomize overlay over the base kit that sets the image.
- **Signing**: `--key`, `MOSAIKIT_SIGNING_KEY` or `MOSAIKIT_SIGNING_KEY_FILE`; without one a development key is made and used
  (never ship with it). A release never carries an unsigned plugin: the build verifies every package against the keys it will trust.
- **Checksums**: publish a `SHA256SUMS` of the archives you ship ([Releasing the kit](releasing.md) shows the way).

## 9. Upgrades

- Your release states the range of the base it works with (`[product] base`). A base outside the range does not start the product, and says why.
- To move a product to a new base: read the changelog of the kit ([Changelog and compatibility](changelog.md)), set the new range, run
  `mosaikit-product test --server <new base> --upgrade-from <old base>` (the product runs on the old base and then, on the same data, on the
  new one), build, ship.
- The plugin API changes only with a new major version or in an additive way; deprecated keys are kept for one major version.
- At every security patch of the base you rebuild and ship within the term of [Licensing and responsibilities](product-licensing.md).

## 10. Testing a product

`mosaikit-product test` validates the product (the strict checks of every own plugin, the brand, the policy by the base), starts it on the base in the
developer profile and checks over HTTP that it answers, has its brand and its About data, that every test user signs in and that the Tenant Manager
sees every own plugin of the release; with `--upgrade-from` it runs the upgrade test. The pages of the plugins and the accessibility are checked in the
browser with `@mosaikit/plugin-testing` (`signIn`, `openPlugin`, `expectAccessible`: [Testing](testing.md)); the reference product has a spec that does it.

## 11. Operations

Monitoring, maintenance mode, backups and the log are the ones of the platform: [architecture §10 and §11](../architecture.md). When you ask for support
collect: the version of the product and of the base (the About data), `data/logs/mosaikit.log` (desktop) or `docker compose logs app`, and the output of
`mosaikit-server config` (no secrets).
