# Development guide

## Prerequisites

| Tool | Version |
|---|---|
| JDK | 25 (LTS) |
| Maven | 3.9.x |
| Node.js | 24 LTS or 26 |
| Container runtime | Docker or Podman, only for the tests with Keycloak (`-Dtest.groups.excluded=`) and the Docker distribution; PostgreSQL comes from `node_modules` |
| Bash, curl, tar | only for the portable archives; on Windows Git for Windows (Git Bash) |

## Everyday commands

```bash
npm ci                                  # once: also brings PostgreSQL 18 (@embedded-postgres)
npm run dev                             # kernel and shell in development mode, with database and sample data
npm run check:fast                      # frontend: lint, type check, unit tests
./mvnw verify -Dskip.npm                # backend: unit and Quarkus tests (the installation tests need -DskipITs=false)
npm run e2e                             # end-to-end tests on a real installation (after ./mvnw install)
./mvnw install                          # everything: frontend and backend checks, tests, target/dist
./mvnw install -DskipTests              # without tests (and without the frontend checks)
./mvnw verify -Dskip.npm                # backend only; the kernel then has no UI
npm run check                           # frontend only: lint, type check, tests with coverage
./mvnw spotless:apply                   # format Java sources and add license headers
npm run format                          # format frontend sources
./mvnw -Pmutation verify -pl sdk/java   # mutation testing with PIT
./mvnw cyclonedx:makeAggregateBom       # software bill of materials
```

The Maven build runs npm itself: `npm ci`, then `npm run build` (SDK and UI, before the kernel,
which packages the UI), then `npm run check` in the test phase.

## Test what you changed

A whole build with every test takes 15 to 20 minutes on a laptop; nobody needs it to change one
thing. Run the tests of what you changed, and leave the rest to the CI, which runs everything on
every pull request.

| You changed | Run | Takes |
|---|---|---|
| an extension | `npm test` in the repository of the extension, on the bench of `@mosaikit/testing` (ADR-0035) | 20–40 s |
| the shell (`src/web`) or the SDK (`sdk/js`, `sdk/ui`) | `npm run check:fast` | under a minute |
| the same, as people see it | `./mvnw install -DskipTests` once, then `node tests/e2e/run.ts <file>` (such as `13-teams-shell`) | about 35 s for a file |
| a class of the kernel | `./mvnw -pl src/server test -Dskip.npm -Dtest=<TestClass>` | 1–2 min |
| an endpoint of the kernel (added, changed, removed) | `./mvnw -pl sdk/java,src/server test -Dskip.npm -Dtest=DocumentationTest -Dsurefire.failIfNoSpecifiedTests=false -Ddocs.write=true`: rewrites the table of [api.md](api.md) from the OpenAPI document, with a row for each new endpoint to complete | 1–2 min |
| the launcher or the installation of Java extensions | `./mvnw -pl src/server verify -Dskip.npm -DskipITs=false -Dit.test=JavaExtensionInstallationIT -Dtest=none -Dsurefire.failIfNoSpecifiedTests=false` | about 3 min |
| documentation only | `npx vitest run docs` | seconds |

Before a pull request that touches more than one of these, `npm run check:fast` and
`./mvnw verify -Dskip.npm` cover the frontend and the backend; `npm run e2e` runs the
whole end-to-end suite in three groups at the same time, each on a bench of its own (about 3–4
minutes; `node tests/e2e/run.ts B` runs one group).

