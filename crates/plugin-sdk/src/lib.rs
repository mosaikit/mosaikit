//! SDK for the logic of Mosaikit plugins.
//!
//! ```ignore
//! use mosaikit_plugin_sdk::prelude::*;
//!
//! fn before_create(ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
//!     let mut v = hook.values.clone();
//!     if v.str("tag").is_empty() { v.set("tag", "personal"); }
//!     ctx.log("default tag applied");
//!     Ok(Some(v))
//! }
//!
//! fn count_by_tag(ctx: &Ctx, _args: Value) -> Result<Value> {
//!     Ok(Value::Array(ctx.db().query("select tag, count(*) as n from notes group by tag", &[])?))
//! }
//!
//! mosaikit_plugin_sdk::plugin! {
//!     hooks: { "notes.before_create" => before_create },
//!     commands: { "notes.count_by_tag" => count_by_tag },
//! }
//! ```
//!
//! On the `wasm32` target the macro generates the exports of the ABI; on the other targets
//! the logic is tested with [`testing`] and a simulated host.

#![allow(unsafe_code)] // the WASM ABI requires raw pointers: confined to `abi`

#[doc(hidden)]
pub mod abi;
mod host;
pub mod testing;
mod values;

pub use serde_json::{self, json, Map, Value};
pub use values::Values;

pub mod prelude {
    pub use crate::{json, Ctx, Error, Group, Hook, Notice, Result, Value, Values};
}

/// Error returned to the kernel: it rolls back the transaction of the operation.
///
/// `message` is shown to the person; the optional `code` is a stable name of the error (`[a-z][a-z0-9_]*`,
/// at most 48 characters, e.g. `invoice_locked`) that reaches the UI of the plugin as `BridgeError.code`,
/// so the UI can react or translate without parsing the text.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct Error {
    pub message: String,
    pub code: Option<String>,
}

