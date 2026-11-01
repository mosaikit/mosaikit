//! Native tests of the logic of the plugins with a simulated host.
//!
//! ```ignore
//! use mosaikit_plugin_sdk::testing::MockHost;
//!
//! let host = MockHost::new().on("db.query", |_req| Ok(json!([{ "tag": "work", "n": 2 }])));
//! let out = host.command(&__msk_registry(), "notes.count_by_tag", json!({}));
//! assert_eq!(out, Ok(json!([{ "tag": "work", "n": 2 }])));
//! ```
//!
//! # Recipes
//!
//! Every host operation the logic calls needs an answer, or the call fails with `MockHost: no answer for <op>`
//! (the exception is `notify`, which is accepted). `host.calls()` lists what was asked, in order.
//!
//! ```ignore
//! // db.query / db.exec: check the SQL and its parameters, answer rows (the guard of the server is not here:
//! // `mosaikit-plugin validate --strict` checks the migrations, the server the queries)
//! let host = MockHost::new()
//!     .on("db.query", |req| {
//!         assert_eq!(req["params"][0], "work");
//!         Ok(json!([{ "id": "1", "title": "Plan" }]))
//!     })
//!     .on("db.exec", |_| Ok(json!({ "rows": 1 })));
//!
//! // notify: nothing to program; read what the logic sent. A refusal of the host is an error of the logic
//! assert_eq!(host.notifications()[0]["title"], "Created");
//! let refusing = MockHost::new().on("notify", |_| Err("too many notifications".into()));
//!
//! // call_plugin: the command of the other plugin, by plugin id and name
//! let host = MockHost::new().with_plugin_command("com.example.other", "other.total", |args| {
//!     Ok(json!({ "total": args["n"] }))
//! });
//!
//! // permissions: what the caller may do (`ctx.perms`: `use`, `create`, `delete`, `share` of the kernel and the
//! // `[[user_permissions]]` of the plugin); and an operation the host refuses (permission not declared in the manifest)
//! let reader = MockHost::new().with_perms(&["use"]);
//! let undeclared = MockHost::new().deny("files.read", "the plugin does not declare `files_read` in [permissions]");
//!
//! // files.list, files.describe, files.read: the Files area as the caller sees it
//! let host = MockHost::new().with_files(vec![
//!     FakeFile::folder("d1", "Reports"),
//!     FakeFile::file("f1", "notes.txt", b"hello").in_folder("d1"),
//! ]);
//! ```

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use serde_json::{json, Value};

use crate::{Ctx, Hook, Registry, Values};

type Handler = Box<dyn FnMut(&Value) -> Result<Value, String>>;

#[derive(Default)]
struct Inner {
    handlers: HashMap<String, Handler>,
    /// commands of other plugins, by (plugin id, command name), answered to `plugin.call`
    commands: HashMap<(String, String), Handler>,
    calls: Vec<(String, Value)>,
    logs: Vec<String>,
}

thread_local! {
    static CURRENT: RefCell<Option<Rc<RefCell<Inner>>>> = const { RefCell::new(None) };
}

/// A file or folder of the Files area in a test (`MockHost::with_files`).
#[derive(Debug, Clone)]
pub struct FakeFile {
    pub id: String,
    pub name: String,
    pub parent: Option<String>,
    pub is_dir: bool,
    pub content: Vec<u8>,
    pub mime: String,
}

impl FakeFile {
    pub fn folder(id: &str, name: &str) -> FakeFile {
        FakeFile {
            id: id.into(),
            name: name.into(),
            parent: None,
            is_dir: true,
            content: Vec::new(),
            mime: String::new(),
        }
    }

    pub fn file(id: &str, name: &str, content: &[u8]) -> FakeFile {
        FakeFile {
            id: id.into(),
            name: name.into(),
            parent: None,
            is_dir: false,
            content: content.to_vec(),
            mime: "application/octet-stream".into(),
        }
    }

    /// The folder it is in (the root when not called).
    pub fn in_folder(mut self, parent: &str) -> FakeFile {
        self.parent = Some(parent.into());
        self
    }

    pub fn mime(mut self, mime: &str) -> FakeFile {
        self.mime = mime.into();
        self
    }