On Windows an antivirus scans each new file when a program first opens it, and a build writes
thousands: a [Dev Drive](https://learn.microsoft.com/windows/dev-drive/) for the sources, the
Maven repository and the npm cache makes builds and tests much faster.

## Development mode

```bash
npm run dev                      # npm run dev -- --reset starts again from an empty database
```

`build/dev.ts` builds the extension API at every start (a few seconds: the dev mode takes its classes from `sdk/java/target`), starts PostgreSQL 18 from `node_modules`
(its data in `.dev/postgres`, kept between runs), a fake language model for the assistant, and
`./mvnw -pl kernel quarkus:dev`; once the kernel is ready it creates the organization `demo` with
two people and prints how to sign in. Nothing to install or start by hand but Java and Node.

- Kernel and UI on <http://localhost:8080>, with live reload of Java code and hot module
  replacement of the UI (Quinoa runs Vite on `src/web`).
- A platform administrator `admin` / `admin-dev-only` is created at first start.
- Extensions are read from the `extensions/` directory of the repository. Extensions with Java code, such
  as `sample-notes`, stay `RESTART_REQUIRED`: their code is loaded only by the launcher (next
  section).
- The `extensions/` directory is watched (`mosaikit.extensions.watch`): save a file of a frontend, or
  add an extension without Java code, and the open shells reload their page by themselves, keeping
  the session.
- Swagger UI: <http://localhost:8080/q/swagger-ui>. Dev UI: <http://localhost:8080/q/dev-ui>.

To work on the UI alone against a running kernel: `npm run dev -w src/web`
(Vite forwards `/api` and `/q` to port 8080).

## Running an installation

`./mvnw install` leaves an installation in `target/dist/mosaikit` (see its `README.md`). To try
the launcher and Java extensions as they run in production:

```bash
./mvnw install -DskipTests
cp target/dist/extensions/sample-notes-*.zip target/dist/mosaikit/extensions/   # a Java extension, as it is
# edit target/dist/mosaikit/config/application.properties (database, admin password)
target/dist/mosaikit/mosaikit              # mosaikit.cmd on Windows
```

The first start after adding, updating or removing a Java extension rebuilds the kernel. An extension can
also be a directory with the same content as its package, which is handy while writing it.

## Building the portable distribution

The portable archives ([ADR-0010](../adr/0010-portable-distribution.md)) are built from
`target/dist/mosaikit`, on Linux, macOS or Windows (Git Bash); the JDK and PostgreSQL downloads
are cached in `target/portable-cache` (it can be deleted: the next build downloads them again) and
the archives go to `target/dist/mosaikit-portable`:

```bash
./mvnw install -DskipTests -Pportable                  # every platform
./mvnw install -DskipTests -Pportable -Dportable.platforms=windows-x64
distribution/portable/build.sh linux-x64              # by hand, after ./mvnw install
./mvnw -pl kernel failsafe:integration-test failsafe:verify -Dit.test=PortableDistributionIT \
  -Dmosaikit.it.portable=$PWD/target/dist/mosaikit-portable/mosaikit-portable-0.1.0-SNAPSHOT-linux-x64.tar.gz
```

`JLINK_JDK` can point to a local JDK of the same version as the pinned Temurin jmods, to skip
its download.

## Federated sign-in

`FederatedIdentityTest` (MK-012) runs against a real Keycloak: by default it starts
`quay.io/keycloak/keycloak` in a container; `-Dit.keycloak.url=http://localhost:8180` uses a
running one instead (admin `admin`/`admin`). Each run creates two realms with random names from
`distribution/keycloak/realm-template.json`.

To try it in development mode:

```bash
docker run -d --name keycloak -p 8180:8080 -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin quay.io/keycloak/keycloak:26.7.4 start-dev
# import the realm template (redirect URI http://localhost:8080/*), add a user, then:
./mvnw -pl kernel quarkus:dev -Dmosaikit.identity.keycloak-url=http://localhost:8180
# curl asks for the password of admin (admin-dev-only in development mode)
curl -u admin -X PUT localhost:8080/api/v1/organizations/<slug>/identity \
  -H 'Content-Type: application/json' -d '{"realm":"<realm>","emailDomains":["example.com"]}'
```

## Tests and traceability

- Java unit tests live next to the code (`sdk/java`, `src/server`); the integration tests with
  `@QuarkusTest` and REST Assured are in `src/server/src/test/java/dev/mosaikit/kernel/app`.
- The tests need no Docker: `EmbeddedPostgres` (`src/server/src/test/java/dev/mosaikit/testing`)
  starts PostgreSQL 18 from `node_modules` for every `@QuarkusTest`, in a temporary directory on a
  free port. The tests with Keycloak are tagged `keycloak` and run only with
  `-Dtest.groups.excluded=` (they start Keycloak in Docker).
- `JavaExtensionInstallationIT` (`src/server`, run by Failsafe in `verify` only with `-DskipITs=false`, as the CI does on `main` and every night)
  installs the package of the fixture Java extension in a real installation and checks MK-011 end to
  end. It starts PostgreSQL the same way, or uses a server given with `-Dmosaikit.it.jdbc-url=…` (plus `-username`,
  `-password`) on which it creates and drops its own database.
- Frontend tests use Vitest; the JSON Schema of the manifest is tested against every manifest
  in the repository.
- Every test class carries the requirement it verifies: `@Tag("MK-003")` in Java,
  the requirement id in the `describe` title or file in TypeScript when relevant.

## End-to-end tests

[`tests/e2e/`](../../tests/e2e/README.md) runs Playwright on a real installation built by `./mvnw install`:
launcher, kernel, shell and the fixture extensions of `tests/fixtures/extensions`, in Chromium, with a
fake language model only. The installation runs on the bench of `@mosaikit/testing` (`sdk/testing`),
the same that the repositories of extensions use. Every
requirement has its e2e cases there, one per acceptance criterion; a requirement is done when they
pass in CI (job `e2e`), not only its unit tests.

```bash
./mvnw install -DskipTests && npm run e2e
```

## CI

The workflow (`.github/workflows/ci.yml`) runs on the GitHub-hosted runners in two lanes; for a
public repository the runners are free. A newer run of the same branch or pull request cancels the
running one.

| Lane | When | What |
|---|---|---|
| Fast | pull requests, about 4 minutes | frontend checks, unit and Quarkus tests (without the installation tests and Keycloak) and end-to-end tests at the same time, secrets, SAST; a pull request of documentation only (`docs/`, `changelog.d/`, Markdown files at the root) runs the frontend checks and `DocumentationTest`, in about a minute |
| Merge queue | each pull request in the merge queue of `main` (`merge_group`), on the commit that merges it with `main` and the pull requests ahead of it | the fast lane, always whole (no documentation-only shortcut), plus the release documents; not `changelog`, which passed on the pull request |
| Full | `main`, every night at 02:17 UTC, tags, by hand | everything above, plus the installation tests, the tests with Keycloak, SonarQube, SBOM, dependency scan and the release documents; the portable archives on tags or by hand |

The tests of the backend run in two jobs at the same time, `backend shard 1/2` and
`backend shard 2/2`: `-Dtest.shard=<n>/2` makes the JUnit Platform filter `TestShards` of the kernel
keep the test classes of one shard, the slow ones as listed in
`src/server/src/test/resources/test-shards.properties` and the others by the hash of their name, so
every class runs in exactly one shard. A class that takes more than a few seconds is worth a line
there. The job `backend` passes when both shards pass.

`frontend`, `backend`, `e2e`, `docs`, `changelog`, `secrets` and `sast` are the required checks of
`main` (a job skipped by its condition, such as `docs` on a pull request, counts as passed), and pull
requests are opened with auto-merge (`gh pr merge --auto --rebase`): GitHub merges them when the
checks pass, so nobody waits for the CI. With the merge queue of `main` turned on, auto-merge puts
a pull request in the queue instead, and the workflow runs again on what `main` will be after it;
pull requests that each passed alone, but not together, no longer break `main`.

The code is analysed on SonarQube Cloud (organization `mosaikit`, project `mosaikit_mosaikit`):
the `sonarqube` job runs when the repository secret `SONAR_TOKEN` is defined, with Automatic Analysis
turned off in SonarQube Cloud.

## Quality gate

See [CONTRIBUTING.md](../../CONTRIBUTING.md#quality-gate). The same checks run locally and in CI:
formatting (Spotless, Prettier), static analysis (compiler warnings, ESLint strict type-checked,
SonarQube), architecture rules (ArchUnit), coverage (JaCoCo, V8) and dependency scanning.
