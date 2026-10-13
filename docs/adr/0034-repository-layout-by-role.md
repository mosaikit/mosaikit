# 0034. Repository laid out by role, with the sources under src/

- Status: accepted
- Date: 2026-10-11
- Deciders: Massimo Antonini
- Supersedes the repository part of [ADR-0012](0012-repository-and-distribution-layout.md); the
  installation layout it describes does not change

## Context and problem statement

Mosaikit becomes the foundation of products that add their own extensions on top of it. Who opens
the repository for the first time looks for three things: what runs, what a plugin author uses,
and how it is delivered. With `kernel/`, `plugins/`, `distributions/`, `e2e/` and `tools/` side by
side at the top, the web shell was hidden four levels down in `kernel/src/main/webui`, and the
folders of the repository had the same names as the folders of an installation (`plugins/`,
`kernel/`), so a path in a guide could mean either.

## Decision

```
src/server        the kernel: Quarkus services and the launcher
src/web           the web shell
src/plugins       sample plugins, built and tested with the kernel
sdk/              what third parties use: Java API, JS SDK, UI kit, create-plugin
distribution/     installation, portable, Docker, Kubernetes, Keycloak realm, release
tests/e2e         tests on a whole installation
build/            scripts of development (npm run dev, embedded PostgreSQL)
docs/guide        for who installs and runs Mosaikit
docs/development  for who changes Mosaikit or writes plugins
```

- Maven modules and npm workspaces follow the folders; the web shell stays a workspace of its own
  that the kernel packages (Quinoa `ui-dir=../web` in development).
- Installation paths (`plugins/`, `plugins/.previous`, `bin/kernel/…`) keep their names: they are
  part of the operating contract, not of the repository.
- Accepted ADRs keep the paths of their time; they are history.

## Consequences

- The layout is checked by a test (`build/test/layout.test.ts`, MK-049): old folders cannot come
  back, and every relative link of the documentation must resolve.
- Open branches need a rebase with `git mv`-aware merging; git follows the renames.