impl Error {
    pub fn msg(m: impl Into<String>) -> Error {
        Error { message: m.into(), code: None }
    }
    /// An error with a code: `Error::coded("invoice_locked", "the invoice is closed")`.
    pub fn coded(code: &str, m: impl Into<String>) -> Error {
        Error { message: m.into(), code: Some(code.to_string()) }
    }
    /// The same error with a code.
    pub fn with_code(mut self, code: &str) -> Error {
        self.code = Some(code.to_string());
        self
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for Error {}

impl From<String> for Error {
    fn from(s: String) -> Error {
        Error::msg(s)
    }
}
impl From<&str> for Error {
    fn from(s: &str) -> Error {
        Error::msg(s)
    }
}
impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Error {
        Error::msg(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// Context of the call: who makes it, in which tenant, for which plugin.
/// New fields may appear in a minor version: build one with `Ctx::default()`, never with a literal.
#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize, serde::Serialize)]
#[non_exhaustive]
pub struct Ctx {
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub tenant: Option<String>,
    #[serde(default)]
    pub plugin: String,
    /// Permissions of the caller in the plugin: the standard ones of the kernel (`use`, `create`,
    /// `delete`, `share`) and the `[[user_permissions]]` of the manifest that the caller has.
    #[serde(default)]
    pub perms: Vec<String>,
    /// Groups of the tenant the caller belongs to, by name (empty when none).
    #[serde(default)]
    pub groups: Vec<Group>,
    /// Settings of the plugin chosen by the Administrator (`[[config]]` of the manifest), secrets
    /// included: key -> value (`null` when not set).
    #[serde(default)]
    pub config: serde_json::Value,
}

/// A group of the tenant the caller belongs to (`ctx.groups`).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct Group {
    pub id: String,
    pub name: String,
}

/// A notification of the logic (`ctx.notify`). The plugin never names the recipients: with `resource`
/// they are the people who can see that item of the plugin (the caller needs the write level on it, the
/// caller is left out); without it, the caller alone.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct Notice {
    pub title: String,
    pub body: String,
    /// a place inside the plugin (e.g. `notes/2f1c...`): letters, digits and `/_-.=&?%:`, at most 200
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    /// id of an item of the plugin
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
}

impl Notice {
    pub fn new(title: &str) -> Notice {
        Notice { title: title.into(), ..Notice::default() }
    }
    pub fn body(mut self, body: &str) -> Notice {
        self.body = body.into();
        self
    }
    pub fn at(mut self, at: &str) -> Notice {
        self.at = Some(at.into());
        self
    }
    /// Notify the people who can see this item instead of the caller.
    pub fn resource(mut self, id: &str) -> Notice {
        self.resource = Some(id.into());
        self
    }
}

impl Ctx {
    /// The caller has the permission `key` (a `[[user_permissions]]` of the manifest, or a standard one).
    pub fn can(&self, key: &str) -> bool {
        self.perms.iter().any(|p| p == key)
    }

    /// A setting of the plugin (`[[config]]`), if it has a value.
    pub fn setting(&self, key: &str) -> Option<&serde_json::Value> {
        self.config.get(key).filter(|v| !v.is_null())
    }
    pub fn db(&self) -> Db {
        Db(())
    }
    pub fn resources(&self) -> Resources {
        Resources(())
    }
    pub fn http(&self) -> Http {
        Http(())
    }
    /// The Files area, read with the permissions of the caller (needs `[permissions] files_read = true`).
    pub fn files(&self) -> Files {
        Files(())
    }
    pub fn log(&self, msg: &str) {
        host::log(msg);
    }
    /// The key of an outside service (declared in `[[service_keys]]` of the manifest) in use for the
    /// caller: their own, else the tenant's, else the platform's; `None` when there is none. Never
    /// send it to the UI.
    pub fn service_key(&self, service: &str) -> Result<Option<String>> {
        match host::call("key.get", serde_json::json!({ "service": service }))? {
            Value::String(s) => Ok(Some(s)),
            _ => Ok(None),
        }
    }
    /// Notifies the caller or the people who see an item (needs `[permissions] notify = true`). Rules
    /// and limits are the ones of `msk.notify` in the UI (30 a minute per person and plugin, title 160
    /// and text 600 characters). The notification is sent when the operation commits: if it fails and
    /// rolls back, nobody is notified. A refusal on the item (no write level, other plugin) does not
    /// fail the operation: it is logged.
    pub fn notify(&self, n: &Notice) -> Result<()> {
        host::call("notify", serde_json::to_value(n)?)?;
        Ok(())
    }
    /// Command of another plugin (declared in `permissions.calls`), with the
    /// same user: the called plugin applies its own access rules.
    pub fn call_plugin(&self, plugin: &str, name: &str, args: Value) -> Result<Value> {
        host::call("plugin.call", serde_json::json!({ "plugin": plugin, "name": name, "args": args }))
    }
}

/// SQL access to the schema of the plugin. The queries go through the guard of the kernel and
/// run with the role of the plugin: Row-Level Security filters the rows.
pub struct Db(());

impl Db {
    /// `SELECT` (or DML with `RETURNING`): rows as JSON objects.
    /// The parameters `$1..$n` are text/numbers/bool/null: cast in SQL (`$1::uuid`).
    pub fn query(&self, sql: &str, params: &[Value]) -> Result<Vec<Value>> {
        match host::call("db.query", json!({ "sql": sql, "params": params }))? {
            Value::Array(rows) => Ok(rows),
            other => Err(Error::msg(format!("unexpected answer: {other}"))),
        }
    }

    /// First row, if any.
    pub fn query_one(&self, sql: &str, params: &[Value]) -> Result<Option<Value>> {
        Ok(self.query(sql, params)?.into_iter().next())
    }

    /// `INSERT/UPDATE/DELETE` without `RETURNING`: number of rows affected.
    pub fn exec(&self, sql: &str, params: &[Value]) -> Result<u64> {
        let v = host::call("db.exec", json!({ "sql": sql, "params": params }))?;
        Ok(v.get("rows").and_then(Value::as_u64).unwrap_or(0))
    }
}

/// Resources of the kernel (ownership, sharing, hierarchy).
pub struct Resources(());

impl Resources {
    /// Creates a resource of the plugin: owner = user of the call.
    pub fn create(&self, kind: &str, title: &str, parent: Option<&str>) -> Result<String> {
        let v = host::call("resource.create", json!({ "kind": kind, "title": title, "parent": parent }))?;
        v.as_str().map(str::to_string).ok_or_else(|| Error::msg("missing resource id"))
    }

    /// Deletes a resource (the manage level is required).
    pub fn delete(&self, id: &str) -> Result<()> {
        host::call("resource.delete", json!({ "id": id }))?;
        Ok(())
    }
}

/// Read access to the Files area as the caller sees it (host operations `files.list`, `files.describe`,
/// `files.read`). A file the caller does not see is `not_found`, the same as one that does not exist.
/// Errors carry a code: `permission_denied` (no `files_read` in the manifest), `not_found`,
/// `invalid_argument`. Rows have `id`, `name`, `is_dir`, `size`, `mime`, `created`, `modified`,
/// `owner_id`, `owner_name`, `my_level`, `shared` and `parent_id`; never a storage path.
pub struct Files(());

impl Files {
    /// Rows the caller sees in a folder (the root if `None`): `{ "entries": [...], "truncated": bool }`
    /// (at most 1000 rows).
    pub fn list(&self, parent: Option<&str>) -> Result<Value> {
        host::call("files.list", json!({ "parent": parent }))
    }
    /// Metadata of one file or folder.
    pub fn describe(&self, id: &str) -> Result<Value> {
        host::call("files.describe", json!({ "id": id }))
    }
    /// The first `max_bytes` of a file (at most 4 MiB, whatever is asked):
    /// `{ "entry": {...}, "base64": "...", "size": <bytes returned>, "truncated": bool }`.
    pub fn read(&self, id: &str, max_bytes: usize) -> Result<Value> {
        host::call("files.read", json!({ "id": id, "max_bytes": max_bytes }))
    }
}

/// HTTP towards the origins declared in `permissions.network` (and the address of an address service of
/// `[[service_keys]]`) only, through the host: public addresses only.
pub struct Http(());

#[derive(Debug, Clone, PartialEq)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

impl HttpResponse {
    pub fn json(&self) -> Result<Value> {
        Ok(serde_json::from_str(&self.body)?)
    }
}

impl Http {
    pub fn get(&self, url: &str) -> Result<HttpResponse> {
        self.fetch("GET", url, None)
    }

    pub fn fetch(&self, method: &str, url: &str, body: Option<&str>) -> Result<HttpResponse> {
        self.send(json!({ "method": method, "url": url, "body": body }))
    }

    /// Like [`Http::fetch`], and the host adds the key of the service `service` (declared in
    /// `[[service_keys]]`) in use for the caller as `Authorization: Bearer ...`: the logic never reads it.
    /// Fails if no key is set. The address is an origin of `permissions.network` or the one the
    /// Administrator set for an address service of `[[service_keys]]`.
    pub fn fetch_with_key(
        &self,
        method: &str,
        url: &str,
        body: Option<&str>,
        service: &str,
    ) -> Result<HttpResponse> {
        self.send(json!({ "method": method, "url": url, "body": body, "key": service }))
    }

    fn send(&self, req: Value) -> Result<HttpResponse> {
        let v = host::call("http.fetch", req)?;
        Ok(HttpResponse {
            status: v.get("status").and_then(Value::as_u64).unwrap_or(0) as u16,
            body: v.get("body").and_then(Value::as_str).unwrap_or_default().to_string(),
        })
    }
}

/// Hook on a CRUD resource.
#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct Hook {
    /// `before_create`, `before_update`, `after_delete`
    pub hook: String,
    pub resource: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub values: Values,
    /// previous values (`before_update` only)
    #[serde(default)]
    pub previous: Option<Values>,
}

#[doc(hidden)]
pub type CommandFn = fn(&Ctx, Value) -> Result<Value>;
/// Returns `Some(values)` to change them, `None` to leave them as they are, `Err` to refuse.
#[doc(hidden)]
pub type HookFn = fn(&Ctx, &Hook) -> Result<Option<Values>>;

/// Commands and hooks of the plugin (generated by [`plugin!`]).
#[doc(hidden)]
pub struct Registry {
    pub commands: &'static [(&'static str, CommandFn)],
    pub hooks: &'static [(&'static str, HookFn)],
}

