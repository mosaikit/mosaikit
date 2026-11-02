# Changelog of mosaikit-mskp

One version for the whole dev kit, the one of the platform.

## Unreleased

- Manifest: `[permissions] directory` (bool): the plugin may search the people and groups of the tenant. Additive: manifest v3 and
  plugin API 1 are unchanged; a plugin that uses it needs `[requires] mosaikit = ">=1.0"`.
- Manifest: `[[config]] public` (refused on `kind = "secret"`) and `[[public_commands]]` (`name`, `description`,
  `max_arg_bytes`, at most `MAX_PUBLIC_ARG_BYTES`). Additive: manifest v3 and plugin API 1 are unchanged; a plugin that
  uses them needs `[requires] mosaikit = ">=1.0"`.
- Manifest: `[permissions] run_commands` (identifiers, at most `MAX_RUN_COMMANDS`): the commands a run ticket may call.
  Additive: manifest v3 and plugin API 1 are unchanged; a plugin that uses it needs `[requires] mosaikit = ">=1.0"`.

## 1.0.0

First published version: manifest v3, package format 3, signatures, trusted keys, version ranges. Metadata for
`cargo install` of `mosaikit-plugin-cli` from a registry.
