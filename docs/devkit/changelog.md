# Changelog and compatibility

## Versions at a glance

One version number for the whole kit, on the cadence of the platform (decision D6 of the plan). The packages that carry
the plugin API also have a version of their own, with a changelog.

| Piece | Version | Changelog |
|---|---|---|
| Mosaikit (platform) | 1.0.0 | [CHANGELOG.md](../../CHANGELOG.md) |
| Dev kit (`mosaikit-plugin`, this documentation) | 1.0.0 (the version of the platform) | [crates/plugin-cli/CHANGELOG.md](../../crates/plugin-cli/CHANGELOG.md) |
| Plugin API | 1 | architecture §8.11 |
| Logic ABI | 1 | architecture §8.3 |
| SDK `mosaikit-plugin-sdk` | 1.0.0 | [crates/plugin-sdk/CHANGELOG.md](../../crates/plugin-sdk/CHANGELOG.md) |
| UI package `@mosaikit/plugin-api` | 1.0.0 | [ui/plugin-api/CHANGELOG.md](../../ui/plugin-api/CHANGELOG.md) |
| Test helpers `@mosaikit/plugin-testing` | 1.0.0 | [ui/plugin-testing/CHANGELOG.md](../../ui/plugin-testing/CHANGELOG.md) |
| Package format `.mskp` | 3 | architecture §8.5 |
| Manifest | v3 | [Manifest reference](manifest.md) |

## Updating the kit

`mosaikit-plugin self-update` brings an installed kit to the latest release (see [Releasing the kit](releasing.md)). Every
release has release notes with a **Breaking changes** section (a `### Breaking changes` heading in the changelog of the
component that breaks); `self-update` shows it and asks for `--yes` when it is not empty or the major version changes.
Each release also carries `COMPATIBILITY.md`, generated from the manifests.

## Which versions work together

| Plugin built for | Platform | SDK | UI package | Result |
|---|---|---|---|---|
| plugin API 1, `[requires] mosaikit = ">=1.0, <2"` | 1.x | 1.x | 1.x | works |
| plugin API 1 | 1.x | newer 1.x | newer 1.x | works: a minor version adds, a patch fixes |
| plugin API 2 | 1.x | | | refused: `plugin_incompatible` (the platform speaks API 1) |
| plugin API 1 | a platform that speaks API 2 | | | the host speaks every API up to its own, so it keeps working |
| a UI package newer than the shell's API | older shell | | | `incompatible_api`, the page may show its own message |
| no `[requires]` | any | | | works on any version: a warning, and no protection on upgrade |

Rules:

- A plugin declares `[requires] mosaikit` (a range) and `api` (an integer). The kernel refuses a plugin outside the range
  or built for another API, with one error that names both ([Troubleshooting](troubleshooting.md)).
- The plugin API is an integer that grows only with a breaking change. A release of Mosaikit that changes it raises the
  SDK and the UI package together. The host speaks every API up to its own; a plugin built for a newer one is refused with
  `incompatible_api`; a host or a plugin that predates the handshake counts as API 1.
- A kernel that does not know `[requires]` rejects the manifest (unknown keys are refused): release the kernel that reads a
  key before the first plugin that uses it.
- Build the logic with the SDK of the major version of the API you declare, and pin the UI package with `^1.0.0`.

## Deprecation rule

A deprecated item (manifest key, SDK function, UI export or event) **stays for one major version** of the API, is marked
`@deprecated` (or `#[deprecated]`) with what replaces it, logs a warning in development where it can (the kernel does for
manifest keys), appears in the changelog of its package, and is removed in the next major version.

### Deprecated in API 1

| Item | Replace with | Removed in |
|---|---|---|
| manifest key `abi` | `[requires] api` | API 2 |
| manifest key `min_kernel` | `[requires] mosaikit = ">=1.2, <2"` | API 2 |
| the `theme` event | `context` (`msk.onContext`) | API 2 |
| the emoji `[contribution]` (now optional) | `name` and `icon` | API 2 |

## Experimental in API 1

Part of the surface has kernel tests but no official sample plugin yet, so API 1 does **not** promise it will stay as it
is until a sample (or a template of the kit) uses it. A change to one of them is announced in the changelog of the
package, with the deprecation rule applied when a distribution relies on it. Experimental:

- `[[config]]` and `ctx.setting`
- `[[user_permissions]]` and `ctx.can`
- `[permissions] calls` and `plugin.call` (`ctx.call_plugin`)
- `ctx.notify` and `msk.notify`
- `network` and `http.fetch`
- `script_eval`
- `[search]`
- the `command` actions of an extension
- `CrudOptions.panel`
- `Resources::create` and `Resources::delete` of the SDK (`resource.create`, `resource.delete`)
- `msk.web` (permission `web`)

The `insights` example now uses `[search]` and `note-priority` the `set` actions of an extension; architecture §8.11 still lists them as experimental until the owner takes them off the list (a decision for a release, not for these documents).

## Changes by package

Read the changelog of each package when you upgrade. In short, for the first release:

- **SDK 1.0.0** — `Error` is a struct with a code (`Error::coded`); `Ctx` is `#[non_exhaustive]`; `abi`, `Registry` are
  `#[doc(hidden)]`; `Values::bool` reads `true`, `1`, `yes`. Unreleased: `Ctx::files()` (needs `files_read`); host
  errors keep their `code`.
- **`@mosaikit/plugin-api` 1.0.0** — the version handshake (`API_VERSION`, `msk.api`, `isIncompatible`), typed `ErrorCode`,
  `HostEvents`, explicit exports (`Bridge`, `applyTheme`, `emptyArt`… are no longer exported), `ResourceMeta`.
- **`mosaikit-plugin` 1.0.0** — `new` (variants, examples), `build`, `test`, `validate --strict`, `pack`, `sign`, `keygen`,
  `install`, `doctor`, `dev`.
- **`@mosaikit/plugin-testing` 1.0.0** — `startDevServer`, `attachDevServer`, `signIn`, `openPlugin`, `createItem`, the axe
  helpers.

## This documentation

Written for plugin API 1 and kit 1.0.0. When a release changes the API, this page gets a row in the tables above, the
affected documents change, and the Italian versions follow.
