//! Native tests of the logic of the plugins with a simulated host.
//!
//! ```ignore
//! use mosaikit_plugin_sdk::testing::MockHost;
//!
//! let host = MockHost::new().on("db.query", |_req| Ok(json!([{ "tag": "work", "n": 2 }])));
//! let out = host.command(&__msk_registry(), "notes.count_by_tag", json!({}));
//! assert_eq!(out, Ok(json!([{ "tag": "work", "n": 2 }])));
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
    calls: Vec<(String, Value)>,
    logs: Vec<String>,
}

thread_local! {
    static CURRENT: RefCell<Option<Rc<RefCell<Inner>>>> = const { RefCell::new(None) };
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
        match inner.handlers.get_mut(&op) {
            Some(h) => match h(&body) {
                Ok(v) => json!({ "ok": v }),
                Err(e) => json!({ "err": e }),
            },
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
        commands: { "notes.count" => count, "t.greet" => greet, "t.locked" => locked },
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
    fn host_errors_propagated() {
        let host = MockHost::new().on("db.query", |_| Err("permission denied".into()));
        assert_eq!(
            host.command(&__msk_registry(), "notes.count", json!({})),
            Err("permission denied".into())
        );
    }
}
