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
//! // directory.search (`ctx.directory()`): the people and groups of the tenant, as the real host answers
//! let host = MockHost::new()
//!     .with_directory(&[("u1", "anna", "Anna Rossi")], &[("g1", "Editors")]);
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
                public: false,
                link_resource: None,
                on_behalf: None,
            },
            ..MockHost::default()
        }
    }

    /// The command runs as a public command of a link on the item `link_resource`: no user, no
    /// permissions, `ctx.public` and `ctx.link_resource()` set. The simulated host still answers what you
    /// program; the real one refuses every operation but `db.query`, `http.fetch` and `key.get`.
    pub fn as_public(mut self, link_resource: &str) -> MockHost {
        self.ctx.user = None;
        self.ctx.username = None;
        self.ctx.perms = Vec::new();
        self.ctx.public = true;
        self.ctx.link_resource = Some(link_resource.to_string());
        self
    }

    /// The command is called on behalf of a run ticket of the run `run_ref`: `ctx.on_behalf()` is set. The
    /// user stays the person who started the run. The real host refuses `plugin.call` in such a call.
    pub fn on_behalf(mut self, run_ref: &str) -> MockHost {
        self.ctx.on_behalf = Some(crate::OnBehalf { run_ref: run_ref.to_string(), ..Default::default() });
        self
    }

    /// The command is called by the schedule `name` of the plugin (a run started by the timetable): like
    /// `on_behalf`, with `on_behalf().schedule` set.
    pub fn scheduled(mut self, name: &str, run_ref: &str) -> MockHost {
        self.ctx.on_behalf = Some(crate::OnBehalf {
            run_ref: run_ref.to_string(),
            schedule: Some(name.to_string()),
            schedule_id: Some("00000000-0000-0000-0000-000000000000".to_string()),
        });
        self
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

    /// The people and groups of the tenant for `directory.search`, with the answers of the real host: a
    /// case-insensitive substring of the username or name (`q` 1 to 64 characters), name order, 20 rows
    /// by default and at most 50, `{id, username, name}` for people and `{id, name}` for groups. People are
    /// `(id, username, name)`, groups `(id, name)`. The mock does not know the rights of the caller: use
    /// `deny("directory.search", ...)` to test a refusal.
    pub fn with_directory(self, users: &[(&str, &str, &str)], groups: &[(&str, &str)]) -> MockHost {
        self.with_directory_holders(users, groups, &[])
    }

    /// As [`MockHost::with_directory`], and the people who hold a permission of the plugin for
    /// `Directory::users_with`: `(permission key, ids of the people)`. `q` may be empty for those calls, and
    /// at most 200 rows come back.
    pub fn with_directory_holders(
        self,
        users: &[(&str, &str, &str)],
        groups: &[(&str, &str)],
        holders: &[(&str, &[&str])],
    ) -> MockHost {
        let holders: Vec<(String, Vec<String>)> = holders
            .iter()
            .map(|(k, ids)| (k.to_string(), ids.iter().map(|i| i.to_string()).collect()))
            .collect();
        let users: Vec<(String, String, String)> =
            users.iter().map(|(a, b, c)| (a.to_string(), b.to_string(), c.to_string())).collect();
        let groups: Vec<(String, String)> =
            groups.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
        self.on("directory.search", move |req| {
            let q = req.get("q").and_then(Value::as_str).unwrap_or_default().trim().to_lowercase();
            let len = q.chars().count();
            let permission = req.get("permission").and_then(Value::as_str);
            if (len == 0 && permission.is_none()) || len > 64 {
                return Err("q must be 1 to 64 characters".to_string());
            }
            let cap = if permission.is_some() { 200 } else { 50 };
            let limit = match req.get("limit") {
                None | Some(Value::Null) => {
                    if permission.is_some() {
                        cap
                    } else {
                        20
                    }
                }
                Some(v) => v.as_u64().filter(|n| *n >= 1).ok_or("limit must be a positive integer")?.min(cap),
            } as usize;
            match req.get("kind").and_then(Value::as_str) {
                Some("user") => {
                    let mine: Option<&Vec<String>> = match permission {
                        Some(k) => Some(
                            holders
                                .iter()
                                .find(|(key, _)| key == k)
                                .map(|(_, ids)| ids)
                                .ok_or("the plugin has no such permission")?,
                        ),
                        None => None,
                    };
                    let mut rows: Vec<_> = users
                        .iter()
                        .filter(|(id, u, n)| {
                            mine.is_none_or(|ids| ids.contains(id))
                                && (u.to_lowercase().contains(&q) || n.to_lowercase().contains(&q))
                        })
                        .collect();
                    rows.sort_by_key(|(id, u, n)| (n.to_lowercase(), u.clone(), id.clone()));
                    Ok(Value::Array(
                        rows.into_iter()
                            .take(limit)
                            .map(|(id, u, n)| json!({ "id": id, "username": u, "name": n }))
                            .collect(),
                    ))
                }
                Some("group") => {
                    let mut rows: Vec<_> =
                        groups.iter().filter(|(_, n)| n.to_lowercase().contains(&q)).collect();
                    rows.sort_by_key(|(id, n)| (n.to_lowercase(), id.clone()));
                    Ok(Value::Array(
                        rows.into_iter().take(limit).map(|(id, n)| json!({ "id": id, "name": n })).collect(),
                    ))
                }
                _ => Err("kind must be \"user\" or \"group\"".to_string()),
            }
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
        self.hook_with_previous(reg, hook, resource, values, None)
    }

    /// Like [`MockHost::hook`], for an update: `previous` are the values before the change.
    pub fn hook_with_previous(
        &self,
        reg: &Registry,
        hook: &str,
        resource: &str,
        values: Value,
        previous: impl Into<Option<Value>>,
    ) -> Result<Option<Values>, String> {
        let previous: Option<Value> = previous.into();
        let h = Hook {
            hook: hook.into(),
            resource: resource.into(),
            values: serde_json::from_value(values).map_err(|e| e.to_string())?,
            previous: match previous {
                Some(p) => Some(serde_json::from_value(p).map_err(|e| e.to_string())?),
                None => None,
            },
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
        commands: { "notes.count" => count, "t.greet" => greet, "t.locked" => locked, "t.tour" => tour, "t.dir" => directory_tour, "t.reviewers" => reviewers, "t.run" => run_tour },
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

    #[test]
    fn public_command_context() {
        let ctx: Ctx =
            serde_json::from_value(json!({ "plugin": "x", "public": true, "link_resource": "r9" })).unwrap();
        assert!(ctx.public);
        assert_eq!(ctx.link_resource(), Some("r9"));
        assert_eq!(Ctx::default().link_resource(), None);
        let host = MockHost::new().as_public("r9");
        assert!(host.ctx.public && host.ctx.user.is_none() && host.ctx.perms.is_empty());
        assert_eq!(host.ctx.link_resource(), Some("r9"));
    }

    #[test]
    fn run_ticket_context() {
        let ctx: Ctx =
            serde_json::from_value(json!({ "plugin": "x", "on_behalf": { "run_ref": "run-7" } })).unwrap();
        assert_eq!(ctx.on_behalf().map(|o| o.run_ref.as_str()), Some("run-7"));
        assert!(Ctx::default().on_behalf().is_none());
        let host = MockHost::new().on_behalf("run-7");
        assert_eq!(host.ctx.on_behalf().unwrap().run_ref, "run-7");
        assert!(host.ctx.on_behalf().unwrap().schedule.is_none());
        let ctx: Ctx = serde_json::from_value(
            json!({ "plugin": "x", "on_behalf": { "run_ref": "s:1", "schedule": "nightly", "schedule_id": "abc" } }),
        )
        .unwrap();
        assert_eq!(ctx.on_behalf().unwrap().schedule.as_deref(), Some("nightly"));
        let host = MockHost::new().scheduled("nightly", "s:1");
        assert_eq!(host.ctx.on_behalf().unwrap().schedule.as_deref(), Some("nightly"));
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

    fn reviewers(ctx: &Ctx, _args: Value) -> Result<Value> {
        Ok(json!(ctx.directory().users_with("review", "", None)?))
    }

    fn directory_tour(ctx: &Ctx, _args: Value) -> Result<Value> {
        let users = ctx.directory().users("AN", Some(100))?;
        let groups = ctx.directory().groups("edit", None)?;
        Ok(json!({ "users": users, "groups": groups }))
    }

    fn run_tour(ctx: &Ctx, _args: Value) -> Result<Value> {
        let t = ctx.runs().mint(&crate::RunMint {
            commands: vec!["node_run".into()],
            run_ref: "r1".into(),
            targets: vec![crate::RunTarget {
                plugin: "com.x.w".into(),
                commands: vec!["node_run".into()],
                resources: None,
            }],
            ..Default::default()
        })?;
        Ok(json!({ "token": t.token, "uses": t.uses }))
    }

    #[test]
    fn runs_mint_sends_what_the_real_host_expects() {
        let reg = __msk_registry();
        let host = MockHost::new().on("runs.mint", |_| {
            Ok(json!({ "id": "t1", "token": "ab", "expires_at": "2030-01-01T00:00:00Z", "uses": 100 }))
        });
        let out = host.command(&reg, "t.run", Value::Null).unwrap();
        assert_eq!(out, json!({ "token": "ab", "uses": 100 }));
        let (op, req) = &host.calls()[0];
        assert_eq!(op, "runs.mint");
        assert_eq!(req["targets"][0]["plugin"], "com.x.w");
        // optional fields are left out, not sent as null
        assert!(req.get("ttl_minutes").is_none() && req.get("resources").is_none());
        let denied = MockHost::new().deny("runs.mint", "not in run_targets");
        assert!(denied.command(&reg, "t.run", Value::Null).unwrap_err().contains("run_targets"));
    }

    #[test]
    fn directory_search_follows_the_real_host() {
        let reg = __msk_registry();
        let host = MockHost::new().with_directory(
            &[("u2", "bruno", "Bruno Ananas"), ("u1", "anna", "Anna Rossi"), ("u3", "carla", "Carla")],
            &[("g1", "Editors")],
        );
        let out = host.command(&reg, "t.dir", Value::Null).unwrap();
        assert_eq!(out["users"][0], json!({ "id": "u1", "username": "anna", "name": "Anna Rossi" }));
        assert_eq!(out["users"].as_array().unwrap().len(), 2);
        assert_eq!(out["groups"], json!([{ "id": "g1", "name": "Editors" }]));
        // what the logic asked is what the host got (the host caps it)
        assert_eq!(host.calls()[0].1["limit"], 100);
        // a refusal of the host is an error of the logic
        let denied = MockHost::new()
            .deny("directory.search", "the plugin does not declare `directory` in [permissions]");
        assert!(denied.command(&reg, "t.dir", Value::Null).unwrap_err().contains("directory"));
    }

    #[test]
    fn the_holders_of_a_permission_are_listed_with_an_empty_q() {
        let reg = __msk_registry();
        let host = MockHost::new().with_directory_holders(
            &[("u2", "bruno", "Bruno"), ("u1", "anna", "Anna Rossi"), ("u3", "carla", "Carla")],
            &[],
            &[("review", &["u3", "u1"])],
        );
        let out = host.command(&reg, "t.reviewers", Value::Null).unwrap();
        assert_eq!(
            out,
            json!([{ "id": "u1", "username": "anna", "name": "Anna Rossi" }, { "id": "u3", "username": "carla", "name": "Carla" }])
        );
        assert_eq!(host.calls()[0].1["permission"], "review");
        // a key the plugin does not declare is refused
        let none = MockHost::new().with_directory_holders(&[("u1", "anna", "Anna")], &[], &[]);
        assert!(none.command(&reg, "t.reviewers", Value::Null).is_err());
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
