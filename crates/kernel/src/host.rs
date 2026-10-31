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
    /// the services of `[[service_keys]]` the plugin declares: the only keys it may read
    service_keys: Vec<String>,
    /// the services of `service_keys` whose value is an address: its origin may be fetched
    address_services: Vec<String>,
    /// `[permissions] notify`: the plugin may notify
    notify: bool,
    /// `[permissions] files_read`: the logic may read the Files area as the caller
    files_read: bool,
    /// code of the last error given to the logic (`Host::error_code`)
    last_code: Option<String>,
    /// notifications asked by the logic: sent after the commit of the operation
    notes: Vec<crate::notify::PluginNote>,
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
        let (k, tenant) = (self.kernel.clone(), self.caller.tenant.tenant_id);
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
                    if let Some(k) = &k {
                        crate::quotas::check(k, tenant, crate::quotas::Add::items(1))
                            .await
                            .map_err(|e| e.message)?;
                    }
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

    /// `http.fetch`: an origin declared in `permissions.network` (or the address an Administrator set for
    /// an address service of `[[service_keys]]`). The request goes through the same checks as the page
    /// probe (public addresses only, see `webfetch::request`). With `key` (a service of the plugin) the
    /// host adds the key in use for the caller as `Authorization: Bearer ...`: the plugin never reads it.
    fn http(&mut self, req: &Value) -> std::result::Result<Value, String> {
        let url = req.get("url").and_then(Value::as_str).ok_or("missing url")?.to_string();
        let origin = crate::config::origin_of(&url);
        let k = self.kernel.clone().ok_or("kernel not available")?;
        let caller = self.caller.clone();
        let allowed = self.network.contains(&origin);
        // the deployer's private destinations, only for the origins this plugin declares
        let exempt = crate::webfetch::private_exemptions(&k, &self.network);
        let address_services = self.address_services.clone();
        let key_service = req.get("key").and_then(Value::as_str).map(str::to_string);
        if let Some(s) = &key_service {
            if !self.service_keys.iter().any(|x| x == s) {
                return Err(format!("the plugin does not declare the service {s} in [[service_keys]]"));
            }
        }
        let method = match req.get("method").and_then(Value::as_str).unwrap_or("GET") {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "PUT" => reqwest::Method::PUT,
            "DELETE" => reqwest::Method::DELETE,
            m => return Err(format!("method not allowed: {m}")),
        };
        let body = req.get("body").and_then(Value::as_str).map(str::to_string);
        self.rt.block_on(async move {
            if !allowed {
                let mut by_address = false;
                for s in &address_services {
                    if let Ok(Some(a)) = crate::tenancy::keys::key_in_use(&k, &caller, s).await {
                        by_address |= crate::config::origin_of(&a) == origin;
                    }
                }
                if !by_address {
                    return Err(format!("origin not declared in permissions.network: {origin}"));
                }
            }
            let mut headers = Vec::new();
            if let Some(s) = key_service {
                match crate::tenancy::keys::key_in_use(&k, &caller, &s).await.map_err(|e| e.message)? {
                    Some(key) => headers.push(("authorization".to_string(), format!("Bearer {key}"))),
                    None => return Err(format!("no key of the service {s} is set")),
                }
            }
            let r = crate::webfetch::request(&k, method, &url, &headers, body, MAX_HTTP_BODY + 1, &exempt)
                .await
                .map_err(|e| e.message)?;
            if r.body.len() > MAX_HTTP_BODY {
                return Err("HTTP response over 4 MB".to_string());
            }
            Ok(json!({ "status": r.status, "body": String::from_utf8_lossy(&r.body) }))
        })
    }
}

impl KernelHost {
    /// `key.get`: the key of an outside service in use for the caller (own, else the tenant's, else
    /// the platform's), only for a service the plugin declares in `[[service_keys]]`; `null` if none.
    fn key(&mut self, req: &Value) -> std::result::Result<Value, String> {
        let service = req.get("service").and_then(Value::as_str).ok_or("missing service")?;
        if !self.service_keys.iter().any(|s| s == service) {
            return Err(format!("the plugin does not declare the service {service} in [[service_keys]]"));
        }
        let k = self.kernel.clone().ok_or("kernel not available")?;
        let caller = self.caller.clone();
        let service = service.to_string();
        self.rt.block_on(async move {
            crate::tenancy::keys::key_in_use(&k, &caller, &service)
                .await
                .map(|v| json!(v))
                .map_err(|e| e.message)
        })
    }
}

