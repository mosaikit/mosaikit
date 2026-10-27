# {{name}} {{version}} with Docker

Installation of {{name}} on a server with **Docker Compose**: the app and its
PostgreSQL database, with persistent volumes.

```
{{id}}-{{version}}-docker/
├── {{id}}-{{version}}-image.tar   image of the app
├── compose.yml                    PostgreSQL + app
├── .env                           image, passwords, addresses and ports
├── initdb/                        first initialization of the database
├── keycloak/                      realm and sign-in theme (profile keycloak)
├── nginx/                         templates and certificates (profile proxy)
└── README.md
```

## Requirements

Docker Engine 24 or later with the Compose plugin (`docker compose`).

## Quick start

One server, no extras: `docker load -i {{id}}-{{version}}-image.tar`, edit the passwords in
`.env`, `docker compose up -d`, open `http://localhost:8080`. The details follow.

## Installation

1. **Image:**

   ```sh
   docker load -i {{id}}-{{version}}-image.tar
   ```

2. **Configuration:** edit `.env`:
   - passwords (`POSTGRES_PASSWORD`, `MOSAIKIT_DB_PASSWORD`,
     `MOSAIKIT_ADMIN_PASSWORD`);
   - public addresses (`MOSAIKIT_URL`, `MOSAIKIT_PLUGIN_URL`);
   - ports published on the host (`MOSAIKIT_HTTP_PORT`, `MOSAIKIT_PLUGIN_PORT`);
   - optional profiles (below) and their variables: see the table.

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

**One origin per plugin (optional, recommended with plugins of third parties).** With a wildcard host
every plugin UI gets a hostname of its own and the plugins cannot reach each other either:

```sh
MOSAIKIT_PLUGIN_URL=https://*.plugins.{{id}}.example.com
```

