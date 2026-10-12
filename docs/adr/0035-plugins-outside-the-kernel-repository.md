# 0035. Plugins outside the kernel repository, tested on a published snapshot

- Status: accepted
- Date: 2026-10-12
- Deciders: Massimo Antonini
- Supersedes the part of [ADR-0024](0024-hosting-on-github.md) that keeps the sample plugins in
  `mosaikit`, and the last point of [ADR-0033](0033-lean-collaboration.md) (`app-chat` and
  `app-teams` in this repository)

## Context and problem statement

A requirement took too long to deliver. With ten plugins as modules of the kernel build, a change
to the shell or to one sample rebuilt the kernel, ran its integration tests and the whole
end-to-end suite: 15 to 20 minutes locally before a push, 9 minutes in CI. The samples stayed here
so that the integration tests of the kernel could use them (ADR-0024); as a result the kernel
tests depended on code that changes for other reasons, and no plugin was ever built the way a
third-party plugin is.

## Decision

- **The kernel repository has no plugins.** What the kernel tests need are fixtures, under
  `tests/fixtures/plugins/`, with identifiers of their own (`dev.mosaikit.fixture.*`): small,
  owned by the tests, not documentation.
- **Plugins live outside, built only against what is published**: `mosaikit/samples` holds the
  sample plugins and the collaboration apps Teams and Chat, one directory each, and each directory
  is a project of its own that builds and tests alone (`mvn verify`, `npm test`) on the parent POM
  of plugins, `io.github.mosaikit:mosaikit-plugin-parent` (MK-051).
- **A snapshot is published from every push to `main`**, readable without a token: the GitHub
  pre-release `snapshot` of `mosaikit/mosaikit` holds the installation archive, the plugin API
  (JAR and POMs) and the npm packages of the SDK. Plugin repositories depend on it until the
  first release, then on the registries (ADR-0025).
- **The SDK gives plugins a test bench**, `@mosaikit/testing`: it downloads the installation
  once, starts it on an embedded PostgreSQL with the plugin of the current folder, and gives
  Playwright the signed-in people. A plugin repository tests only its plugin, in about a minute.

## Consequences

- A change to a plugin never builds or tests the kernel; a change to the kernel never builds the
  plugins. A breaking change of the API is caught by the plugins on the next snapshot, as for any
  third party (ADR-0024).
- The kernel end-to-end suite shrinks to what the kernel does; the tests of the samples and of
  the apps move with them.
- The distributions no longer bundle the samples in their catalog: products choose their plugins.
