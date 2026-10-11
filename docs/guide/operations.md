# Operations

## Health and information

| Endpoint | Answer |
|---|---|
| `/q/health/ready` | `200` when the kernel can serve requests (database reachable) |
| `/q/health/live` | `200` while the process is alive |
| `/api/v1/system/info` | product, kernel version and number of active plugins, without authentication |
| `/q/openapi` | OpenAPI document of the API |

Use the first two as readiness and liveness probes (the Helm chart does).

## Logs

The kernel logs to the standard output: the launcher scripts show it in the console, Docker and
Kubernetes collect it. At start it logs the plugins found and, for each one that is not active,
the reason. The portable distribution also writes `data/postgresql.log` and
`data/postgresql-tools.log`.

An audit log of security events is not available yet
([NC-16](../compliance/non-conformities.md#nc-16-no-audit-log)).

## Backup and restore

| Distribution | Back up | Restore |
|---|---|---|
| Portable | stop Mosaikit, copy `data/` (and `plugins/`, `config/`) | unpack the same version, copy them back, start |
| Installation, Docker, Kubernetes | the PostgreSQL database (`pg_dump` of the database, or the backup of the database service), `plugins/` and `config/` | restore the database, the same plugins and configuration, start the same version |

Keycloak has its own database: back it up with it. Test the restore regularly on a copy; a
scheduled restore test is still to be provided
([NC-20](../compliance/non-conformities.md#nc-20-no-backup-and-tested-restore-for-server-deployments)).

## Upgrades

1. Read the release notes (`CHANGELOG.md`): they say when a plugin or a setting must change.
2. Back up.
3. Replace the kernel: unpack the new version next to the old one and move `config/`,
   `plugins/` and, for the portable distribution, `data/` into it; or change the image tag.
4. Start. The database migrations of the kernel and of the plugins run by themselves; they only
   go forward, so going back means restoring the backup.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| A plugin is missing from the launcher | `GET /api/v1/plugins`: its status and `problems` say why |
| `RESTART_REQUIRED` | the kernel was started without its launcher script, or a JAR changed while it ran |
| "Refused package" | the package was changed after signing, or signatures are required and the publisher is not trusted |
| Sign-in through Keycloak fails with a `503` | the kernel cannot reach Keycloak at `mosaikit.identity.keycloak-internal-url` or `keycloak-url` |
| The portable distribution does not start: "Port 54329 … in use" | another program uses the port: set `MOSAIKIT_DATABASE_PORT` |
| Windows: "Unable to delete directory" while building | a program keeps the folder open (a running compose, a terminal, Explorer) |
