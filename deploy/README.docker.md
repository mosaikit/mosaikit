# {{name}} {{version}} with Docker

Installation of {{name}} on a server with **Docker Compose**: the app and its
PostgreSQL database, with persistent volumes.

```
{{id}}-{{version}}-docker/
├── {{id}}-{{version}}-image.tar   image of the app
├── compose.yml                    PostgreSQL + app
├── .env                           image, passwords, addresses and ports
├── initdb/                        first initialization of the database
└── README.md
```

## Requirements

Docker Engine 24 or later with the Compose plugin (`docker compose`).

## Installation

1. **Image:**

   ```sh
   docker load -i {{id}}-{{version}}-image.tar
   ```

2. **Configuration:** edit `.env`:
   - passwords (`POSTGRES_PASSWORD`, `MOSAIKIT_DB_PASSWORD`,
     `MOSAIKIT_ADMIN_PASSWORD`);
   - public addresses (`MOSAIKIT_URL`, `MOSAIKIT_PLUGIN_URL`);
   - ports published on the host (`MOSAIKIT_HTTP_PORT`, `MOSAIKIT_PLUGIN_PORT`).

   The database uses the image `{{postgres_image}}`, downloaded from Docker Hub at
   the first start.

3. **Start:**

   ```sh
   docker compose up -d
   docker compose ps                 # wait until "app" is healthy
   ```

   At the first start the app applies the database migrations and installs the included
   plugins. Sign-in: `MOSAIKIT_URL` + `#/admin` (*Administrator access*), user `admin`, password
   `MOSAIKIT_ADMIN_PASSWORD`; change it at once from the Account page. At the first
   sign-in you register the second factor (authenticator app, QR code) and receive
   the recovery codes. Lost phone: `docker compose exec app
   /app/mosaikit-server reset-totp --user admin`.

## Production

Put an HTTPS reverse proxy in front, with **two hostnames**: one for the app (port
`MOSAIKIT_HTTP_PORT`) and one for plugins, uploaded files and public links (port
`MOSAIKIT_PLUGIN_PORT`). The two origins must be different: the code of the
plugins must not be able to read the cookies of the app. Then in `.env`:

```sh
MOSAIKIT_URL=https://{{id}}.example.com             # with a base path too: .../{{id}}
MOSAIKIT_PLUGIN_URL=https://plugins.{{id}}.example.com
MOSAIKIT_TRUST_PROXY=true                           # the proxy sets X-Forwarded-For
```

With `https://` the session cookie becomes `Secure`.

## Configuration

Every property of `mosaikit.toml` is set with the matching `MOSAIKIT_*` variable
in the `environment` section of the app in `compose.yml`; the full list,
with descriptions, is in `mosaikit.example.toml` in the image
(`/app/mosaikit.example.toml`).

Administration commands:

```sh
docker compose exec app /app/mosaikit-server config
docker compose exec -it app /app/mosaikit-server reset-password --user admin
```

## Data, backup, update

- Volumes: `pgdata` (database) and `appdata` (uploaded files, plugin packages).
- Backup: `docker compose exec db pg_dump -U postgres mosaikit > backup.sql` and
  a copy of the `appdata` volume.
- Update: `docker load` of the new image, `MOSAIKIT_VERSION` in
  `.env`, then `docker compose up -d` (the migrations apply at start).

For Kubernetes see the folder `{{id}}-{{version}}-k8s` of the same release.
