# Changelog of mosaikit-plugin-sdk

Versions follow the plugin API: see `docs/architecture.md` §8.11 of Mosaikit. A deprecated item stays for one major
version and is removed in the next.

## Unreleased

- `Directory::users_with(permission, q, limit)` (host operation `directory.search` with `permission`): the active members of the tenant who hold a permission of the plugin (a key of `[[user_permissions]]` or a standard one) through their profile, a grant or a group, and the Tenant Managers; up to 200, `q` may be empty. Same rights as `users` (`[permissions] directory = true`, Tenant Manager or `share`). `testing::MockHost::with_directory_holders` for the tests. Additive.

- A public command declared with `write = true` (`[[public_commands]]`) may `db.exec` an `INSERT` into the tables declared with `[[tables]] insert_for = "visitor"`; nothing else changes in `Ctx` (`ctx.public` is still true, there is still no user). Additive.

- `testing::MockHost::hook_with_previous(reg, hook, resource, values, previous)`: runs an update hook with the values before the change (`hook` is the same with none). Test helper only.

- `Ctx::runs()` and `Runs::mint(&RunMint)` (host operation `runs.mint`): a ticket for the plugin and, with `RunTarget`, for the other plugins it declares in `[permissions] run_targets`; written when the command has committed. Plugin API unchanged (additive).

- `Resources::list(plugin, kind, q, limit)` (host operation `resources.list`): the resources of another plugin that the caller sees, for a
  picker; needs the plugin in `[permissions] resources_read` and `[requires] mosaikit = ">=1.0"`. `Resources::contributions(point)` (host
  operation `contributions.list`): the plugins that contribute to a point declared in `[permissions] contributions`, which can then be called
  with `plugin.call`. Plugin API unchanged (additive).
- `OnBehalf::schedule` and `schedule_id`: `Some` when a schedule of the plugin (`[[schedules]]`) started the run; `None` for a run
  a person started. `MockHost::scheduled(name, run_ref)` tests it. Needs `[requires] mosaikit = ">=1.0"`; plugin API unchanged.
- `Ctx::directory()` (`Directory::users`, `Directory::groups`, `DirectoryUser`): search the people and groups of the tenant; needs
  `[permissions] directory = true` and `[requires] mosaikit = ">=1.0"`; plugin API unchanged. `MockHost::with_directory(users, groups)`
  answers like the real host.
- `Ctx::public` and `Ctx::link_resource()`: set when a visitor of a public link runs a command listed in
  `[[public_commands]]` (no user, `config` without secrets, `link_resource` is the only item to work on).
  `MockHost::as_public(item_id)` tests it. Needs `[requires] mosaikit = ">=1.0"`; plugin API unchanged.
- `Ctx::on_behalf()` (`OnBehalf { run_ref }`): `Some` when the command is called on behalf of a run ticket
  (`[permissions] run_commands`); `MockHost::on_behalf(run_ref)` tests it. Needs `[requires] mosaikit = ">=1.0"`; plugin API
  unchanged.
- `Ctx::files()` (`Files::list`, `describe`, `read`): read the Files area with the permissions of the caller;
  needs `[permissions] files_read = true`. `read` is capped at 4 MiB and returns the bytes as base64.
- An error of a host operation keeps its `code`: `Error::coded` instead of `Error::msg` (e.g. `permission_denied`).

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
