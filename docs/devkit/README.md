# Mosaikit — Plugin development kit

Documents for whoever writes, tests, signs and ships a plugin for Mosaikit, without the source code of the
platform. They are written against the code (manifest parser, SDK, UI package, command-line tool) and follow
plugin API 1. Italian versions: [it/](it/README.md).

Start with [Getting started](getting-started.md), then read the reference you need.

| Document | For |
|---|---|
| [Getting started](getting-started.md) | Install the kit, make a first plugin, the development loop |
| [Concepts](concepts.md) | Tenants, roles, ownership and sharing, resources, settings, what a plugin may and may not do |
| [Manifest reference](manifest.md) | Every field of `plugin.toml`, with its rule; the five kinds |
| [Logic reference](logic.md) | ABI, commands, hooks, host operations, errors, limits, `MockHost` |
| [UI reference](ui.md) | `Msk` client, `mountCrud`, `gridTable`, `emptyState`, `pageHead`, theme, i18n, accessibility |
| [Data](data.md) | Migrations on PostgreSQL and SQLite, the security context, RLS, the SQL guard |
| [Security](security.md) | Origins and CSP, permissions, what is signed, secrets, untrusted content |
| [Extensions and layouts](extensions-layouts.md) | Extend another plugin; write a layout or a language pack |
| [UI guidelines](ui-guidelines.md) | The rules of the shell that apply to plugin pages |
| [Packaging and signing](packaging.md) | `.mskp`, keys, trusted keys, blocklist, versions, updates, the registry index |
| [Developer signing](signing.md) | Make a key, trust a publisher, revoke a key |
| [Releasing the kit](releasing.md) | The kit archives, checking a download, `self-update`, `cargo install`, a private registry |
| [Testing](testing.md) | Unit tests, `validate --strict`, `@mosaikit/plugin-testing`, CI recipes |
| [Troubleshooting](troubleshooting.md) | The errors the kernel and the tools return, with cause and fix |
| [Changelog and compatibility](changelog.md) | Versions of kit, platform, SDK and UI API; deprecations |

**Examples.** `mosaikit-plugin new <name> --example todo|insights|note-priority` makes a complete commented plugin
with a `WALKTHROUGH.md` (source: `crates/plugin-cli/templates/examples`).

**Where the truth is.** The architecture of the platform is [../architecture.md](../architecture.md) (§8 plugins,
§8.11 plugin API 1, §8.12 developer profile). These documents repeat what a plugin author needs and point there for
the rest. Where a feature has no official sample yet it is marked *experimental*: API 1 does not promise it will stay
as it is (architecture §8.11).

**API reference generated from the sources** (`cargo doc -p mosaikit-plugin-sdk --no-deps`, and TypeDoc on
`ui/plugin-api`) is published with the kit (`cargo xtask release devkit --api-docs` adds the SDK reference to `docs/api/sdk`); these documents are written by hand.

Plan of the kit: [../plugin-devkit-plan.md](../plugin-devkit-plan.md).
