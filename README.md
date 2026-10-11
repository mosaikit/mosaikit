# Mosaikit

Mosaikit is a domain-agnostic, plugin-based platform for building multi-organization web
applications. A small kernel provides what every product needs — identity, organizations,
users, localization, theming and plugin management — and everything else is a plugin.
Plugins can extend the user interface, the backend API and the database schema, and they
can in turn be extended by other plugins.

> Status: **early development** (0.1.0-SNAPSHOT). APIs and the plugin contract are not stable yet.

## Principles

- **Small kernel, everything else is a plugin.** The kernel knows nothing about any business
  domain.
- **One contract for everyone.** First-party plugins follow the same rules as third-party ones.
- **Plugins talk through the kernel.** Events, typed services and shared context, all declared
  in the plugin manifest.
- **Frontend-only plugins are active at once; Java plugins at the next start.** A plugin without
  Java code keeps its data in the kernel and works as soon as it is installed. Installing a Java
  plugin re-runs the Quarkus build step at the next start, the same model Keycloak uses for its
  providers.
- **Framework-agnostic frontend.** A plugin UI is a Web Component loaded as an ES module; it can
  be written with any framework.

## Repository layout

| Path | Content |
|---|---|
| `src/server/` | The kernel: one Quarkus application with the services and the launcher that loads Java plugins. |
| `src/web/` | The web shell (Lit + Vite), built by npm and packaged in the kernel. |
| `sdk/` | What third parties need to write plugins: `sdk/java` (the Java plugin API and the manifest schema), `sdk/js` (`@mosaikit/sdk` for plugin frontends) and `sdk/create-plugin` (a generator of new plugins). See [sdk/README.md](sdk/README.md). |
| `tests/fixtures/plugins/` | The plugins that the tests of the kernel install: small, owned by the tests. The sample plugins are in [mosaikit/samples](https://github.com/mosaikit/samples), the apps Teams and Chat in repositories of their own (ADR-0035). |
| `distribution/` | How Mosaikit is delivered: installation, portable archives, Docker, Kubernetes, Keycloak realm, release scripts. |
| `tests/e2e/` | End-to-end tests with Playwright on a real installation. See [tests/e2e/README.md](tests/e2e/README.md). |
| `build/` | Scripts for development: `npm run dev`, which starts the kernel with an embedded PostgreSQL and a fake mail server from `sdk/testing`. |
| `docs/` | Guides for users and developers, compliance (AgID, ACN, GDPR), decisions (ADR) and the requirements (`docs/requirements`, `MK-xxx`). See [docs/README.md](docs/README.md). |

## Requirements

| Tool | Needed for |
|---|---|
| JDK 25 (LTS) | everything; Maven comes with the wrapper (`./mvnw`, `mvnw.cmd` on Windows) |
| Node.js 24 LTS or 26 | everything: the frontend, the development mode, the tests |
| Git | cloning the repository |
| Bash with `curl` and `tar` | only the portable archives (`-Pportable`). On Linux and macOS they are part of the system; on Windows install [Git for Windows](https://git-scm.com/download/win), whose Git Bash the build uses from `C:\Program Files\Git\bin\bash.exe` (another location: `-Dportable.bash=<path to bash.exe>`). The Bash of WSL is not used. |
| Docker or Podman | only the Docker distribution and the tests with Keycloak (`-Dtest.groups.excluded=`) |

PostgreSQL does not need to be installed: the development mode and the tests start PostgreSQL 18
from `node_modules` (package `embedded-postgres`), and the portable archives bring their own.

On Windows the commands below are the same with `mvnw.cmd` in place of `./mvnw`, in PowerShell
(`.\mvnw.cmd install ...`) or in the Command Prompt (`mvnw.cmd install ...`).

## Develop

```bash
git clone https://github.com/mosaikit/mosaikit.git
cd mosaikit
npm ci            # once, and after every change of package-lock.json
npm run dev       # kernel, shell, database and sample data; Ctrl+C stops everything
```

Open <http://localhost:8080> and sign in:

| Who | Username | Password |
|---|---|---|
| platform administrator | `admin` | `admin-dev-only` |
| people of the organization `demo` | `mario.rossi@example.org`, `anna.bianchi@example.org` | `dev-password-2026` |

`npm run dev` builds the plugin API (a few seconds), starts PostgreSQL (its data in
`.dev/postgres`, kept between runs; `npm run dev -- --reset` starts again from an empty database)
and a fake language model for the assistant, then runs the kernel with `quarkus:dev`:

- Java code and the UI reload live (Quinoa runs Vite on `src/web`).
- Plugins are read from `plugins/`, which is watched: save a file of a frontend, or add a plugin
  without Java code, and the open pages reload by themselves. Plugins with Java code are loaded
  only by the launcher of an installation (see [Try the distributions](#try-the-distributions)).
- Swagger UI: <http://localhost:8080/q/swagger-ui>. Dev UI: <http://localhost:8080/q/dev-ui>.

To start a plugin of your own:

```bash
npm run build     # once: builds the SDK and the generator in sdk/create-plugin/dist
node sdk/create-plugin/dist/bin.js dev.example.signs --name Signs --directory plugins/signs
node sdk/create-plugin/dist/bin.js dev.example.roads --name Roads --backend --directory ../roads
```

The first one has no Java code: created in `plugins/`, it appears in the shell of `npm run dev`
at once. The second one, with Java code, is built with Maven and installed in a distribution. See
the [plugin development guide](docs/development/plugin-development.md).

## Test

```bash
npm run check:fast                       # frontend: lint, type check, unit tests (seconds)
./mvnw verify -Dskip.npm -DskipITs       # backend: unit and Quarkus tests (minutes)
./mvnw install                           # everything, with the integration tests and the packages
npm run e2e                              # end-to-end tests, after ./mvnw install (or -DskipTests)
./mvnw spotless:apply && npm run format  # format the sources before a commit
```

No Docker is needed: every test starts its own PostgreSQL. `npm run e2e` builds a test
installation in `tests/e2e/.work` from `target/dist`, starts it with its launcher and drives the shell
with Playwright. Pull requests run the same checks in CI; see
[docs/development/development.md](docs/development/development.md).

## Build the distributions

```bash
./mvnw install -DskipTests                # installation, Docker, Helm chart, sample plugins, catalog
./mvnw install -DskipTests -Pportable     # also the portable archives (Bash: see Requirements)
./mvnw install -DskipTests -Pportable -Dportable.platforms=windows-x64   # one platform only
./mvnw install -DskipTests -Pportable -rf :mosaikit-distributions         # only the distributions again
```

`-rf` (resume from) rebuilds only the last module and needs a previous full `install`. The
result is in `target/dist`:

| Path | What it is |
|---|---|
| `mosaikit/` | the installation for a server or a PC with Java 25 and PostgreSQL 18, with a signed catalog of the sample plugins in `catalog/` |
| `mosaikit-portable/` | the portable archives, `mosaikit-portable-<version>-<platform>.zip` or `.tar.gz`: Java and PostgreSQL included, nothing to install, for Windows, Linux and macOS (`-Pportable`) |
| `mosaikit-docker/` | Docker Compose with PostgreSQL, Keycloak and Mosaikit |
| `mosaikit-k8s/` | the Helm chart |
| `plugins/` | the sample plugins, as packages to copy into `plugins/` |

Each one has a `README.md` with all the details.

## Try the distributions

**Portable archive**, the quickest, with nothing to install:

1. Unpack `target/dist/mosaikit-portable/mosaikit-portable-<version>-<platform>.zip` (`.tar.gz`
   on Linux and macOS) anywhere.
2. Start `mosaikit.cmd` (Windows, also with a double click) or `./mosaikit` (Linux, macOS).
3. Open <http://localhost:8080> and sign in as `admin` with the password in
   `data/initial-admin-password.txt`.

**Installation** (`target/dist/mosaikit`), with a PostgreSQL 18 of your own:

1. Create a database and a user, for example with Docker (port 55432, in case a PostgreSQL of the
   system already uses 5432):

   ```bash
   docker run -d --name mosaikit-pg -p 55432:5432 -e POSTGRES_USER=mosaikit \
     -e POSTGRES_PASSWORD=mosaikit -e POSTGRES_DB=mosaikit postgres:18
   ```

2. Edit `config/application.properties`: `quarkus.datasource.jdbc.url`
   (`jdbc:postgresql://localhost:55432/mosaikit`), user, password, and
   `mosaikit.bootstrap.admin-password`, the password of the first administrator.
3. Start `./mosaikit` (Linux, macOS, Git Bash) or `mosaikit.cmd` (Windows), open
   <http://localhost:8080> and sign in as `admin`.

**Docker Compose**: in `target/dist/mosaikit-docker` change the passwords in `.env`, run
`docker compose up -d --build` and open <http://localhost:8080> (Keycloak on
<http://localhost:8180>).

**Kubernetes**: `target/dist/mosaikit-k8s` has the Helm chart and the commands to install it.

In every distribution plugins are installed in two ways:

- from the interface: the **Plugins** page of the administrator offers the signed catalog of the
  sample plugins, and accepts uploads of signed packages. Plugins without Java code are active at
  once; for the others the page asks to start Mosaikit again;
- by hand: copy a package (`target/dist/plugins/<name>.zip`) into `plugins/` of the installation
  and start Mosaikit again. Plugins with Java code are loaded by rebuilding the kernel at that
  start, which takes a few seconds.

## Documentation

- [User and administrator guide](docs/guide/README.md): installation, administration, plugins,
  configuration, operations.
- [Developer guide](docs/development/README.md): architecture, building, plugin development, API.
- [Compliance](docs/compliance/README.md): AgID and ACN QC2 matrix, evidence, open
  non-conformities.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Commits follow Conventional Commits and carry a
Developer Certificate of Origin sign-off. Security issues: see [SECURITY.md](SECURITY.md).

## License

Copyright © 2026 Massimo Antonini.

Mosaikit is licensed under the [Mozilla Public License 2.0](LICENSE). MPL-2.0 is a file-level
copyleft: modified Mosaikit files must be published under the same license, while plugins
that live in their own files and use the public API may be distributed under any license,
including commercial ones. See [ADR-0002](docs/adr/0002-license-mpl-2.0.md).