impl Registry {
    /// Handles a message of the kernel and produces the answer `{"ok":..}` / `{"err":..}`.
    pub fn dispatch(&self, msg: &Value) -> Value {
        match self.dispatch_inner(msg) {
            Ok(v) => json!({ "ok": v }),
            Err(e) => match e.code {
                Some(code) => json!({ "err": e.message, "code": code }),
                None => json!({ "err": e.message }),
            },
        }
    }

    fn dispatch_inner(&self, msg: &Value) -> Result<Value> {
        let ctx: Ctx =
            serde_json::from_value(msg.get("ctx").cloned().unwrap_or(Value::Null)).unwrap_or_default();
        match msg.get("kind").and_then(Value::as_str) {
            Some("command") => {
                let name = msg.get("name").and_then(Value::as_str).unwrap_or_default();
                let f = self
                    .commands
                    .iter()
                    .find(|(n, _)| *n == name)
                    .ok_or_else(|| Error::msg(format!("unknown command: {name}")))?
                    .1;
                f(&ctx, msg.get("args").cloned().unwrap_or(Value::Null))
            }
            Some("hook") => {
                let hook: Hook = serde_json::from_value(msg.clone())?;
                let key = format!("{}.{}", hook.resource, hook.hook);
                match self.hooks.iter().find(|(n, _)| *n == key) {
                    Some((_, f)) => Ok(match f(&ctx, &hook)? {
                        Some(v) => json!({ "values": v }),
                        None => Value::Null,
                    }),
                    None => Ok(Value::Null),
                }
            }
            other => Err(Error::msg(format!("unknown message type: {other:?}"))),
        }
    }

    pub fn command_names(&self) -> Vec<&'static str> {
        self.commands.iter().map(|c| c.0).collect()
    }
}

/// Declares hooks and commands of the plugin and, on wasm32, generates the exports of the ABI.
#[macro_export]
macro_rules! plugin {
    (
        $( hooks: { $( $hk:literal => $hf:path ),* $(,)? } $(,)? )?
        $( commands: { $( $ck:literal => $cf:path ),* $(,)? } $(,)? )?
    ) => {
        pub fn __msk_registry() -> $crate::Registry {
            $crate::Registry {
                commands: &[ $( $( ($ck, $cf as $crate::CommandFn) ),* )? ],
                hooks: &[ $( $( ($hk, $hf as $crate::HookFn) ),* )? ],
            }
        }

        #[cfg(target_arch = "wasm32")]
        #[allow(unsafe_code)]
        #[no_mangle]
        pub extern "C" fn msk_alloc(len: i32) -> i32 {
            $crate::abi::alloc(len)
        }

        #[cfg(target_arch = "wasm32")]
        #[allow(unsafe_code)]
        #[no_mangle]
        pub extern "C" fn msk_call(ptr: i32, len: i32) -> i64 {
            $crate::abi::call(ptr, len, &__msk_registry())
        }
    };
}
