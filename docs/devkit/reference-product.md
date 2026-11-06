# Reference product

A small, complete product, made step by step with the tools of the kit: a brand, three official plugins, defaults and a first
start. Each step is a command you can run; the checks of the manual catalog (DK-27 to DK-31) repeat them.

You need the kit (`mosaikit-plugin`, `mosaikit-product`, `mosaikit-server`) and the desktop kit of the base
(a folder or its `.zip`: the desktop zip of the platform release, which the dev kit does not include;
[Building an application](building-an-application.md) says where to get it). With the kit on the PATH, set `MOSAIKIT_BASE` to the desktop kit and `MOSAIKIT_SERVER_BIN`
to its server (`mosaikit-server`) so that the commands below need no extra option.

## 1. Make it

```text
mosaikit-product new acme-maps
cd acme-maps
```

## 2. Say what it is

Open `distribution.toml` and `branding/brand.toml`. Keep three official plugins, leave the roots empty, add defaults and a first tenant:

```toml
[plugins]
roots = []
include = ["com.mosaikit.notes", "com.mosaikit.tasks", "com.mosaikit.contacts"]

[defaults]
"identity.welcome" = "Welcome to Acme Maps"

[locked]
keys = ["identity.name"]

[languages]
enabled = ["en", "it"]
default = "en"

[bootstrap]
tenant = "main"
tenant_name = "Acme Maps"
trial_days = 30

[about]
licence = "Proprietary"
```

## 3. Check it

```text
mosaikit-product validate
```

It checks the brand, the range of the base, and (asking the server of the base) that every default, locked key and first-start entry is
valid. A wrong key stops it with the key named: try `"no.such" = 1` under `[defaults]`.

## 4. Run it

```text
mosaikit-product dev --base <desktop kit>
```

The base starts in the developer profile with your brand and policy; the address and the test users (password `mosaikit-dev`) are printed.
The sign-in page shows *Acme Maps*; the setting *Name* is locked.

## 5. Add a plugin of its own

```text
mosaikit-plugin new parcels --into plugins --id com.acme.parcels
```

Set `roots = ["plugins"]` and add `"com.acme.parcels"` to `include`. `mosaikit-product dev` loads the plugin from its folder and reloads it when
its files change.

## 6. Prove it

```text
mosaikit-product test
mosaikit-product test --upgrade-from <older mosaikit-server>
```

The first starts the product and checks the brand, the About data, every test user and that the plugins are in the tenant. The second runs it on the
older base and then, on the same data, on the current one. A broken product fails: a plugin whose `[requires] mosaikit` does not include the base, a wrong
default, an unsigned package in the registry, `[database] extensions` on SQLite.

For the pages of the plugins in the browser, a Playwright spec with `@mosaikit/plugin-testing` does `signIn`, `openPlugin` and `expectAccessible`
(see [Testing](testing.md)).

## 7. Build it

```text
mosaikit-product build desktop --base <desktop kit>
mosaikit-product build docker --base <desktop kit> --base-image mosaikit:1.0.0 --build
```

The first gives `dist/acme-maps-<version>-desktop`: unzip anywhere and start `acme-maps.exe`. The second gives the image `acme-maps:<version>` and a
`compose.yml` with PostgreSQL; `docker compose up -d` starts it on `:8080`. Sign with your own key (`--key`) before you ship.
