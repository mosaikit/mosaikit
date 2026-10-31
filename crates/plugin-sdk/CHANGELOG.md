# Changelog of mosaikit-plugin-sdk

Versions follow the plugin API: see `docs/architecture.md` §8.11 of Mosaikit. A deprecated item stays for one major
version and is removed in the next.

## 1.0.0

First version of the plugin API (API 1).

- `Error` is a struct with `message` and an optional `code` (`Error::coded`, `Error::with_code`): the code
  reaches the UI of the plugin as `BridgeError.code`. It replaces the old tuple struct `Error(String)`: build
  errors with `Error::msg`, `Error::coded` or `.into()` from a string.
- `Ctx` is `#[non_exhaustive]`.
- `abi`, `Registry`, `CommandFn` and `HookFn` are `#[doc(hidden)]`: they are the plumbing of `plugin!`.
- `Values::bool` reads `true`, `1` and `yes` (the Italian words are gone).
- `testing::MockHost::command_err` returns the whole error, code included.
- Own version, `README.md` and `CHANGELOG.md`; the manifest declares the API with `[requires] api = 1`.
