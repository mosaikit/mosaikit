# Changelog

## Unreleased

- `validate` refuses a table or key of `distribution.toml` that nobody reads (a typo such as `[quota_defaults]`), warns about a `[[nav_groups]]` plugin that is not in `include`, and, with `--base`, about an official plugin of `include` missing from the registry of the base (`test` passes its `--base` on). `START.txt` names the real first tenant.

## 1.0.0

- First version: `new`, `validate`, `dev`, `build desktop|docker|k8s`, `sign`, `doctor`.
