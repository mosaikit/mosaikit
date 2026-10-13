# CLAUDE.md

Guidance for Claude Code (and other coding agents) in this repository. The rules of the project are
in [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/development/](docs/development/); this file points
to them and adds what an agent gets wrong without being told. A maintainer may keep personal rules
in `CLAUDE.local.md`, which is never committed.

## What this is

Mosaikit is a platform for web applications made of extensions: a Quarkus kernel, a Lit shell, an
SDK for extensions, and the distributions that ship them. It is domain-agnostic: anything of a
business domain belongs in an extension, in its own repository (ADR-0035).

```
src/server/        the kernel (Java 25, Quarkus) and the launcher
src/web/           the shell (TypeScript, Lit, Fluent UI)
sdk/java           the extension API (kernel-api), with the manifest schema and PackageSigningTool
sdk/extension-parent  the parent POM of extensions
sdk/js, sdk/ui     the frontend SDK and the components and themes
sdk/testing        @mosaikit/testing, the bench: a real installation for the tests of an extension
sdk/create-extension  create-mosaikit-extension
distribution/      installation, portable, Docker Compose, Helm, release scripts
tests/e2e/         end-to-end tests of the kernel, in three groups; tests/fixtures/ their extensions
docs/              adr/, requirements/ (MK-xxx.md), development/, guide/, compliance/
```

The words are **extension** (never plugin, ADR-0036), **organization**, **person**, **app**.

## Test what you changed

The table "Test what you changed" of
[docs/development/development.md](docs/development/development.md) says what to run for each kind
of change; a whole build with every test takes about 11 minutes and is rarely needed. In short:

| Changed | Run |
|---|---|
| shell or frontend SDK | `npm run check:fast` |
| as people see it | `./mvnw install -DskipTests` once, then `node tests/e2e/run.ts <file or group>` |
| a kernel class | `./mvnw -pl src/server test -Dskip.npm -Dtest=<TestClass>` |
| the extension API | `./mvnw -pl sdk/java install` (then the kernel compiles against it) |
| documentation | `npx vitest run docs` |
| before a pull request | `npm run check:fast`, `./mvnw verify -Dskip.npm`, `npm run e2e` |

- Run **one** end-to-end suite or bench at a time on a machine: several embedded PostgreSQL and
  JVMs together stall the suites, and the failure looks like a bug of the change.
- `npx playwright install chromium` after an update of Playwright, or every browser test fails
  with "Executable doesn't exist".
- Run Prettier only on the files you changed: `docs/` and Markdown are formatted by hand, and a run
  on a folder realigns the comments of every example in it.

## Every change

- Linked to a requirement: `docs/requirements/MK-xxx.md` (a new one for a new capability), with
  its tests tagged by its id (`@Tag("MK-xxx")` in Java, `MK-xxx` in the title of the e2e
  `describe`). Big decisions get an ADR in `docs/adr/`.
- Documented in the same pull request: the guide for extension developers
  (`docs/development/extension-development.md`) when the contract of extensions changes, the user
  and administrator guide (`docs/guide/`) when behaviour changes, and `CHANGELOG.md` (Unreleased).
- English everywhere; the shell's texts go through `t()` with their translations.
- Conventional Commits, signed off (`git commit -s`, DCO), SPDX headers on every source file.
- Changes to `sdk/` (public API, manifest schema) or `.github/` (CI) are reviewed by a maintainer.
- No names of companies, employers or customers, and no real data, anywhere in the repository:
  examples use `example.org`, Acme, Green.

## Gotchas

- The `snapshot` pre-release (`-latest` packages) is published from `main`: a product that tests
  against it sees a change only once merged. Before that, point it to `target/dist/mosaikit` with
  `MOSAIKIT_INSTALLATION` and to a packed `@mosaikit/testing`.
- On Windows an antivirus scanning `C:\...` makes kernel rebuilds several times slower; the bench
  uses hard links for this, and a Dev Drive or an exclusion helps every build.
- Java extensions rebuild the kernel at the next start of the installation (Quarkus augmentation):
  a test that installs one restarts the installation.
