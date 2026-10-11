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
in `plugins/`, so the folder can stay in use (even with the stack running) across builds.

## Everyday use

| To | Run |
|---|---|
| see the logs | `docker compose logs -f mosaikit` |
| install a plugin | copy its package (`<name>.zip`, for example from `../plugins`) into `plugins/`, then `docker compose restart mosaikit` |
| stop | `docker compose down` (the data stay in the `mosaikit_postgres-data` volume) |
| delete everything, data included | `docker compose down -v` |
| back up the data | `docker compose exec postgres pg_dumpall -U mosaikit > backup.sql` |

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

## Production

This setup is for development, demonstrations and small installations on one machine. For
production put a reverse proxy with HTTPS in front of both services, run Keycloak with `start`
instead of `start-dev` (see the Keycloak documentation), keep `.env` out of version control and
back up the volume. On Kubernetes use `../mosaikit-k8s`.
