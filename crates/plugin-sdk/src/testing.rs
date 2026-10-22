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

    fn count(ctx: &Ctx, _args: Value) -> Result<Value> {
        Ok(Value::Array(ctx.db().query("select count(*) n from notes", &[])?))
    }

    crate::plugin! {
        hooks: { "notes.before_create" => default_tag, "notes.before_update" => reject },
        commands: { "notes.count" => count },
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

    #[test]
    fn host_errors_propagated() {
        let host = MockHost::new().on("db.query", |_| Err("permission denied".into()));
        assert_eq!(
            host.command(&__msk_registry(), "notes.count", json!({})),
            Err("permission denied".into())
        );
    }
}
