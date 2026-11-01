# Logic reference

The logic of a plugin is Rust compiled to WebAssembly (`wasm32-unknown-unknown`) with the crate
`mosaikit-plugin-sdk`. It is optional: a plugin with only resources and a UI needs none. Source:
`crates/plugin-sdk`, runtime `crates/runtime`, host side `crates/kernel/src/host.rs`. Architecture §8.3.

## Anatomy

```rust
use mosaikit_plugin_sdk::prelude::*;

fn before_create(ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
    let mut v = hook.values.clone();
    if v.str("tag").is_empty() { v.set("tag", "personal"); }
    Ok(Some(v))                       // Some: change the values; None: leave them; Err: refuse
}

fn count_by_tag(ctx: &Ctx, _args: Value) -> Result<Value> {
    Ok(Value::Array(ctx.db().query("select tag, count(*) as n from notes group by tag", &[])?))
}

mosaikit_plugin_sdk::plugin! {
    hooks: { "notes.before_create" => before_create },
    commands: { "notes.count_by_tag" => count_by_tag },
}
```

`Cargo.toml` has `crate-type = ["cdylib", "rlib"]` and depends on the SDK; the template has it. On `wasm32` the macro
generates the exports of the ABI; on other targets the logic is tested with `MockHost` (below).

## ABI v1

The runtime is **wasmi** (a pure Rust interpreter): a **new instance for every call**, an instruction limit (fuel), a
memory limit, no WASI (no files, no network, no clock except through the host). You do not write this by hand; the SDK
does.

| Side | Symbol | Meaning |
|---|---|---|
| plugin export | `msk_alloc(len) -> ptr` | allocation in the memory of the guest |
| plugin export | `msk_call(ptr, len) -> i64` | incoming JSON message; answer `(ptr << 32) \| len` |
| host import | `msk.host_call(ptr, len) -> i32` | JSON request to the host; length of the answer (negative: error) |
| host import | `msk.host_read(ptr)` | copies the pending answer into the guest |
| host import | `msk.log(ptr, len)` | log |

Incoming: `{"abi":1,"kind":"command","name":…,"args":…,"ctx":…}` or
`{"abi":1,"kind":"hook","hook":"before_create"|"before_update"|"after_delete","resource":…,"id":…,"values":…,"previous":…}`.
Answer: `{"ok":…}` or `{"err":"…","code":"…"}`.

## Commands

A command is a function `fn(&Ctx, Value) -> Result<Value>` registered under a name. The UI calls it with
`msk.call("notes.count_by_tag", args)`, another plugin with `ctx.call_plugin(...)`. Names are free strings; use
`<resource-or-plugin>.<verb>`. An unknown name is the error `unknown command: <name>`. A command runs in one
transaction: an error rolls back everything it did.

## Hooks

A hook is registered as `"<resource>.<hook>"` and runs **in the same transaction** as the operation, with the values:

| Hook | When | Result |
|---|---|---|
| `before_create` | before a row is created | `Some(values)` replaces the values, `None` keeps them, `Err` refuses and rolls back |
| `before_update` | before a change; `hook.previous` has the old values | same |
| `after_delete` | after a row is deleted | `Err` rolls back the delete |

The resource must be listed in `[permissions] hooks`; `validate --strict` fails a hook that is listed and never
registered. `Hook` has `hook`, `resource`, `id`, `values`, `previous`. `Values` reads `str`, `f64`, `bool` (`true`,
`1`, `yes`), `get`, and writes `set`, `remove`.

## Context

`ctx: &Ctx` (`#[non_exhaustive]`; build one in tests with `Ctx::default()`):

| Field or method | What |
|---|---|
| `ctx.user`, `ctx.username`, `ctx.tenant` | ids and name of the caller |
| `ctx.plugin` | this plugin id |
| `ctx.perms`, `ctx.can("key")` | permissions of the caller: `use`, `create`, `delete`, `share` and the `[[user_permissions]]` they have |
| `ctx.groups` | the groups of the tenant the caller belongs to, `[{id, name}]` (empty when none), read at every call |
| `ctx.config`, `ctx.setting("key")` | the `[[config]]` settings of the platform (`None` when not set; secrets included, never send them to the UI) |
| `ctx.log("text")` | a line in the server log |