impl KernelHost {
    /// `notify`: queues a notification to the caller or, with `resource`, to the people who can see the
    /// item. Shape and rate are checked now; the people are resolved and the notification is sent once
    /// the operation has committed (an item created by the same operation is visible only then, and a
    /// rolled back operation notifies nobody).
    fn notify(&mut self, req: &Value) -> std::result::Result<Value, String> {
        if !self.notify {
            return Err("the plugin does not declare `notify` in [permissions]".into());
        }
        let n: crate::notify::PluginNote =
            serde_json::from_value(req.clone()).map_err(|e| format!("invalid notification: {e}"))?;
        let k = self.kernel.clone().ok_or("kernel not available")?;
        crate::notify::check_note(&k, &self.caller, &self.plugin_id, &n).map_err(|e| e.message)?;
        self.notes.push(n);
        Ok(Value::Null)
    }
}

/// An error of a host operation with the stable code the logic receives.
struct Coded(&'static str, String);

fn coded_of(e: Error) -> Coded {
    use crate::Kind;
    let code = match e.kind {
        Kind::Forbidden | Kind::Unauthorized => "permission_denied",
        Kind::NotFound => "not_found",
        Kind::BadRequest => "invalid_argument",
        _ => "internal",
    };
    // a file the caller does not see and a file that does not exist look the same
    Coded(code, e.message)
}

impl KernelHost {
    /// `files.list`, `files.describe`, `files.read`: the Files area with the permissions of the caller
    /// (the rules of the Files UI, run on a read transaction of the plugin that owns the files). Needs
    /// `[permissions] files_read`. The answer has no storage path and no key. Errors carry a code:
    /// `permission_denied`, `not_found`, `invalid_argument`.
    fn files(&mut self, op: &str, req: &Value) -> std::result::Result<Value, Coded> {
        if !self.files_read {
            return Err(Coded(
                "permission_denied",
                "the plugin does not declare `files_read` in [permissions]".into(),
            ));
        }
        let k = self.kernel.clone().ok_or_else(|| Coded("internal", "kernel not available".into()))?;
        let c = self.caller.clone();
        let uuid = |key: &str| -> std::result::Result<Option<uuid::Uuid>, Coded> {
            match req.get(key) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::String(s)) => {
                    s.parse().map(Some).map_err(|_| Coded("invalid_argument", format!("invalid {key}")))
                }
                Some(_) => Err(Coded("invalid_argument", format!("invalid {key}"))),
            }
        };
        let source = match req.get("plugin") {
            None | Some(Value::Null) => crate::files::DEFAULT_SOURCE.to_string(),
            Some(Value::String(s)) => s.clone(),
            Some(_) => return Err(Coded("invalid_argument", "invalid plugin".into())),
        };
        let json_of = |e: &crate::files::Entry| serde_json::to_value(e).unwrap_or(Value::Null);
        match op {
            "files.list" => {
                let parent = uuid("parent")?;
                let (rows, truncated) =
                    self.rt.block_on(crate::files::host_list(&k, &c, &source, parent)).map_err(coded_of)?;
                Ok(json!({ "entries": rows.iter().map(json_of).collect::<Vec<_>>(), "truncated": truncated }))
            }
            "files.describe" => {
                let id = uuid("id")?.ok_or(Coded("invalid_argument", "missing id".into()))?;
                let e =
                    self.rt.block_on(crate::files::host_describe(&k, &c, &source, id)).map_err(coded_of)?;
                Ok(json_of(&e))
            }
            _ => {
                let id = uuid("id")?.ok_or(Coded("invalid_argument", "missing id".into()))?;
                let max = match req.get("max_bytes") {
                    Some(v) => v
                        .as_u64()
                        .ok_or(Coded("invalid_argument", "max_bytes must be a positive integer".into()))?
                        as usize,
                    None => crate::files::HOST_READ_CEILING,
                };
                let (e, data, truncated) =
                    self.rt.block_on(crate::files::host_read(&k, &c, &source, id, max)).map_err(coded_of)?;
                use base64::Engine as _;
                Ok(json!({
                    "entry": json_of(&e),
                    "base64": base64::engine::general_purpose::STANDARD.encode(&data),
                    "size": data.len(),
                    "truncated": truncated,
                }))
            }
        }
    }
}

