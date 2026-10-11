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
start). The kernel keeps its tables in the `mk_kernel` schema and each plugin in its own schema.

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
| `quarkus.http.auth.form.timeout` | `PT8H` | how long the session of the shell of a local account lasts without activity |
| `quarkus.http.auth.session.encryption-key` | random at each start | key (at least 16 characters) that encrypts the session cookie; set the same on every kernel of a cluster, or sessions end at each restart |

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
| `mosaikit.database.row-security` | `true` | requests run as the member role of the installation, so that the row-level security policies of plugins apply (MK-019); the database user needs `CREATEROLE` once |

## Plugins

| Setting | Default | Meaning |
|---|---|---|
| `mosaikit.plugins.directory` | `plugins` | directory of the installed plugins |
| `mosaikit.plugins.trusted-keys-directory` | `config/trusted-keys` | public keys of trusted publishers |
| `mosaikit.plugins.signatures` | `optional` | `required`: only packages signed with a trusted key are accepted |
| `mosaikit.plugins.unverified-frontends` | `iframe` | `iframe` runs the frontends of unverified publishers in a sandboxed iframe; `module` loads them like the others |
| `mosaikit.plugins.watch` | `false` (`true` in development mode) | read the plugins directory again when a file changes; the shell then reloads its page, so changed frontends show at once |
| `mosaikit.ui.theme` | `mosaikit` | the theme of the interface: `mosaikit`, `pa` for public administrations in the style of Bootstrap Italia, or the identifier of an active theme plugin, such as `dev.mosaikit.sample.theme` |
| `mosaikit.accounts.remember-for` | `30d` | how long "Remember me" keeps a person signed in on a browser, unless they sign out |
| `mosaikit.accounts.confirm-email` | `true` | self-registered people confirm their address with a link sent by mail before signing in |
| `mosaikit.accounts.confirmation-valid-for` | `24h` | how long the link that confirms an address works |
| `mosaikit.public-url` | | the address of the installation as people reach it, such as `https://mosaikit.example.org`, for the links in mails; without it, the address of the request |
| `quarkus.mailer.host`, `port`, `username`, `password`, `tls`, `start-tls` | `localhost`, `25` | the mail server that sends the confirmation links |
| `quarkus.mailer.from` | `Mosaikit <no-reply@localhost>` | the sender of the mails |
| `mosaikit.plugins.providers-directory` | | set by the launcher: where the JARs of Java plugins are |
| `mosaikit.plugins.packages-directory` | `plugins/.packages` | set by the launcher: where packages are unpacked |

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
