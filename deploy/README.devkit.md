# Mosaikit development kit: Docker (PostgreSQL)

The server of Mosaikit in the **developer profile**, with PostgreSQL, to check a plugin against the real
database: its migrations, row level security and the roles the platform creates for it. For the daily loop
use the desktop kit (`mosaikit-plugin dev`, SQLite, no Docker): this one is the check before you pack.

**It is not a deployment.** The developer profile has known passwords and accepts unsigned packages. The
compose file publishes the ports on `127.0.0.1` only. Do not change that, do not put it behind a proxy and do not
point it at a database with real data (the server refuses a database that has tenants besides `dev`).

## Start

```
docker load -i mosaikit-dev-{{version}}-image.tar      # only if the image is not in your Docker yet
PLUGIN_DIR=../my-plugin docker compose up -d           # the folder of your plugin (default: ./plugin)
```

Open <http://localhost:8080>. Sign in as one of the test users, password `mosaikit-dev`:

| User | Role | Where |
|---|---|---|
| `admin` | Administrator | the "Administrator access" link, `#/admin` |
| `manager` | Tenant Manager | tenant `dev` |
| `alice`, `bob` | User | tenant `dev` |

The banner at the top says the profile is on; **Developer tools** shows the manifest as the server reads it, the
host calls of the plugin with their timings and errors, the permissions of the signed-in user, the switch
between the four users and the reset of the data of the plugin.

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
| `PLUGIN_DIR` | `./plugin` | the folder of the plugin |
| `POSTGRES_IMAGE` | `{{postgres_image}}` | PostgreSQL (use a PostGIS image for geographic plugins) |

Start again from nothing: `docker compose down -v`.