impl Host for KernelHost {
    fn error_code(&mut self) -> Option<String> {
        self.last_code.take()
    }

    fn call(&mut self, op: &str, req: &Value) -> std::result::Result<Value, String> {
        self.last_code = None;
        match op {
            "files.list" | "files.describe" | "files.read" => {
                self.files(op, req).map_err(|Coded(code, m)| {
                    self.last_code = Some(code.to_string());
                    m
                })
            }
            "db.query" => self.db(true, req),
            "db.exec" => self.db(false, req),
            "resource.create" | "resource.delete" => self.resource(op, req),
            "http.fetch" => self.http(req),
            "plugin.call" => self.plugin_call(req),
            "key.get" => self.key(req),
            "notify" => self.notify(req),
            other => Err(format!("unknown host operation: {other}")),
        }
    }

    fn log(&mut self, msg: &str) {
        tracing::info!(target: "plugin", plugin = %self.plugin_id, "{msg}");
    }
}

/// Runs the logic of the plugin in the transaction `tx`. On error the
/// transaction is discarded (rollback).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run(
    k: &Kernel,
    c: &crate::Caller,
    p: &Arc<LoadedPlugin>,
    tx: Tx,
    mut msg: Value,
    fuel: u64,
    depth: u8,
    notes: &mut Vec<crate::notify::PluginNote>,
) -> Result<(Value, Tx)> {
    // what the caller may do in the plugin: the logic enforces the permissions it declares
    let perms = crate::access::effective(k, c, &p.id).await?;
    let config = crate::plugins::config::for_logic(k, &p.id).await?;
    if let Some(ctx) = msg.get_mut("ctx").filter(|v| v.is_object()) {
        ctx["perms"] = json!(perms);
        // the groups of the caller in the tenant
        ctx["groups"] = groups_of(k, c).await?;
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
        service_keys: p.manifest.service_keys.iter().map(|s| s.id.clone()).collect(),
        address_services: p
            .manifest
            .service_keys
            .iter()
            .filter(|s| s.address)
            .map(|s| s.id.clone())
            .collect(),
        notify: p.manifest.permissions.notify,
        files_read: p.manifest.permissions.files_read,
        last_code: None,
        notes: Vec::new(),
    };
    let engine = k.engine.clone();
    let (res, host) =
        tokio::task::spawn_blocking(move || engine.call_with_fuel(&module, &msg, host, fuel)).await?;
    let tx = host.tx.ok_or_else(|| Error::internal("transaction lost"))?;
    let asked = host.notes;
    let reply = res?;
    if let Some(e) = reply.get("err") {
        // the message of the plugin itself: its own code, so the interface shows it instead of the
        // generic text of `bad_request`
        let err = Error::bad(e.as_str().map(str::to_string).unwrap_or_else(|| e.to_string()))
            .with_code("plugin_error");
        return Err(match reply.get("code").and_then(Value::as_str) {
            Some(c) => err.with_plugin_code(c),
            None => err,
        });
    }
    notes.extend(asked);
    Ok((reply.get("ok").cloned().unwrap_or(Value::Null), tx))
}

/// `ctx.groups`: `[{"id", "name"}]`, the groups of the tenant the caller belongs to (by name).
async fn groups_of(k: &Kernel, c: &crate::Caller) -> Result<Value> {
    let rows = mosaikit_db::query(
        "select g.id, g.name from core.groups g join core.group_members gm on gm.group_id = g.id
         where gm.user_id = $1 and g.tenant_id = $2 order by g.name, g.id",
    )
    .bind(c.user.user_id)
    .bind(c.tenant.tenant_id)
    .fetch_all(&k.db)
    .await?;
    Ok(Value::Array(
        rows.iter()
            .map(|r| json!({ "id": r.get::<uuid::Uuid, _>(0).to_string(), "name": r.get::<String, _>(1) }))
            .collect(),
    ))
}

pub(crate) fn ctx_json(c: &crate::Caller, plugin: &str) -> Value {
    json!({
        "user": c.user.user_id.to_string(),
        "username": c.user.username,
        "tenant": c.tenant.tenant_id.to_string(),
        "plugin": plugin,
    })
}
