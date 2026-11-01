# Changelog of @mosaikit/plugin-testing

One version for the whole dev kit (docs/plugin-devkit-plan.md, D6).

## 1.0.0

First version.

- `startDevServer` and `attachDevServer`: a development server of the kit for the tests, started from a plugin folder
  or already running.
- `signIn`, `openPlugin`, `createItem`: the test users (`DEV_USERS`, password `DEV_PASSWORD`), the plugin in the shell,
  an item in a `mountCrud` page.
- `accessibilityViolations`, `expectAccessible`, `formatViolations`: the axe smoke test (optional peer package
  `@axe-core/playwright`).
