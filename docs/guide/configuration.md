# Configuration

Settings are read from `config/application.properties` of the installation, and from environment
variables, which win. The name of a variable is the setting in upper case with every `.` and `-`
replaced by `_`: `mosaikit.identity.keycloak-url` is `MOSAIKIT_IDENTITY_KEYCLOAK_URL`.

## Database

| Setting | Default | Meaning |
|---|---|---|
| `quarkus.datasource.jdbc.url` | | PostgreSQL 18 database, for example `jdbc:postgresql://db:5432/mosaikit`; add `?sslmode=verify-full` to require TLS |
| `quarkus.datasource.username` | | database user |
| `quarkus.datasource.password` | | database password |

The portable distribution sets them itself (in `config/database.properties`, written at each
start). The kernel keeps its tables in the `mk_kernel` schema and each extension in its own schema.

## First administrator

| Setting | Default | Meaning |
|---|---|---|
| `mosaikit.bootstrap.admin-username` | `admin` | name of the platform administrator created on an empty database |
| `mosaikit.bootstrap.admin-password` | | its password, used only when the database is empty; remove it afterwards |

## HTTP

| Setting | Default | Meaning |
|---|---|---|
| `quarkus.http.port` | `8080` | port |
| `quarkus.http.host` | `0.0.0.0` | address to listen on |
| `mosaikit.accounts.session-timeout` | `8h` | how long a session of the shell opened with a password lasts without activity (at least one minute) |
| `mosaikit.accounts.session-max-life` | `24h` | how long a session lasts at most, whatever its activity; "remember me" then opens a new one. The record of an ended realm session is kept at least this long |
| `mosaikit.accounts.session-cache` | `5s` | how long a kernel keeps what it read about a session; a session ended on another kernel of the installation is refused within this time, on the same kernel at once; `0s` reads the database at every request. The same time applies to personal access keys (MK-060) |
| `mosaikit.accounts.access-key-max-validity` | `365d` | how long a personal access key lasts at most from its creation (MK-060): people choose a shorter expiry, and a key created without one lasts this long |

Sessions are kept in the database (MK-125): the cookie holds only a random value, so no key needs
to be configured, sessions survive a restart, and every kernel of a cluster accepts them. Expired
sessions are removed every 15 minutes.

Terminate TLS at a reverse proxy or an ingress; in production the kernel sends
`Strict-Transport-Security` and a `Content-Security-Policy`.

## Identity

| Setting | Default | Meaning |
|---|---|---|
| `mosaikit.identity.keycloak-url` | | public URL of Keycloak, as browsers reach it and as it appears in the tokens |
| `mosaikit.identity.keycloak-internal-url` | | URL at which the kernel reaches Keycloak, when it differs (containers) |
| `mosaikit.identity.admin.client-id` | | service account of the `master` realm (role `admin`) with which the kernel creates realms |
| `mosaikit.identity.admin.client-secret` | | its secret |
| `mosaikit.identity.client-id` | `mosaikit` | client of the kernel UI in each realm |
| `mosaikit.identity.domain` | | domain whose sub-domains are organization slugs (`acme.mosaikit.example.org`) |
| `mosaikit.identity.cache-ttl` | `30s` | how long the identity settings of organizations are cached |

## Database

| Setting | Default | Meaning |
|---|---|---|
| `mosaikit.database.row-security` | `true` | requests run as the member role of the installation, so that the row-level security policies of extensions apply (MK-019); the database user needs `CREATEROLE` once |
| `mosaikit.database.published-views.login` | | a login the kernel creates at start for external services, which reads the [published views](../development/published-views.md) and nothing else (MK-123); an existing role is used only when the kernel created it |
| `mosaikit.database.published-views.password` | | its password, required with the login; set it from a secret (`MOSAIKIT_DATABASE_PUBLISHED_VIEWS_PASSWORD`). The kernel sends it to PostgreSQL already hashed (SCRAM-SHA-256) and never logs it; changing it changes the password of the login at the next start |

## Audit log

| Setting | Default | Meaning |
|---|---|---|
| `mosaikit.audit.min-retention` | `365d` | the shortest retention of the audit log, rounded up to whole days: organizations and the platform may keep their entries longer, never less, and no entry younger is ever deleted (MK-059) |
| `mosaikit.audit.retention-check` | `6h` | how often each kernel deletes the entries older than their retention |

## Credentials of extensions

