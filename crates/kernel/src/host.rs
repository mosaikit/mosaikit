//! Host services for the WASM logic: SQL (guard + RLS), resources, HTTP.
//!
//! The guest runs in a blocking thread (`spawn_blocking`); the database
//! operations use the transaction of the call (role of the plugin, context
//! of the user) through `Handle::block_on`.

use std::sync::Arc;

use mosaikit_db::Tx;
use mosaikit_runtime::Host;
use serde_json::{json, Value};

use crate::plugins::LoadedPlugin;
use crate::{Error, Kernel, Result};

pub const FUEL_COMMAND: u64 = 2_000_000_000;
pub const FUEL_HOOK: u64 = 500_000_000;
const MAX_HTTP_BODY: usize = 4 << 20;

/// Maximum depth of the calls between plugins (A -> B -> C).
const MAX_CALL_DEPTH: u8 = 3;

pub(crate) struct KernelHost {
    rt: tokio::runtime::Handle,
    kernel: Option<Arc<Kernel>>,
    caller: crate::Caller,
    calls: Vec<String>,
    depth: u8,
    tx: Option<Tx>,
    schema: String,
    plugin_id: String,
    network: Vec<String>,
    http: reqwest::Client,
}

type Params = Vec<Value>;

fn params(req: &Value) -> Params {
    req.get("params").and_then(Value::as_array).cloned().unwrap_or_default()
}

/// Binds the JSON parameters: null, bool, integers, decimals, text; objects/arrays as json.
pub(crate) fn bind_json(mut q: mosaikit_db::Query, params: &[Value]) -> mosaikit_db::Query {
    for p in params {
        q = q.bind(mosaikit_db::Param::from_json(p));
    }
    q
}

impl KernelHost {
    fn tx(&mut self) -> std::result::Result<&mut Tx, String> {
        self.tx.as_mut().ok_or_else(|| "transaction not available".to_string())
    }

    fn db(&mut self, rows: bool, req: &Value) -> std::result::Result<Value, String> {
        let sql = req.get("sql").and_then(Value::as_str).ok_or("missing sql")?;
        let checked = mosaikit_sql_guard::check_query(sql, &self.schema).map_err(|e| e.to_string())?;
        let params = params(req);
        let rt = self.rt.clone();
        let tx = self.tx()?;
        if rows && !checked.produces_rows() {
            return Err("db.query requires SELECT or RETURNING: use db.exec".to_string());
        }
        let select = checked.kind == mosaikit_sql_guard::Kind::Select;
        // savepoint inside plugin_sql: an SQL error does not poison the transaction of the call
        rt.block_on(async move {
            tx.plugin_sql(&checked.sql, select, rows, &params).await.map_err(|e| Error::from(e).message)
        })
    }

    fn resource(&mut self, op: &str, req: &Value) -> std::result::Result<Value, String> {
        let rt = self.rt.clone();
        let tx = self.tx()?;
        match op {
            "resource.create" => {
                let kind = req.get("kind").and_then(Value::as_str).unwrap_or_default().to_string();
                let title = req.get("title").and_then(Value::as_str).unwrap_or_default().to_string();
                let parent = req.get("parent").and_then(Value::as_str).map(str::to_string);
                let parent = match parent.map(|p| p.parse::<uuid::Uuid>()) {
                    Some(Ok(p)) => Some(p),
                    Some(Err(_)) => return Err("invalid parent".into()),
                    None => None,
                };
                rt.block_on(async move {
                    tx.create_resource(&kind, &title, parent, &json!({}))
                        .await
                        .map(|id| Value::String(id.to_string()))
                        .map_err(|e| Error::from(e).message)
                })
            }
            _ => {
                let id = req.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
                let Ok(id) = id.parse::<uuid::Uuid>() else { return Err("invalid id".into()) };
                rt.block_on(async move {
                    tx.delete_resource(id).await.map(|_| Value::Null).map_err(|e| Error::from(e).message)
                })
            }
        }
    }

