# Mosaikit with Docker Compose

PostgreSQL 18, Keycloak 26 and Mosaikit, configured to work together.

## Start

```bash
docker compose up -d --build
```

The first start takes a minute: it builds the Mosaikit image from `../mosaikit` and creates the
databases.

| Service | Address | Sign in |
|---|---|---|
| Mosaikit | <http://localhost:8080> | `admin` with `MOSAIKIT_ADMIN_PASSWORD` of `.env` |
| Keycloak | <http://localhost:8180> | `admin` with `KEYCLOAK_ADMIN_PASSWORD` of `.env` |

Change the passwords in `.env` before the first start: they are used only when the databases and
the administrators are created.

A rebuild of the project refreshes the other files of this folder but keeps `.env` and the packages
in `extensions/`, so the folder can stay in use (even with the stack running) across builds.

## Everyday use

| To | Run |
|---|---|
| see the logs | `docker compose logs -f mosaikit` |
| install an extension | copy its package (`<name>.zip`, for example from `../extensions`) into `extensions/`, then `docker compose restart mosaikit` |
| stop | `docker compose down` (the data stay in the `mosaikit_postgres-data` volume) |
| delete everything, data included | `docker compose down -v` |
| back up the data | `docker compose exec postgres pg_dumpall -U mosaikit > backup.sql`, and the files of extensions in the `mosaikit_mosaikit-files` volume |

## Organizations that sign in with Keycloak

Mosaikit creates the Keycloak realm of an organization when the organization is created with
`federation` (MK-018), with the service account `mosaikit-admin` configured here. For example,
from PowerShell:

```powershell
$admin = @{ Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('admin:<MOSAIKIT_ADMIN_PASSWORD>')) }
Invoke-RestMethod -Method Post http://localhost:8080/api/v1/organizations -Headers $admin -ContentType 'application/json' -Body '{"slug":"acme","name":"Acme","federation":{"emailDomains":["acme.test"],"administrator":{"email":"ada@acme.test","firstName":"Ada","lastName":"Lovelace"}}}'
```

The answer contains `initialAdministrator` with a temporary password, shown only this once. Then
open <http://localhost:8080>, enter `ada@acme.test`: Mosaikit sends you to the realm `acme`,
where you set a new password. The identity providers of the organization (Microsoft Entra ID,
Google, SAML, LDAP) are connected to its realm in the Keycloak console.

## Files on an S3-compatible store

The files of extensions are kept in the `mosaikit-files` volume. To keep them in a bucket of an
S3-compatible store instead (MinIO, Ceph, Garage, Amazon S3), create the bucket and add to the
`environment` of `mosaikit`:

```yaml
      MOSAIKIT_FILES_STORE: s3
      MOSAIKIT_FILES_S3_ENDPOINT: https://s3.example.org
      MOSAIKIT_FILES_S3_BUCKET: mosaikit-files
      MOSAIKIT_FILES_S3_PATH_STYLE: 'true'
      MOSAIKIT_FILES_S3_ACCESS_KEY_ID: mosaikit
      MOSAIKIT_FILES_S3_SECRET_ACCESS_KEY: ${FILES_S3_SECRET:?set it in .env}
```

See the administration guide for the choice of the store.

## Settings of the kernel and of extensions

`compose.yaml` names the settings that make the services work together. Every other setting of the
kernel ([configuration](../../docs/guide/configuration.md)) and of the installed extensions goes in
`mosaikit.env`, next to `compose.yaml`, without changing it: copy `mosaikit.env.example` to
`mosaikit.env`, write one `VARIABLE=value` per line, and run `docker compose up -d mosaikit`. The
name of the variable is the setting in upper case with every character that is not a letter or a
digit replaced by `_`. For example, an extension whose documentation names the setting
`example.reports.endpoint`:

```ini
EXAMPLE_REPORTS_ENDPOINT=https://reports.example.org
```

A rebuild of the project keeps `mosaikit.env`. Keep it out of version control and readable only by
the account that runs Docker (`chmod 600 mosaikit.env`), since it may hold passwords.

Secret settings can instead stay in a file of their own, mounted as a secret of Compose, in the
format of `application.properties`. Create `compose.override.yaml` next to `compose.yaml`, which
Docker Compose reads with it:

```yaml
services:
  mosaikit:
    environment:
      QUARKUS_CONFIG_LOCATIONS: file:///run/secrets/mosaikit-settings
    secrets:
      - mosaikit-settings
secrets:
  mosaikit-settings:
    file: ./secret-settings.properties
```

and write the settings in `secret-settings.properties`, for example `example.reports.api-key=<key>`.
Variables of `mosaikit.env` and of `compose.yaml` win over the file.

## Production

This setup is for development, demonstrations and small installations on one machine. For
production put a reverse proxy with HTTPS in front of both services, run Keycloak with `start`
instead of `start-dev` (see the Keycloak documentation), keep `.env` out of version control and
back up the volume. On Kubernetes use `../mosaikit-k8s`.
