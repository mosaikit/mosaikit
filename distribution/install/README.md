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

## Contents

| Path | Content |
|---|---|
| `mosaikit`, `mosaikit.cmd` | the launcher |
| `config/` | settings; every setting can also be an environment variable (`QUARKUS_*`, `MOSAIKIT_*`) |
| `extensions/` | installed extensions |
| `catalog/` | signed catalog of the sample extensions, offered on the Extensions page (`mosaikit.marketplace.sources`) |
| `bin/kernel/` | the kernel, with the web interface |