## Host operations

`ctx.<area>()` sends a JSON request `{"op": …, "req": …}`; the operation goes to the host, which runs it as the caller
with the checks below. Permissions are the `[permissions]` of the manifest.

| Operation | SDK | Needs | Answer |
|---|---|---|---|
| `db.query` | `ctx.db().query(sql, &params)`, `query_one` | | rows as JSON objects |
| `db.exec` | `ctx.db().exec(sql, &params)` | | number of rows |
| `resource.create` | `ctx.resources().create(kind, title, parent)` | | the id (experimental) |
| `resource.delete` | `ctx.resources().delete(id)` | manage level | nothing (experimental) |
| `http.fetch` | `ctx.http().get(url)`, `fetch(method, url, body)`, `fetch_with_key(…, service)` | `network` or an address service | `{status, body}` (experimental) |
| `key.get` | `ctx.service_key("id")` | `[[service_keys]]` | the key in use, or `None` |
| `notify` | `ctx.notify(&Notice)` | `notify = true` | nothing (experimental) |
| `plugin.call` | `ctx.call_plugin(plugin, name, args)` | `calls` | the result (experimental) |
| `files.list`, `files.describe`, `files.read` | `ctx.files().list(parent)`, `describe(id)`, `read(id, max_bytes)` | `files_read = true` | rows, see below |

### `db`

`query` runs `SELECT`, or `INSERT/UPDATE/DELETE` with `RETURNING`; `exec` runs DML without `RETURNING`. Parameters
`$1..$n` are text, numbers, bool or null: cast in SQL (`$1::uuid`). One statement per call; the **SQL guard** accepts
only `SELECT/INSERT/UPDATE/DELETE` (and `WITH`), no `SET`, system functions or other schemas, and the statement runs with
the role of the plugin: row level security filters the rows ([Data](data.md)). `db.query` on a statement that does not
produce rows says `db.query requires SELECT or RETURNING: use db.exec`. Statements run under a savepoint, so an SQL
error does not poison the transaction.

### `http`

Methods `GET`, `POST`, `PUT`, `DELETE`; the origin must be in `permissions.network` or be the address an
Administrator set for an `address = true` service key; only public addresses are reached (the deployer may exempt
private destinations for origins the plugin declares); the body is returned as text, at most 4 MiB. `fetch_with_key` adds
`Authorization: Bearer <key>` for a service of `[[service_keys]]`: the logic never reads the key. Errors: `origin not
declared in permissions.network: <origin>`, `method not allowed: <m>`, `no key of the service <s> is set`,
`HTTP response over 4 MB`.

### `notify`

```rust
ctx.notify(&Notice::new("Due today").body("Site visit").at("notes/1").resource(&id))?;
```

`title` is required (cut to 160 characters), `body` optional (600). The plugin never names recipients: without
`resource` the notification goes to the caller alone; with the id of an item of the same plugin and tenant on which the
caller has the write level, it goes to the people who can see the item, the caller excluded. `at` is a place inside the
plugin (letters, digits and `/_-.=&?%:`, up to 200): the link is always `#/t/<tenant>/p/<plugin>/<at>`. Limit: 30 a
minute for each person and plugin. A wrong shape or the limit fail the call at once; recipients are resolved and the
notification sent after the operation commits, so a rolled back operation notifies nobody.

### `call_plugin`

The called plugin must be in `[permissions] calls`. The command runs with the **same user and tenant**, in a transaction
of its own and with its own role and rules; it may call others up to **3 levels**. It needs PostgreSQL: on SQLite the
error is `plugin.call requires PostgreSQL`. Errors: `plugin not declared in permissions.calls: <id>`,
`too many nested calls between plugins`.

### `files`