    /// The row the host gives (no storage path, ever).
    fn entry(&self) -> Value {
        json!({
            "id": self.id, "name": self.name, "is_dir": self.is_dir, "size": self.content.len(),
            "mime": self.mime, "created": "2026-01-01T00:00:00Z", "modified": "2026-01-01T00:00:00Z",
            "owner_id": "00000000-0000-0000-0000-000000000001", "owner_name": "test", "my_level": 3,
            "shared": false, "parent_id": self.parent,
        })
    }
}

/// Standard base64 (the answer of `files.read`), without a dependency for a test helper.
fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in data.chunks(3) {
        let b = |i: usize| u32::from(*c.get(i).unwrap_or(&0));
        let n = (b(0) << 16) | (b(1) << 8) | b(2);
        for i in 0..4 {
            if i <= c.len() {
                out.push(T[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Simulated host: answers programmed per operation, log of calls and log messages.
#[derive(Clone, Default)]
pub struct MockHost {
    inner: Rc<RefCell<Inner>>,
    pub ctx: Ctx,
}

impl MockHost {
    pub fn new() -> MockHost {
        MockHost {
            ctx: Ctx {
                user: Some("00000000-0000-0000-0000-000000000001".into()),
                username: Some("test".into()),
                tenant: Some("00000000-0000-0000-0000-0000000000aa".into()),
                plugin: "com.test.plugin".into(),
                perms: ["use", "create", "delete", "share"].map(String::from).to_vec(),
                groups: Vec::new(),
                config: serde_json::Value::Null,
            },
            ..MockHost::default()
        }
    }

    /// Answer for a host operation (`db.query`, `db.exec`, `resource.create`, `http.fetch`...).
    pub fn on(self, op: &str, f: impl FnMut(&Value) -> Result<Value, String> + 'static) -> MockHost {
        self.inner.borrow_mut().handlers.insert(op.to_string(), Box::new(f));
        self
    }

    /// The permissions of the caller in the test (`ctx.perms`): the ones of the kernel (`use`, `create`, `delete`,
    /// `share`) and the `[[user_permissions]]` of the plugin. The default has the four of the kernel.
    pub fn with_perms(mut self, perms: &[&str]) -> MockHost {
        self.ctx.perms = perms.iter().map(|p| p.to_string()).collect();
        self
    }

    /// Answers a command of another plugin (`ctx.call_plugin(plugin, name, args)`) with the arguments it gets.
    /// A command nobody programmed is an error, as when the plugin is not in `[permissions] calls`.
    pub fn with_plugin_command(
        self,
        plugin: &str,
        name: &str,
        f: impl FnMut(&Value) -> Result<Value, String> + 'static,
    ) -> MockHost {
        self.inner.borrow_mut().commands.insert((plugin.to_string(), name.to_string()), Box::new(f));
        self
    }

    /// The host refuses an operation with this message (what the plugin gets when it did not declare the
    /// permission in `plugin.toml`).
    pub fn deny(self, op: &str, message: &str) -> MockHost {
        let message = message.to_string();
        self.on(op, move |_| Err(message.clone()))
    }

    /// The Files area for `files.list`, `files.describe` and `files.read`, with the answers of the real host:
    /// the rows of a folder, one entry, the first `max_bytes` of a file as base64. An id nobody has is `not_found`.
    pub fn with_files(self, files: Vec<FakeFile>) -> MockHost {
        let list = files.clone();
        let describe = files.clone();
        self.on("files.list", move |req| {
            let parent = req.get("parent").and_then(Value::as_str);
            let entries: Vec<Value> =
                list.iter().filter(|f| f.parent.as_deref() == parent).map(FakeFile::entry).collect();
            Ok(json!({ "entries": entries, "truncated": false }))
        })
        .on("files.describe", move |req| {
            let id = req.get("id").and_then(Value::as_str).unwrap_or_default();
            describe.iter().find(|f| f.id == id).map(FakeFile::entry).ok_or_else(|| "not_found".to_string())
        })
        .on("files.read", move |req| {
            let id = req.get("id").and_then(Value::as_str).unwrap_or_default();
            let max = req.get("max_bytes").and_then(Value::as_u64).unwrap_or(0).min(4 * 1024 * 1024) as usize;
            let f = files.iter().find(|f| f.id == id && !f.is_dir).ok_or_else(|| "not_found".to_string())?;
            let part = &f.content[..f.content.len().min(max)];
            Ok(json!({
                "entry": f.entry(),
                "base64": base64(part),
                "size": part.len(),
                "truncated": part.len() < f.content.len(),
            }))
        })
    }

    /// Groups of the caller in the test (`ctx.groups`).
    pub fn with_groups(mut self, groups: &[(&str, &str)]) -> MockHost {
        self.ctx.groups = groups
            .iter()
            .map(|(id, name)| crate::Group { id: id.to_string(), name: name.to_string() })
            .collect();
        self
    }

    /// The notifications the logic sent (`ctx.notify`), as the host receives them. Without a handler
    /// for `notify` the mock accepts them.
    pub fn notifications(&self) -> Vec<Value> {
        self.inner.borrow().calls.iter().filter(|(op, _)| op == "notify").map(|(_, b)| b.clone()).collect()
    }

    pub fn calls(&self) -> Vec<(String, Value)> {
        self.inner.borrow().calls.clone()
    }

    pub fn logs(&self) -> Vec<String> {
        self.inner.borrow().logs.clone()
    }

    fn with<T>(&self, f: impl FnOnce() -> T) -> T {
        CURRENT.with(|c| *c.borrow_mut() = Some(self.inner.clone()));
        let out = f();
        CURRENT.with(|c| *c.borrow_mut() = None);
        out
    }

    fn unwrap_reply(reply: Value) -> Result<Value, String> {
        match reply.get("err") {
            Some(e) => Err(e.as_str().unwrap_or_default().to_string()),
            None => Ok(reply.get("ok").cloned().unwrap_or(Value::Null)),
        }
    }

    /// Runs a command as the kernel would and keeps the whole error (message and `code`).
    pub fn command_err(&self, reg: &Registry, name: &str, args: Value) -> Result<Value, crate::Error> {
        let msg = json!({ "abi": 1, "kind": "command", "name": name, "args": args, "ctx": self.ctx });
        let reply = self.with(|| reg.dispatch(&msg));
        match reply.get("err") {
            Some(e) => {
                let mut err = crate::Error::msg(e.as_str().unwrap_or_default());
                if let Some(c) = reply.get("code").and_then(Value::as_str) {
                    err = err.with_code(c);
                }
                Err(err)
            }
            None => Ok(reply.get("ok").cloned().unwrap_or(Value::Null)),
        }
    }

    /// Runs a command as the kernel would.
    pub fn command(&self, reg: &Registry, name: &str, args: Value) -> Result<Value, String> {
        let msg = json!({ "abi": 1, "kind": "command", "name": name, "args": args, "ctx": self.ctx });
        Self::unwrap_reply(self.with(|| reg.dispatch(&msg)))
    }

    /// Runs a hook; returns the changed values (`None` if unchanged).
    pub fn hook(
        &self,
        reg: &Registry,
        hook: &str,
        resource: &str,
        values: Value,
    ) -> Result<Option<Values>, String> {
        let h = Hook {
            hook: hook.into(),
            resource: resource.into(),
            values: serde_json::from_value(values).map_err(|e| e.to_string())?,
            ..Hook::default()
        };
        let mut msg = serde_json::to_value(&h).map_err(|e| e.to_string())?;
        msg["abi"] = json!(1);
        msg["kind"] = json!("hook");
        msg["ctx"] = serde_json::to_value(&self.ctx).map_err(|e| e.to_string())?;
        let out = Self::unwrap_reply(self.with(|| reg.dispatch(&msg)))?;
        match out.get("values") {
            Some(v) => Ok(Some(serde_json::from_value(v.clone()).map_err(|e| e.to_string())?)),
            None => Ok(None),
        }
    }
}

#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
pub(crate) fn mock_call(msg: &[u8]) -> Option<Vec<u8>> {
    let req: Value = serde_json::from_slice(msg).ok()?;
    let op = req.get("op").and_then(Value::as_str).unwrap_or_default().to_string();
    let body = req.get("req").cloned().unwrap_or(Value::Null);
    let reply = CURRENT.with(|c| {
        let cur = c.borrow();
        let Some(inner) = cur.as_ref() else {
            return json!({ "err": "no active MockHost: use MockHost::command/hook" });
        };
        let mut inner = inner.borrow_mut();
        inner.calls.push((op.clone(), body.clone()));
        let reply = |r: Result<Value, String>| match r {
            Ok(v) => json!({ "ok": v }),
            Err(e) => json!({ "err": e }),
        };
        match inner.handlers.get_mut(&op) {
            Some(h) => reply(h(&body)),
            None if op == "plugin.call" => {
                let text = |k: &str| body.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
                let key = (text("plugin"), text("name"));
                let args = body.get("args").cloned().unwrap_or(Value::Null);
                match inner.commands.get_mut(&key) {
                    Some(h) => reply(h(&args)),
                    None => json!({ "err": format!("MockHost: no command {} of {}", key.1, key.0) }),
                }
            }
            None if op == "notify" => json!({ "ok": null }),
            None => json!({ "err": format!("MockHost: no answer for {op}") }),
        }
    });
    serde_json::to_vec(&reply).ok()
}

#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
pub(crate) fn mock_log(msg: &str) {
    CURRENT.with(|c| {
        if let Some(inner) = c.borrow().as_ref() {
            inner.borrow_mut().logs.push(msg.to_string());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prelude::*;

    fn default_tag(ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
        let mut v = hook.values.clone();
        if v.str("tag").is_empty() {
            v.set("tag", "personal");
            ctx.log("default tag");
            return Ok(Some(v));
        }
        Ok(None)
    }

    fn reject(_: &Ctx, _: &Hook) -> Result<Option<Values>> {
        Err(Error::msg("forbidden"))
    }

    fn locked(_: &Ctx, _args: Value) -> Result<Value> {
        Err(Error::coded("item_locked", "the item is closed"))
    }

    fn count(ctx: &Ctx, _args: Value) -> Result<Value> {
        Ok(Value::Array(ctx.db().query("select count(*) n from notes", &[])?))
    }

    crate::plugin! {
        hooks: { "notes.before_create" => default_tag, "notes.before_update" => reject },
        commands: { "notes.count" => count, "t.greet" => greet, "t.locked" => locked, "t.tour" => tour },
    }

    #[test]
    fn the_error_carries_its_code() {
        let host = MockHost::new();
        let reg = __msk_registry();
        // the wire answer has `err` and `code`; without a code, only `err`
        let reply =
            reg.dispatch(&json!({ "kind": "command", "name": "t.locked", "args": {}, "ctx": host.ctx }));
        assert_eq!(reply, json!({ "err": "the item is closed", "code": "item_locked" }));
        let e = host.command_err(&reg, "t.locked", json!({})).unwrap_err();
        assert_eq!((e.message.as_str(), e.code.as_deref()), ("the item is closed", Some("item_locked")));
        assert_eq!(host.command_err(&reg, "t.nope", json!({})).unwrap_err().code, None);
        assert_eq!(host.command(&reg, "t.locked", json!({})), Err("the item is closed".into()));
    }

    #[test]
    fn hooks_and_commands() {
        let host = MockHost::new().on("db.query", |req| {
            assert_eq!(req["sql"], "select count(*) n from notes");
            Ok(json!([{ "n": 3 }]))
        });
        let reg = __msk_registry();
        assert_eq!(host.command(&reg, "notes.count", json!({})), Ok(json!([{ "n": 3 }])));
        assert!(host.command(&reg, "notes.nope", json!({})).unwrap_err().contains("unknown"));

        let v = host.hook(&reg, "before_create", "notes", json!({ "title": "x" })).unwrap().unwrap();
        assert_eq!(v.str("tag"), "personal");
        assert_eq!(host.logs(), vec!["default tag"]);
        assert_eq!(host.hook(&reg, "before_create", "notes", json!({ "tag": "work" })).unwrap(), None);
        assert_eq!(host.hook(&reg, "before_update", "notes", json!({})), Err("forbidden".into()));
        // hook not registered: pass-through
        assert_eq!(host.hook(&reg, "after_delete", "notes", json!({})).unwrap(), None);
    }

    fn greet(ctx: &Ctx, args: Value) -> Result<Value> {
        let names: Vec<&str> = ctx.groups.iter().map(|g| g.name.as_str()).collect();
        let n = Notice::new("Hello").body(&names.join(",")).at("notes/1");
        ctx.notify(&if args.is_null() { n } else { n.resource("r1") })?;
        Ok(json!(names))
    }

    #[test]
    fn groups_and_notifications() {
        let reg = __msk_registry();
        let host = MockHost::new();
        assert_eq!(host.command(&reg, "t.greet", Value::Null), Ok(json!([])));
        let host = MockHost::new().with_groups(&[("g1", "Field"), ("g2", "Office")]);
        assert_eq!(host.command(&reg, "t.greet", json!(1)), Ok(json!(["Field", "Office"])));
        assert_eq!(
            host.notifications(),
            vec![json!({ "title": "Hello", "body": "Field,Office", "at": "notes/1", "resource": "r1" })]
        );
        // a refusal of the host is an error of the logic
        let host = MockHost::new().on("notify", |_| Err("too many notifications".into()));
        assert_eq!(host.command(&reg, "t.greet", Value::Null), Err("too many notifications".into()));
        // an old message without `groups` still deserializes
        let ctx: Ctx = serde_json::from_value(json!({ "plugin": "x" })).unwrap();
        assert!(ctx.groups.is_empty());
    }

    fn tour(ctx: &Ctx, _args: Value) -> Result<Value> {
        let other = ctx.call_plugin("com.example.other", "other.total", json!({ "n": 4 }))?;
        let files = ctx.files().list(Some("d1"))?;
        let read = ctx.files().read("f1", 3)?;
        Ok(json!({ "other": other, "files": files, "read": read, "perms": ctx.perms }))
    }

    #[test]
    fn recipes_plugin_calls_files_and_permissions() {
        let reg = __msk_registry();
        let host = MockHost::new()
            .with_perms(&["use"])
            .with_plugin_command("com.example.other", "other.total", |a| Ok(json!({ "total": a["n"] })))
            .with_files(vec![
                FakeFile::folder("d1", "Reports"),
                FakeFile::file("f1", "a.txt", b"hello").in_folder("d1"),
                FakeFile::file("f0", "root.txt", b"x"),
            ]);
        let out = host.command(&reg, "t.tour", Value::Null).unwrap();
        assert_eq!(out["other"], json!({ "total": 4 }));
        assert_eq!(out["perms"], json!(["use"]));
        assert_eq!(out["files"]["entries"].as_array().unwrap().len(), 1);
        assert_eq!(out["read"]["base64"], "aGVs");
        assert_eq!((out["read"]["size"].clone(), out["read"]["truncated"].clone()), (json!(3), json!(true)));
        assert_eq!(host.calls().len(), 3);
        // a command nobody programmed, an unknown file and a refused operation are errors of the logic
        let e = MockHost::new().command(&reg, "t.tour", Value::Null).unwrap_err();
        assert!(e.contains("no command other.total of com.example.other"), "{e}");
        let host = MockHost::new()
            .with_plugin_command("com.example.other", "other.total", |_| Ok(json!(1)))
            .with_files(vec![FakeFile::folder("d1", "Reports")]);
        assert_eq!(host.command(&reg, "t.tour", Value::Null), Err("not_found".to_string()));
        let host = MockHost::new()
            .with_plugin_command("com.example.other", "other.total", |_| Ok(json!(1)))
            .deny("files.list", "the plugin does not declare `files_read` in [permissions]");
        assert!(host.command(&reg, "t.tour", Value::Null).unwrap_err().contains("files_read"));
    }

    #[test]
    fn base64_is_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"hello"), "aGVsbG8=");
    }

    #[test]
    fn host_errors_propagated() {
        let host = MockHost::new().on("db.query", |_| Err("permission denied".into()));
        assert_eq!(
            host.command(&__msk_registry(), "notes.count", json!({})),
            Err("permission denied".into())
        );
    }
}