It needs a wildcard DNS record (`*.plugins.{{id}}.example.com` to the proxy) and a wildcard certificate
for it (e.g. Let's Encrypt with the DNS-01 challenge). The proxy forwards every
`*.plugins.{{id}}.example.com` host to `MOSAIKIT_PLUGIN_PORT` and must keep the `Host` header: Mosaikit
serves the UI of a plugin only on `<plugin>.plugins.{{id}}.example.com` (its id with `-` for `.`, e.g.
`com-mosaikit-notes`) and files and public links only on `public.plugins.{{id}}.example.com`.

## Optional profiles

The base services (`db`, `app`) always start. The others are **compose profiles**, off
unless asked: `docker compose --profile keycloak --profile mail --profile proxy up -d`
(or `COMPOSE_PROFILES=keycloak,mail,proxy` in `.env`).

### Profile `mail`: test mail server (Mailpit)

Catches every email the app sends (invitations, password reset, digests); nothing leaves the
computer. Web inbox: `http://localhost:8025` (`MAILPIT_WEB_PORT`). In the app, System ›
Email: host `mail`, port `1025`, no STARTTLS, no user and password, any sender address
(e.g. `mosaikit@example.test`), then send the test message. For real mail use your own SMTP
server and leave this profile off.

### Profile `keycloak`: identity provider (OIDC)

Keycloak (`KEYCLOAK_IMAGE`) with the realm `mosaikit` imported at the first start from
`keycloak/realm-mosaikit.json`:

- client `mosaikit`: authorization code with PKCE (S256), client secret
  `MOSAIKIT_OIDC_CLIENT_SECRET`, redirect addresses `http://localhost:8080/api/auth/oidc/*` and
  `https://localhost/api/auth/oidc/*` (edit the file for your hosts **before the first start**);
- **no self-registration**; people are created by the Keycloak administrator;
- groups `mosaikit-managers` and `mosaikit-users`, sent in the claim `groups`;
- test users (password `change-me`): `anna.manager` (managers), `bruno.user` (users),
  `carla.noaccess` (no group, refused by the app);
- sign-in page with the Mosaikit look (`keycloak/themes/mosaikit`).

Keycloak console: `http://localhost:8180` (`KEYCLOAK_ADMIN`, `KEYCLOAK_ADMIN_PASSWORD`). The
realm is imported only when it does not exist: to apply a changed file stop Keycloak and
remove the volume `kcdata`.

Settings of a tenant in the app (Tenants › the tenant › Sign-in):

| Field | Value |
| --- | --- |
| Issuer | `http://localhost:8180/realms/mosaikit` |
| Client id | `mosaikit` |
| Client secret | `MOSAIKIT_OIDC_CLIENT_SECRET` (default `mosaikit-dev-secret`) |
| Scopes | `openid profile email` |
| Claims | username `preferred_username`, name `name`, email `email`, groups `groups` |
| Groups | Tenant Managers `mosaikit-managers`, Users `mosaikit-users` |

Use *Check the configuration* before saving. Mosaikit accepts an `http` issuer only on
`localhost`; the service `keycloak-localhost` makes `localhost:8180` reach Keycloak from inside
the app container too. It shares the network of `app`: recreate both together
(`docker compose --profile keycloak up -d --force-recreate app keycloak-localhost`).

`start-dev` (HTTP, embedded database) is for tests. In production run Keycloak with
`start`, your own database, an HTTPS hostname and `KC_HOSTNAME`; the realm file and the
theme work unchanged. Change every test password and the client secret.

### Profile `proxy`: nginx reverse proxy

nginx (`NGINX_IMAGE`) in front of the app and of the plugin origin. Settings come from the
variables `NGINX_APP_HOST`, `NGINX_PLUGIN_HOST`, `NGINX_PLUGINS_WILDCARD`, `NGINX_BASE_PATH`
and fill the templates in `nginx/templates`. Ports `PROXY_HTTP_PORT` (80) and
`PROXY_HTTPS_PORT` (443).

- **Host mode** (default): the app at `http://localhost`, plugins at
  `http://plugins.localhost`; `.env`: `MOSAIKIT_URL=http://localhost`,
  `MOSAIKIT_PLUGIN_URL=http://plugins.localhost`, `MOSAIKIT_TRUST_PROXY=true`.
- **Base path mode**: `NGINX_BASE_PATH=/mosaikit` and `MOSAIKIT_URL=https://gis.example.com/mosaikit`.
  The path reaches the app unchanged.
- **Wildcard plugin host** (optional, one origin per plugin): `NGINX_PLUGINS_WILDCARD=*.plugins.example.com`
  and `MOSAIKIT_PLUGIN_URL=https://*.plugins.example.com`. The proxy keeps the `Host` header.
- **TLS**: put `app.pem`, `app.key`, `plugins.pem`, `plugins.key` in `nginx/certs/` (the plugins
  certificate must be a wildcard one with the wildcard plugin host), copy
  `nginx/templates/20-https.conf.example` to `20-https.conf.template`, make the port 80 servers
  redirect (comment in the file) and recreate the proxy. HSTS is set there.
- Websockets and event streams are forwarded; timeouts are one hour and request bodies are not
  buffered, with up to 2 GB per upload (`client_max_body_size`), for imports, exports and backups.
- Headers sent to the app: `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`,
  `X-Forwarded-Host`. The security headers (CSP, framing) are the app's: the proxy does not add them.

Without the profile the app ports (`MOSAIKIT_HTTP_PORT`, `MOSAIKIT_PLUGIN_PORT`) can also be
put behind your own proxy (see Production).

## Environment variables (`.env`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOSAIKIT_IMAGE`, `MOSAIKIT_VERSION` | from the release | image of the app |
| `POSTGRES_IMAGE` | `postgres:17-alpine` | database image (PostGIS for geographic distributions) |
| `POSTGRES_PASSWORD` | placeholder | superuser of PostgreSQL |
| `MOSAIKIT_DB_PASSWORD` | placeholder | role `mosaikit_app`, used by the app |
| `MOSAIKIT_ADMIN_PASSWORD` | placeholder | first password of `admin` |
| `MOSAIKIT_URL`, `MOSAIKIT_PLUGIN_URL` | `http://localhost:8080`, `:8081` | public addresses |
| `MOSAIKIT_HTTP_PORT`, `MOSAIKIT_PLUGIN_PORT` | `8080`, `8081` | ports on the host |
| `MOSAIKIT_TRUST_PROXY` | `false` | `true` behind a proxy that sets `X-Forwarded-For` |
| `KEYCLOAK_IMAGE`, `KEYCLOAK_URL`, `KEYCLOAK_PORT` | Keycloak 26, `http://localhost:8180`, `8180` | profile `keycloak` |
| `KEYCLOAK_ADMIN`, `KEYCLOAK_ADMIN_PASSWORD` | `admin`, placeholder | Keycloak console |
| `MOSAIKIT_OIDC_CLIENT_SECRET` | `mosaikit-dev-secret` | secret of the client in the realm |
| `SOCAT_IMAGE` | `alpine/socat` | forwarder of the profile `keycloak` |
| `MAILPIT_IMAGE`, `MAILPIT_WEB_PORT` | Mailpit, `8025` | profile `mail` |
| `NGINX_IMAGE`, `PROXY_HTTP_PORT`, `PROXY_HTTPS_PORT` | nginx 1.27, `80`, `443` | profile `proxy` |
| `NGINX_APP_HOST`, `NGINX_PLUGIN_HOST`, `NGINX_PLUGINS_WILDCARD`, `NGINX_BASE_PATH` | `localhost`, `plugins.localhost`, `*.plugins.localhost`, empty | host names of the proxy |

Change every placeholder password before the first start: the database passwords are used
only when the volume `pgdata` is created. Keep `.env` out of version control (`chmod 600`).

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

- Volumes: `pgdata` (database), `appdata` (uploaded files, plugin packages), `pgbackups`
  (dumps of the database, mounted in `db` at `/backups`), `kcdata` (Keycloak, profile `keycloak`).
- **Backup of the database** (custom format, restorable with `pg_restore`):

  ```sh
  docker compose exec db sh -c 'pg_dump -U postgres -Fc mosaikit > /backups/mosaikit-$(date +%F).dump'
  docker compose cp db:/backups ./backups          # copy them out of Docker
  ```

  Restore into an empty database: `docker compose exec -T db pg_restore -U postgres
  --clean --if-exists -d mosaikit < mosaikit-DATE.dump`.
- **Backup of the files**: a copy of the volume `appdata`, e.g.
  `docker run --rm -v <project>_appdata:/data -v "$PWD":/out alpine tar czf /out/appdata.tgz -C /data .`
  System › Backup and restore makes daily backups in
  `appdata/backups` too, complete: the dump of the whole database (the image has the PostgreSQL 17
  client), the files and every tenant (restorable one by one from the app). With a database newer than
  PostgreSQL 17 rebuild the image with `--build-arg PG_CLIENT_MAJOR=<major>`, otherwise the backups say
  "tenants only" with the reason. Keep `appdata/secret.key` apart from the backups.
- **Update**: back up first. `docker load` of the new image, `MOSAIKIT_VERSION` in `.env`, then
  `docker compose up -d` (the migrations apply at start; `docker compose logs app` shows them).
  Rolling back to an older version needs the backup taken before the update. Newer images of
  the other services: `docker compose --profile ... pull`.

For Kubernetes see the folder `{{id}}-{{version}}-k8s` of the same release.
