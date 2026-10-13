<!--
SPDX-FileCopyrightText: 2026 Massimo Antonini
SPDX-License-Identifier: MPL-2.0
-->
# End-to-end tests

Playwright tests on a real installation: the one that `./mvnw install` writes to `target/dist`,
started by its launcher on PostgreSQL, with the sample extensions installed from the signed catalog
through the Extensions page, and driven in Chromium. Only the language model of the assistant is a
fake (`support/fake-model.ts`), so that the tests check the kernel and the shell and not a model.

A requirement is done when its e2e cases pass, not only its unit tests: with 92% of the code
covered by unit tests, the first run of these cases found seven defects that only show up when
launcher, kernel, shell and browser work together.

## Run

```bash
./mvnw install -DskipTests            # target/dist, the generator and the extension API in ~/.m2
docker run -d --name mosaikit-e2e-pg -p 55432:5432 -e POSTGRES_USER=mosaikit \
  -e POSTGRES_PASSWORD=mosaikit -e POSTGRES_DB=mosaikit postgres:18
npx playwright install chromium        # once
npm run e2e                            # npm run e2e -- --headed, -- -g "22.4", -- --ui
```

The report is in `tests/e2e/report/` (`npx playwright show-report tests/e2e/report`); the test installation,
its log (`installation.log`) and the traces of failed tests in `tests/e2e/.work/`. Use an empty database
for a run that starts from scratch.

| Variable | Default | Meaning |
|---|---|---|
| `E2E_DB_URL`, `E2E_DB_USERNAME`, `E2E_DB_PASSWORD` | `jdbc:postgresql://localhost:55432/mosaikit`, `mosaikit`, `mosaikit` | database of the test installation |
| `E2E_KERNEL_PORT` | `8181` | port of the test installation |
| `E2E_MODEL_PORT`, `E2E_CONTROL_PORT` | `18091`, `18090` | the fake model, and the endpoint with which tests restart the installation |

## How it works

- `global-setup.ts` copies `target/dist/mosaikit`, with its catalog `catalog/`, to
  `tests/e2e/.work`, creates a signing key that the installation trusts and signs the catalog with it,
  starts the fake model and the installation, and creates the organization `comune-prova` with two
  people. Tests restart the installation (after installing Java extensions, or with other settings)
  through `restart()` of `support/shell.ts`.
- The files of `tests/` run in order in one worker: `01-marketplace` installs the sample extensions
  that the following files use.
- One test per case of the manual test plan, named after it (`22.4 …`), in a `describe` named after
  the requirement.

## Groups

`run.ts` runs the files in groups at the same time, each on a bench of its own. A file names its
group in a comment at its top, after the SPDX lines, and the fixture extensions it installs for the
files after it:

```ts
// e2e-group: C
// e2e-installs: todo
```

No shared list is edited for a new file. Within a group the files run in the order of their names;
a file without `// e2e-group:` runs in group B, the lightest. A group that does not exist, two
`// e2e-group:` lines, or a file of `tests/` that is not named `*.e2e.ts` stop the run with the
list of the files that would run in no group; `node tests/e2e/run.ts --check` shows the groups
without running anything (`npm run check:pr` and the frontend tests run it). What holds for a
whole group, such as the fixtures installed before its first file, is in `GROUP_SETTINGS` of
`groups.ts`.
