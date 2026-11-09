# Reference product

A small, complete product, made step by step with the tools of the kit: a brand, three official plugins, defaults and a first
start. Each step is a command you can run; the checks of the manual catalog (DK-27 to DK-31) repeat them.

You need the Dev Kit (`mosaikit-plugin`, `mosaikit-product`, `mosaikit-server`) and Docker: nothing else to download. The Base (Mosaikit compiled, with the
official plugins) comes by itself when you give `--base` a version; [Building an application](building-an-application.md) says where it is kept.
With the kit on the PATH, set `MOSAIKIT_BASE` to the version of the Base (for example `1.0.2`) and `MOSAIKIT_SERVER_BIN`
to the server of the kit (`mosaikit-server`) so that the commands below need no extra option.

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

### Give it a face

The brand is the folder `branding/`: put the files in it and name them in `branding/brand.toml`. Every property is optional.

```toml
name = "Acme Maps"                    # the name in the sign-in page, the title of the tab and the shell
tagline = "Maps for the field team"   # under the name on the sign-in page
login_message = "Sign in with the account your administrator gave you."
footer = "Acme Srl"
support_url = "https://acme.example/support"
logo = "logo.svg"                     # svg, png or webp, about 64 px high
favicon = "favicon.svg"               # the icon of the browser tab
icon = "icon.ico"                     # a real .ico (16 to 256 px): the desktop executable and the notification area

[colors]
accent = "#0b6e4f"                    # buttons, links, focus
bg = "#f6f8f7"                        # page
panel = "#ffffff"                     # cards
fg = "#16231e"                        # text
```

- **Logo, favicon, icon**: copy the files into `branding/` next to `brand.toml`; the names are relative to it. The `.ico` must be a
  real icon file, not a renamed PNG; the kit does not make one.
- **Colours**: `#rrggbb` only. The names are `accent`, `bg`, `panel`, `panel2`, `line`, `fg`, `dim`, `ok` and `err`; any other name is refused.
  The plugins receive the same colours.
- **Texts**: the strings of the sign-in page and the welcome text. Languages are chosen in `[languages]` above; a product default such as
  `"identity.welcome"` goes under `[defaults]`.
- **Locked**: `[locked] keys = ["identity.name"]` stops the Administrator and the tenants from changing the name from Settings; leave a key out and they can
  change it (and the logos and the theme).
- **Check**: `mosaikit-product validate` tells whether the files exist and the colours are valid; `mosaikit-product dev` shows the result,
  and `mosaikit-product test --browser` looks at the sign-in page and the shell with your brand. [Building an application](building-an-application.md) (section 4)
  has the full list.

## 3. Check it

```text
mosaikit-product validate
```

It checks the brand, the range of the base, and (asking the server of the base) that every default, locked key and first-start entry is
valid. A wrong key stops it with the key named: try `"no.such" = 1` under `[defaults]`.

## 4. Run it

```text
mosaikit-product dev --base 1.0.2
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
mosaikit-product build desktop --base 1.0.2
mosaikit-product build docker --base 1.0.2 --build
```

The first gives `dist/acme-maps-<version>-desktop`: unzip anywhere and start `acme-maps.exe`. The second gives the image `acme-maps:<version>` and a
`compose.yml` with PostgreSQL; `docker compose up -d` starts it on `:8080`. Sign with your own key (`--key`) before you ship.
