# {name} — Docker release

This folder is the Docker release of **{name}** {version}, built with `mosaikit-product build docker`. It runs the
product, a PostgreSQL database{keycloak_services} on one computer with `docker compose`.

## Start it

```text
docker compose up -d          # start (the image {image} must exist: build it with --build, or docker load)
docker compose ps             # the state of the services
docker compose logs -f app    # the log of the product
docker compose down           # stop; the data stays in the volumes
```

Open **http://localhost:8080** in the browser. Use exactly this address, not `127.0.0.1` and not the name of the
computer: the sign-in through an identity provider goes back to the address in `MOSAIKIT_URL`, and from another
address it ends with *The sign-in has expired, or it was started in another browser or at another address*. To use
another address, set `MOSAIKIT_URL` (and `MOSAIKIT_PLUGIN_URL`) in a `.env` file next to `compose.yml`.

## What is in the folder

| File | What it is |
|---|---|
| `compose.yml` | the services: `db` (PostgreSQL, never published on the host), `app` (the product, ports 8080 and 8081){keycloak_compose_rows} |
| `Dockerfile` | the image of the product on the Mosaikit base image |
| `distribution.toml` | the product: name, defaults, locked settings, first start{keycloak_bootstrap_note} |
| `mosaikit.toml` | the configuration of the server |
| `branding/` | the brand: name, logo, favicon, colours, texts |
| `registry/` | the plugins of the product (signed packages) |
| `initdb/` | the first initialization of the database |
{keycloak_folder_row}
## Credentials of a new installation

These are the defaults of `compose.yml`: **demonstration values, change them before anyone else uses the product**.

| What | Where | User | Password |
|---|---|---|---|
| Administrator | http://localhost:8080/#/admin (*Administrator access*) | `admin` | `change-me-now` (`MOSAIKIT_ADMIN_PASSWORD`) |
{keycloak_credential_rows}| PostgreSQL | not published; used by the app | `postgres`, `mosaikit_app` | `change-this-password`, `change-this-too` (`POSTGRES_PASSWORD`, `MOSAIKIT_DB_PASSWORD`) |

To change them, create a `.env` file next to `compose.yml` **before the first start**:

```text
MOSAIKIT_ADMIN_PASSWORD=...
POSTGRES_PASSWORD=...
MOSAIKIT_DB_PASSWORD=...
```

The password of the Administrator is read at the first start only. Change it afterwards from the Account page.

## The first sign-in of the Administrator

At the first sign-in the Administrator registers a **second factor**: scan the QR code with an authenticator app
(Microsoft Authenticator, Google Authenticator, a password manager...), type the code, and save the **ten recovery
codes** you receive. Each recovery code works once.

**If you lose the codes or the phone** and no recovery code is left, reset the second factor from the folder of the
release; at the next sign-in a new QR code and new recovery codes are made:

```text
docker compose exec app /app/mosaikit-server reset-totp --user admin
```

**If you lose the password:**

```text
docker compose exec -it app /app/mosaikit-server reset-password --user admin
```

{keycloak_section}## Data, backup and update

- The data is in two Docker volumes (`pgdata`, `appdata`{keycloak_volume}). `docker compose down` keeps them;
  `docker compose down -v` **deletes them**.
- Backup: the Administrator makes backups from System > Backups, and `docker compose exec db pg_dump -U postgres mosaikit`
  dumps the database.
- Update to a new Mosaikit: build the release again with the new Dev Kit (`mosaikit-product build docker --build`, the
  Base is the version of the Dev Kit), then `docker compose up -d` **in the same folder** so the volumes stay. Back up
  first. The log of the app says which version it runs: `docker compose logs app | grep "on Mosaikit"`.

## Before you put it in production

Change every password and the client secret, put the product behind HTTPS with its real address in `MOSAIKIT_URL`,
and remove what is only a demonstration{keycloak_remove}. The Administrator pages of the product, the sections *Backups*
and *Maintenance*, and the installation guide of Mosaikit say how.

## Where to read more

- The Dev Kit documents (`docs/` of the Dev Kit): `devkit/building-an-application.md` (this release, brand,
  defaults, first start, upgrades), `devkit/getting-started.md`, `devkit/troubleshooting.md` (an error, its cause and
  its fix).
- The manuals of the release, attached to it on GitHub: the **User manual** (the Administrator, the Tenant Manager and
  the User), the **Installation guide** and the **Developer guide**: https://github.com/mosaikit/mosaikit/releases
- Questions and problems: https://github.com/mosaikit/mosaikit/issues
