# Mosaikit

Installation for a server or a PC with **Java 25** and **PostgreSQL 18**, without containers.
For Docker use `mosaikit-docker`, for Kubernetes `mosaikit-k8s`; to try Mosaikit without
installing anything use the portable archive.

## Start

1. Create a PostgreSQL database and a user, for example with Docker:

   ```bash
   docker run -d --name mosaikit-pg -p 5432:5432 -e POSTGRES_USER=mosaikit \
     -e POSTGRES_PASSWORD=mosaikit -e POSTGRES_DB=mosaikit postgres:18
   ```

2. Edit `config/application.properties`: database URL, user and password, and the password of the
   first administrator.
3. Start: `./mosaikit` (Linux, macOS, Git Bash) or `mosaikit.cmd` (Windows).
4. Open <http://localhost:8080> and sign in as `admin`.

Stop with Ctrl+C. The launcher uses the Java of `JAVA_HOME`, or `java` on the path.

## Extensions

Copy the extension package (`<name>.zip`) into `extensions/` as it is and start Mosaikit again. Extensions
with Java code are loaded by rebuilding the kernel at the next start, which takes a few seconds; if
the kernel cannot start with a new extension, the extension is rolled back and Mosaikit starts with the
previous extensions.

## Settings

The settings of the kernel and of the installed extensions are in `config/application.properties`
([configuration](../../docs/guide/configuration.md)), or in environment variables, which win: the
name of the setting in upper case, with every character that is not a letter or a digit replaced by
`_`. For example, an extension whose documentation names the setting `example.reports.endpoint`:

```properties
example.reports.endpoint=https://reports.example.org
```

or `EXAMPLE_REPORTS_ENDPOINT=https://reports.example.org` in the environment of the launcher. Keep
passwords and keys in the environment, or keep `config/application.properties` readable only by the
account that runs Mosaikit. Restart Mosaikit after a change.

Behind a reverse proxy that terminates TLS, enable the forwarded headers from the address of the
proxy (commented in `config/application.properties`), or the session cookie lacks `Secure`; see
[installation](../../docs/guide/installation.md#behind-a-reverse-proxy).

## Mail

The kernel sends the links of registrations and of the accounts that administrators create through a
mail server, in `config/application.properties` (or the variables `QUARKUS_MAILER_HOST` and so on):

```properties
quarkus.mailer.host=smtp.example.org
quarkus.mailer.port=587
quarkus.mailer.start-tls=REQUIRED
quarkus.mailer.username=mosaikit@example.org
quarkus.mailer.password=change-me
quarkus.mailer.from=Mosaikit <mosaikit@example.org>
mosaikit.public-url=https://mosaikit.example.org
```

Without `quarkus.mailer.host` the installation sends no mail: an administrator creates the accounts
of people and passes on the link to set the password, which the console shows once; self-registration
then needs `mosaikit.accounts.confirm-email=false`, or stays off. See
[Sending mail](../../docs/guide/administration.md#sending-mail).

## Contents

| Path | Content |
|---|---|
| `mosaikit`, `mosaikit.cmd` | the launcher |
| `config/` | settings; every setting can also be an environment variable (`QUARKUS_*`, `MOSAIKIT_*`) |
| `extensions/` | installed extensions |
| `files/` | the files of extensions, created when the first is stored (`mosaikit.files.directory`); back it up with the database |
| `catalog/` | signed catalog of the sample extensions, offered on the Extensions page (`mosaikit.marketplace.sources`) |
| `bin/kernel/` | the kernel, with the web interface |
