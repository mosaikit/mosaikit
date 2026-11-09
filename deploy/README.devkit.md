# Mosaikit development kit: Docker (PostgreSQL)

The server of Mosaikit in the **developer profile**, with PostgreSQL, to check a plugin against the real
database: its migrations, row level security and the roles the platform creates for it. For the daily loop
use the desktop kit (`mosaikit-plugin dev`, SQLite, no Docker): this one is the check before you pack.

**It is not a deployment.** The developer profile has known passwords and accepts unsigned packages. The
compose file publishes the ports on `127.0.0.1` only. Do not change that, do not put it behind a proxy and do not
point it at a database with real data (the server refuses a database that has tenants besides `dev`).

## Start

```
PLUGIN_DIR=../my-plugin docker compose up -d           # the folder of your plugin (default: ./plugin)
```

The first start pulls the image `MOSAIKIT_DEV_IMAGE:MOSAIKIT_VERSION` of `.env` (the kit points it at the registry where
the release publishes it). If the pull is refused or you are offline, the image is not in the kit: ask whoever gave you
the kit for the image archive (`mosaikit-dev-{{version}}-image.tar`, made with `docker save`), then

```
docker load -i mosaikit-dev-{{version}}-image.tar
```

and set `MOSAIKIT_DEV_IMAGE=mosaikit-dev` in `.env` (that is the name the archive carries).

Open <http://localhost:8080>. Sign in as one of the test users, password `mosaikit-dev`:

| User | Role | Where |
|---|---|---|
| `admin` | Administrator | the "Administrator access" link, `#/admin` |
| `manager` | Tenant Manager | tenant `dev` |
| `alice`, `bob` | User | tenant `dev` |

The banner at the top says the profile is on; **Developer tools** shows the manifest as the server reads it, the
host calls of the plugin with their timings and errors, the permissions of the signed-in user, the switch
between the four users and the reset of the data of the plugin.

To install a signed package (`mosaikit-plugin install file.mskp --server http://localhost:8080 --user admin --password
mosaikit-dev`) leave `PLUGIN_DIR` as it is: the empty `./plugin` only makes the server log a harmless `ERROR`/`WARN`
(`development plugin /plugin ...`) at start. A plugin installed this way is only **installed**: sign in as `admin`
(`#/admin`), Platform > Plugins > the plugin > **Turn on**, and it appears for the tenant `dev`.

## Trust a key

The developer profile accepts unsigned packages and a package signed with **any** key, so a key is not needed here and
`MOSAIKIT_TRUSTED_KEYS` alone changes nothing. To see what a real server does (a package refused with
`publisher key not trusted: <key>`), put the public key that `mosaikit-plugin keygen` prints in `.env`, one or more
separated by commas, **and** turn the check on, then recreate the app:

```
MOSAIKIT_TRUSTED_KEYS=key1,key2
MOSAIKIT_DEVELOPER_PROFILE_STRICT_SIGNATURES=1
docker compose up -d
```

With the check on, an unsigned package is refused (`unsigned package`) and so is one signed with a key that is not in the list.

## The plugin folder

`PLUGIN_DIR` is mounted at `/plugin` and loaded as a plugin in development. Build it on your computer
(`mosaikit-plugin build`): the logic is read from `target/wasm32-unknown-unknown/debug/<crate>.wasm` and the UI from `ui/dist`.
The server reloads the manifest, the migrations, the UI and the logic when the files change. On Windows and macOS
file changes may not reach the container from a normal folder: if a reload does not happen, restart the app
(`docker compose restart app`) or use the desktop kit for the loop.

A migration that changed after it ran is refused; the shell then asks to delete the data of the plugin and run the
migrations again from the first one.

## Settings (`.env`)

| Variable | Default | |
|---|---|---|
| `MOSAIKIT_DEV_IMAGE`, `MOSAIKIT_VERSION` | `mosaikit-dev`, `{{version}}` | the image |
| `MOSAIKIT_HTTP_PORT`, `MOSAIKIT_PLUGIN_PORT` | `8080`, `8081` | ports on the loopback of the host |
| `MOSAIKIT_TRUSTED_KEYS` | empty | public keys of the trusted publishers, separated by commas |
| `MOSAIKIT_DEVELOPER_PROFILE_STRICT_SIGNATURES` | empty | `1`: refuse unsigned packages and keys that are not trusted, as a production server does |
| `PLUGIN_DIR` | `./plugin` | the folder of the plugin |
| `POSTGRES_IMAGE` | `{{postgres_image}}` | PostgreSQL (use a PostGIS image for geographic plugins) |

Start again from nothing: `docker compose down -v`.