    /// Command of another plugin declared in `permissions.calls`, with the same
    /// user: the called plugin runs in its own transaction and with its own rules.
    fn plugin_call(&mut self, req: &Value) -> std::result::Result<Value, String> {
        let target = req.get("plugin").and_then(Value::as_str).ok_or("missing plugin")?.to_string();
        let name = req.get("name").and_then(Value::as_str).ok_or("missing name")?.to_string();
        let args = req.get("args").cloned().unwrap_or(Value::Null);
        if !self.calls.contains(&target) {
            return Err(format!("plugin not declared in permissions.calls: {target}"));
        }
        if self.depth >= MAX_CALL_DEPTH {
            return Err("too many nested calls between plugins".into());
        }
        let k = self.kernel.clone().ok_or("kernel not available")?;
        if k.db.is_sqlite() {
            // SQLite has one write transaction at a time: the one of the caller is open
            return Err("plugin.call requires PostgreSQL".into());
        }
        let (caller, depth) = (self.caller.clone(), self.depth + 1);
        self.rt.block_on(async move {
            crate::crud::call_depth(&k, &caller, &target, &name, args, depth).await.map_err(|e| e.message)
        })
    }

    fn http(&mut self, req: &Value) -> std::result::Result<Value, String> {
        let url = req.get("url").and_then(Value::as_str).ok_or("missing url")?;
        let origin = crate::config::origin_of(url);
        if !self.network.contains(&origin) {
            return Err(format!("origin not declared in permissions.network: {origin}"));
        }
        let method = match req.get("method").and_then(Value::as_str).unwrap_or("GET") {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "PUT" => reqwest::Method::PUT,
            "DELETE" => reqwest::Method::DELETE,
            m => return Err(format!("method not allowed: {m}")),
        };
        let mut r = self.http.request(method, url);
        if let Some(b) = req.get("body").and_then(Value::as_str) {
            r = r.header("content-type", "application/json").body(b.to_string());
        }
        self.rt.block_on(async move {
            let resp = r.send().await.map_err(|e| e.to_string())?;
            let status = resp.status().as_u16();
            let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
            if bytes.len() > MAX_HTTP_BODY {
                return Err("HTTP response over 4 MB".to_string());
            }
            Ok(json!({ "status": status, "body": String::from_utf8_lossy(&bytes) }))
        })
    }
}

impl Host for KernelHost {
    fn call(&mut self, op: &str, req: &Value) -> std::result::Result<Value, String> {
        match op {
            "db.query" => self.db(true, req),
            "db.exec" => self.db(false, req),
            "resource.create" | "resource.delete" => self.resource(op, req),
            "http.fetch" => self.http(req),
            "plugin.call" => self.plugin_call(req),
            other => Err(format!("unknown host operation: {other}")),
        }
    }

    fn log(&mut self, msg: &str) {
        tracing::info!(target: "plugin", plugin = %self.plugin_id, "{msg}");
    }
}

/// Runs the logic of the plugin in the transaction `tx`. On error the
/// transaction is discarded (rollback).
pub(crate) async fn run(
    k: &Kernel,
    c: &crate::Caller,
    p: &Arc<LoadedPlugin>,
    tx: Tx,
    mut msg: Value,
    fuel: u64,
    depth: u8,
) -> Result<(Value, Tx)> {
    // what the caller may do in the plugin: the logic enforces the permissions it declares
    let perms = crate::access::effective(k, c, &p.id).await?;
    let config = crate::plugins::config::for_logic(k, &p.id).await?;
    if let Some(ctx) = msg.get_mut("ctx").filter(|v| v.is_object()) {
        ctx["perms"] = json!(perms);
        // the settings of the plugin chosen by the Administrator (`[[config]]`)
        ctx["config"] = config;
    }
    let module = p.module.clone().ok_or_else(|| Error::bad(format!("{} has no WASM logic", p.id)))?;
    let host = KernelHost {
        rt: tokio::runtime::Handle::current(),
        kernel: k.arc(),
        caller: c.clone(),
        calls: p.manifest.permissions.calls.clone(),
        depth,
        tx: Some(tx),
        schema: p.schema(),
        plugin_id: p.id.clone(),
        network: p.manifest.permissions.network.clone(),
        http: k.http.clone(),
    };
    let engine = k.engine.clone();
    let (res, host) =
        tokio::task::spawn_blocking(move || engine.call_with_fuel(&module, &msg, host, fuel)).await?;
    let tx = host.tx.ok_or_else(|| Error::internal("transaction lost"))?;
    let reply = res?;
    if let Some(e) = reply.get("err") {
        return Err(Error::bad(e.as_str().map(str::to_string).unwrap_or_else(|| e.to_string())));
    }
    Ok((reply.get("ok").cloned().unwrap_or(Value::Null), tx))
}

pub(crate) fn ctx_json(c: &crate::Caller, plugin: &str) -> Value {
    json!({
        "user": c.user.user_id.to_string(),
        "username": c.user.username,
        "tenant": c.tenant.tenant_id.to_string(),
        "plugin": plugin,
    })
}
