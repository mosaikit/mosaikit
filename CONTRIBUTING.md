# Contributing to Mosaikit

Thank you for considering a contribution. This document describes how the project works.

## Ground rules

- Code, comments, commit messages and technical documentation are written in **English**.
- Every change is linked to a requirement (`MK-xxx` in `docs/requirements/`) or to an issue.
- The kernel stays domain-agnostic: anything specific to a business domain belongs in a plugin.
- Plugins, including first-party ones, only import `kernel-api` and the SPI modules they
  declare. Architecture rules are enforced by ArchUnit tests.

## Workflow

1. Open or pick an issue. For non-trivial changes, agree on the approach first. Only big decisions
   (the public contract of plugins, the architecture, a new dependency on a service) need an
   Architecture Decision Record in `docs/adr/`; the rest is explained in the commit and the pull
   request.
2. Create a short-lived branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   `feat(kernel): add organization registry`.
4. Sign off every commit (`git commit -s`) to certify the
   [Developer Certificate of Origin](https://developercertificate.org/).
5. Run the fast checks locally before pushing; the CI runs the rest:
   ```bash
   npm run check:fast
   ./mvnw verify -Dskip.npm -DskipITs
   npm run e2e        # when the change touches what people see or do
   ```
6. Open a pull request with auto-merge (`gh pr merge --auto --rebase`): GitHub merges it with
   rebase once the required checks pass. Changes to `kernel-api`
   (including the manifest schema) or `sdk/` require a review.
7. A feature is done when its end-to-end tests pass in `tests/e2e/`, not only its unit tests.

## Quality gate

A merge request is accepted when:

- the build, format check and all tests pass;
- SonarQube reports rating **A** on reliability, security and maintainability, **no new
  vulnerabilities**, coverage on new code **≥ 85%** (≥ 90% for `kernel-api`) and duplicated
  lines on new code **≤ 1%**;
- no new dependency carries an incompatible license (AGPL is not accepted);
- public API changes follow semantic versioning and are documented.

## Coding conventions

- Java 25: records for values and DTOs, sealed types for outcomes, constructor injection.
- Persistence through Jakarta Data repositories (no Panache), migrations with Flyway, one
  schema per module or plugin, no foreign keys across schemas.
- REST resources under `/api/v1`, validated with Bean Validation, documented with OpenAPI;
  errors are returned as RFC 9457 problem details.
- TypeScript in strict mode, no `any`; UI through `@mosaikit/ui` components and theme tokens.
- Every source file starts with the SPDX header:
  ```
  SPDX-FileCopyrightText: 2026 Massimo Antonini
  SPDX-License-Identifier: MPL-2.0
  ```

## Reporting bugs and requesting features

Use the issue templates. For bugs include version, installed plugins and steps to reproduce.
Security issues must **not** be reported publicly: follow [SECURITY.md](SECURITY.md).