The store of credentials (MK-062) encrypts each value under a data key of its own, and each data key
under a master key that never goes in the database. Without a valid master key the store is
disabled: the kernel starts, logs why, and the endpoints of credentials answer 503. See
[administration](administration.md#credentials-of-extensions) for how to generate and rotate the key.

| Setting | Default | Meaning |
|---|---|---|
| `mosaikit.secrets.master-key` | | the current master key, 32 random bytes in base64 (`openssl rand -base64 32`); prefer the environment variable `MOSAIKIT_SECRETS_MASTER_KEY` or a file to a file of settings |
| `mosaikit.secrets.master-key-file` | | a file that holds the current master key in base64, such as a mounted secret of Kubernetes or Docker; set this or `master-key`, not both |
| `mosaikit.secrets.previous-keys` | | former master keys in base64, separated by commas, kept during a rotation: credentials not yet encrypted again still decrypt, and new writes use the current key |


| Setting | Default | Meaning |
|---|---|---|
| `mosaikit.extensions.directory` | `extensions` | directory of the installed extensions |
| `mosaikit.extensions.trusted-keys-directory` | `config/trusted-keys` | public keys of trusted publishers |
| `mosaikit.extensions.signatures` | `optional` | `required`: only packages signed with a trusted key are accepted |
| `mosaikit.extensions.unverified-frontends` | `iframe` | `iframe` runs the frontends of unverified publishers in a sandboxed iframe; `module` loads them like the others |
| `mosaikit.extensions.watch` | `false` (`true` in development mode) | read the extensions directory again when a file changes; the shell then reloads its page, so changed frontends show at once |
| `mosaikit.ui.theme` | `mosaikit` | the theme of the interface: `mosaikit`, `pa` for public administrations in the style of Bootstrap Italia, or the identifier of an active theme extension, such as `dev.mosaikit.sample.theme` |
| `mosaikit.accounts.remember-for` | `30d` | how long "Remember me" keeps a person signed in on a browser, unless they sign out |
| `mosaikit.accounts.confirm-email` | `true` | self-registered people confirm their address with a link sent by mail before signing in |
| `mosaikit.accounts.confirmation-valid-for` | `24h` | how long the link that confirms an address works |
| `mosaikit.accounts.mail-timeout` | `15s` | how long the kernel waits for the mail server to take a mail, in all: two attempts of half each, the second on another connection when the first times out; after it the person can ask for the link again |
| `mosaikit.sharing.link-max-validity` | `30d` | the longest validity of a link to a resource of an extension (MK-055): every link expires, at the latest this long after it is made |
| `mosaikit.public-url` | | the address of the installation as people reach it, such as `https://mosaikit.example.org`, for the links in mails; without it, the address of the request |
| `quarkus.mailer.host`, `port`, `username`, `password`, `tls`, `start-tls` | `localhost`, `25` | the mail server that sends the confirmation links |
| `quarkus.mailer.from` | `Mosaikit <no-reply@localhost>` | the sender of the mails |
| `mosaikit.extensions.providers-directory` | | set by the launcher: where the JARs of Java extensions are |
| `mosaikit.extensions.packages-directory` | `extensions/.packages` | set by the launcher: where packages are unpacked |

## Files

The files of extensions (MK-041) are kept in a directory of the server or in a bucket of an
S3-compatible object store; the database keeps only what the kernel knows of each file. See
[choosing the store of files](administration.md#files-of-extensions).

| Setting | Default | Meaning |
|---|---|---|
| `mosaikit.files.store` | `filesystem` | `filesystem`, a directory of the server, or `s3`, a bucket of an S3-compatible object store (Amazon S3, MinIO, Ceph, Garage) |
| `mosaikit.files.directory` | `files` | the directory of the `filesystem` store, relative to the working directory of the kernel when not absolute (the installation directory) |
| `mosaikit.files.max-size` | `10M` | the largest file, such as `512M` or `2G`; an upload through the REST API is also bound by `quarkus.http.limits.max-body-size` (`10M`), which an installation raises with it. Larger files are refused with 413 |
| `mosaikit.files.link-max-validity` | `7d` | the longest validity of a signed link to files (MK-093): every link expires, at the latest this long after it is made |
| `mosaikit.files.link-key` | | the key that signs links to files: at least 32 random bytes in base64 (`openssl rand -base64 32`), from a secret (`MOSAIKIT_FILES_LINK_KEY`). Empty, the key is derived from `mosaikit.secrets.master-key`; without either, links to files are disabled. See [signed links to files](administration.md#signed-links-to-files) |
| `mosaikit.files.link-previous-keys` | | the former link keys of a rotation, comma-separated: the links they signed keep working until they expire |
| `mosaikit.files.s3.endpoint` | | the URL of the store, such as `https://s3.example.org`; empty for Amazon S3, whose URL follows from the region |
| `mosaikit.files.s3.region` | `us-east-1` | the region of the bucket; any value for a store without regions |
| `mosaikit.files.s3.bucket` | | the bucket of the files, created beforehand; required with `s3` |
| `mosaikit.files.s3.path-style` | `false` | `true` puts the bucket in the path of the URL rather than in its host name, as MinIO and most stores on premises need |
| `mosaikit.files.s3.access-key-id` | | the access key; empty to use the credentials of the environment of the kernel (`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, a profile, the role of the machine or of the pod) |
| `mosaikit.files.s3.secret-access-key` | | its secret, from a secret (`MOSAIKIT_FILES_S3_SECRET_ACCESS_KEY`); the kernel never logs it |

## Assistant

| Setting | Default | Meaning |
|---|---|---|
| `mosaikit.assistant.url` | | base URL of an OpenAI-compatible API, such as `http://localhost:11434/v1` (Ollama); without it there is no assistant (MK-024) |
| `mosaikit.assistant.model` | `llama3.1` | model to use; it must support tool calling |
| `mosaikit.assistant.api-key` | | bearer token, for hosted services |
| `mosaikit.assistant.max-steps` | `6` | most rounds of tool calls for one question |
| `mosaikit.assistant.timeout` | `120s` | how long one answer of the model may take |

## Marketplace

| Setting | Default | Meaning |
|---|---|---|
| `mosaikit.marketplace.sources` | `catalog/` in the configuration of an installation | comma-separated catalog directories (`https:`, `file:`, or a path relative to the installation), each with a signed `index.json` (MK-022) |
| `mosaikit.marketplace.max-package-bytes` | `268435456` | largest package downloaded or accepted |

## Portable distribution

| Variable | Default | Meaning |
|---|---|---|
| `MOSAIKIT_DATABASE_PORT` | `54329` | port of the bundled PostgreSQL, on 127.0.0.1 only |

## Logging

| Setting | Default | Meaning |
|---|---|---|
| `quarkus.log.level` | `INFO` | level of every logger |
| `quarkus.log.category."dev.mosaikit".level` | `INFO` | level of the kernel |

Every other setting of Quarkus 3 applies as well; see the Quarkus documentation.