Reads the Files area with the permissions of the **caller**, the rules the Files UI applies: no one sees more than in the
UI, a public link is not a caller. `files.list {parent?}` answers `{entries, truncated}` (at most 1000 rows);
`files.describe {id}` one row; `files.read {id, max_bytes?}` answers `{entry, base64, size, truncated}`, with `max_bytes`
cut at 4 MiB. A row has `id, name, is_dir, size, mime, created, modified, owner_id, owner_name, my_level, shared,
parent_id` and never a storage path.

### Groups and the web

`ctx.groups` (above) is the way to read groups; there is no operation. `msk.web.probe` (permission `web`) belongs to the
UI ([UI reference](ui.md)); the logic has `http.fetch` for the web.

## Errors

```rust
Err(Error::coded("invoice_locked", "The invoice is closed"))   // a code and the text for the person
Err(Error::msg("something went wrong"))                        // no code
Err("text".into())                                             // the same
```

`Error` is a struct with `message` and `code: Option<String>` (`#[non_exhaustive]`; build it with `msg`, `coded`,
`with_code`). A code is `[a-z][a-z0-9_]*`, at most 48 characters. An error **rolls back the transaction**. The shell
shows the message (error code `plugin_error`); the UI of the plugin gets your code as `BridgeError.code` and can react
without parsing the text. Switch on codes, never on text.

An error of a host operation is an `Error` too. The `files` operations carry a stable code, which a logic that returns
the error unchanged gives to its UI:

| Code | Cause |
|---|---|
| `permission_denied` | the manifest has no `files_read` (or the caller may not) |
| `not_found` | missing, or not visible to the caller: the two cannot be told apart |
| `invalid_argument` | bad id, a folder given to `files.read`, bad `max_bytes` |
| `internal` | anything else |

If the logic itself fails, the kernel answers with: `instruction limit exceeded`, `the plugin ended with an error: <trap>`
(a panic or a wasm trap), `invalid message from the plugin: <why>` (for example `answer too large`), `invalid WASM
module: <why>`.

## Limits

| Limit | Value |
|---|---|
| instructions (fuel) | 2,000,000,000 per command; 500,000,000 per hook |
| memory of the guest | 64 MiB |
| size of a message (in or out) | 16 MiB |
| `http.fetch` response | 4 MiB |
| nested `plugin.call` | 3 levels |
| `files.list` | 1000 rows; `files.read` 4 MiB |
| `notify` | 30 a minute per person and plugin; title 160, body 600, `at` 200 |
| SQL statement time on PostgreSQL | 15 s (`statement_timeout` of the role) |
| error code | 48 characters |

A new instance per call means no state survives between calls: keep state in the database.

## `MockHost`: native tests

`mosaikit_plugin_sdk::testing::MockHost` runs commands and hooks natively, against answers you program. The guard of the
server is not there; `validate --strict` checks migrations and the server checks queries.

```rust
use mosaikit_plugin_sdk::testing::MockHost;

let host = MockHost::new().on("db.query", |req| {
    assert_eq!(req["params"][0], "work");
    Ok(json!([{ "tag": "work", "n": 2 }]))
});
let out = host.command(&__msk_registry(), "notes.count_by_tag", json!({}));
assert_eq!(out.unwrap()[0]["n"], 2);
```

| Method | Use |
|---|---|
| `on(op, f)` | the answer to a host operation; an operation with no answer fails with `MockHost: no answer for <op>` (except `notify`, accepted) |
| `with_perms(&[…])` | `ctx.perms` (default the four standard ones) |
| `with_groups(&[(id, name)])` | `ctx.groups` |
| `with_plugin_command(plugin, name, f)` | what `call_plugin` returns |
| `deny(op, message)` | the host refuses an operation, as when the permission is not in the manifest |
| `with_files(vec![FakeFile::folder(..), FakeFile::file(..).in_folder(..)])` | the Files area for `files.*` |
| `command(reg, name, args)`, `command_err(..)`, `hook(reg, hook, resource, values)` | run it; `command_err` keeps the whole error with its code |
| `calls()`, `notifications()`, `logs()` | what the logic asked, sent and logged |

More recipes in [Testing](testing.md).
