//! SQLite backend (default of the desktop version).
//!
//! The same rules as PostgreSQL, applied differently:
//! - context (user, tenant, plugin, link) per connection, read by the functions
//!   `core_ctx_*()` registered from Rust: SQL cannot change it;
//! - in the transactions of the plugins the queries are rewritten (`mosaikit_sql_guard::sqlite`):
//!   the rows of the protected tables go through the filter on the access level;
//! - triggers on the tables of the plugins for INSERT/UPDATE/DELETE (like `WITH CHECK`);
//! - SQLite authorizer on the SQL written by the plugins: no writes outside its
//!   own tables, no secrets, PRAGMA or ATTACH.
//!
//! rusqlite is synchronous: every operation runs in `spawn_blocking` with a
//! connection of the pool (WAL, `busy_timeout`, foreign keys on).

pub mod plugin_schema;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use mosaikit_sql_guard::sqlite::{self as tr, Mode, Scope};
use rusqlite::functions::FunctionFlags;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::types::{Value as SqlValue, ValueRef};
use serde_json::Value;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

use crate::value::{ts_text, Param, Row, Val};
use crate::{Ctx, DbError, Query, Result};

const MIGRATIONS: &[(i64, &str, &str)] = &[
    (1, "core", include_str!("0001_core.sql")),
    (2, "admins", include_str!("0002_admins.sql")),
    (3, "service_keys", include_str!("0003_service_keys.sql")),
    (4, "notifications", include_str!("0004_notifications.sql")),
    (5, "people", include_str!("0005_people.sql")),
];

/// Context of the transaction on the connection (read by `core_ctx_*()`).
#[derive(Debug, Clone, Default)]
struct CtxState {
    user: Option<String>,
    tenant: Option<String>,
    plugin: Option<String>,
    link: Option<String>,
    /// transaction of a plugin: the check triggers are active
    active: bool,
}

pub(crate) struct PConn {
    conn: rusqlite::Connection,
    ctx: Arc<Mutex<CtxState>>,
}

impl PConn {
    fn set_ctx(&self, c: CtxState) {
        *self.ctx.lock().expect("context") = c;
    }
}

pub(crate) struct Inner {
    path: PathBuf,
    pool: Mutex<Vec<PConn>>,
    sem: Arc<Semaphore>,
    scopes: RwLock<HashMap<String, Arc<Scope>>>,
    generation: AtomicU64,
    cache: Mutex<HashMap<String, Arc<str>>>,
}

pub struct LiteDb {
    inner: Arc<Inner>,
}

pub(crate) fn map_err(e: rusqlite::Error) -> DbError {
    match e {
        rusqlite::Error::QueryReturnedNoRows => DbError::RowNotFound,
        rusqlite::Error::SqliteFailure(f, msg) => {
            let message = msg.unwrap_or_else(|| f.to_string());
            // errors of Mosaikit (triggers, checks): "mosaikit[SQLSTATE]: message"
            if let Some(rest) = message.strip_prefix("mosaikit[") {
                if let Some((code, m)) = rest.split_once("]: ") {
                    return DbError::Sql { code: Some(code.to_string()), message: m.to_string() };
                }
            }
            use rusqlite::ffi;
            let code = match f.extended_code {
                ffi::SQLITE_CONSTRAINT_UNIQUE | ffi::SQLITE_CONSTRAINT_PRIMARYKEY => Some("23505"),
                ffi::SQLITE_CONSTRAINT_NOTNULL => Some("23502"),
                ffi::SQLITE_CONSTRAINT_CHECK => Some("23514"),
                ffi::SQLITE_CONSTRAINT_FOREIGNKEY => Some("23503"),
                _ if f.code == rusqlite::ErrorCode::AuthorizationForStatementDenied => Some("42501"),
                _ => None,
            };
            DbError::Sql { code: code.map(str::to_string), message }
        }
        other => DbError::Sql { code: None, message: other.to_string() },
    }
}

/// Error with an SQLSTATE code (the same codes as the core functions of PostgreSQL).
pub(crate) fn sql_err(code: &str, m: &str) -> DbError {
    DbError::Sql { code: Some(code.to_string()), message: m.to_string() }
}

fn to_sql(p: &Param) -> SqlValue {
    match p {
        Param::Null(_) => SqlValue::Null,
        Param::Bool(b) => SqlValue::Integer(*b as i64),
        Param::I16(v) => SqlValue::Integer(*v as i64),
        Param::I32(v) => SqlValue::Integer(*v as i64),
        Param::I64(v) => SqlValue::Integer(*v),
        Param::F64(v) => SqlValue::Real(*v),
        Param::Text(s) => SqlValue::Text(s.clone()),
        Param::Bytes(b) => SqlValue::Blob(b.clone()),
        Param::Uuid(u) => SqlValue::Text(u.to_string()),
        Param::Ts(t) => SqlValue::Text(ts_text(t)),
        Param::Date(d) => SqlValue::Text(d.to_string()),
        Param::Json(v) => SqlValue::Text(v.to_string()),
        Param::Uuids(v) => SqlValue::Text(
            serde_json::to_string(&v.iter().map(|u| u.to_string()).collect::<Vec<_>>()).unwrap_or_default(),
        ),
        Param::Texts(v) => SqlValue::Text(serde_json::to_string(v).unwrap_or_default()),
    }
}

/// Runs a statement. `json`: typed json/bool columns (results for the plugins).
fn exec(
    c: &PConn,
    sql: &str,
    params: &[Param],
    _fetch: bool,
    cached: bool,
    json: bool,
) -> Result<(Vec<Row>, u64)> {
    let mut cached_st;
    let mut plain_st;
    let st: &mut rusqlite::Statement = if cached {
        cached_st = c.conn.prepare_cached(sql).map_err(|e| with_sql(map_err(e), sql))?;
        &mut cached_st
    } else {
        plain_st = c.conn.prepare(sql).map_err(|e| with_sql(map_err(e), sql))?;
        &mut plain_st
    };
    let n = st.parameter_count();
    for (i, p) in params.iter().enumerate().take(n) {
        st.raw_bind_parameter(i + 1, to_sql(p)).map_err(map_err)?;
    }
    if st.column_count() == 0 {
        let changed = st.raw_execute().map_err(map_err)?;
        return Ok((Vec::new(), changed as u64));
    }
    let cols: Arc<Vec<String>> = Arc::new(st.column_names().iter().map(|s| s.to_string()).collect());
    let decl: Vec<String> =
        st.columns().iter().map(|c| c.decl_type().unwrap_or_default().to_ascii_lowercase()).collect();
    let mut out = Vec::new();
    let mut rows = st.raw_query();
    while let Some(r) = rows.next().map_err(map_err)? {
        let mut vals = Vec::with_capacity(cols.len());
        for (i, d) in decl.iter().enumerate() {
            let v = r.get_ref(i).map_err(map_err)?;
            vals.push(match v {
                ValueRef::Null => Val::Null,
                ValueRef::Integer(x) if json && d.starts_with("bool") => Val::Bool(x != 0),
                ValueRef::Integer(x) => Val::Int(x),
                ValueRef::Real(x) => Val::Float(x),
                ValueRef::Text(t) => {
                    let s = String::from_utf8_lossy(t).into_owned();
                    if json && d.starts_with("json") {
                        serde_json::from_str(&s).map(Val::Json).unwrap_or(Val::Text(s))
                    } else {
                        Val::Text(s)
                    }
                }
                ValueRef::Blob(b) => Val::Bytes(b.to_vec()),
            });
        }
        out.push(Row::new(cols.clone(), vals));
    }
    drop(rows);
    Ok((out, c.conn.changes()))
}

fn with_sql(e: DbError, sql: &str) -> DbError {
    match e {
        DbError::Sql { code: None, message } => {
            tracing::debug!("SQLite: {message} in: {sql}");
            DbError::Sql {
                code: None,
                message: format!("{message} (in: {})", sql.chars().take(200).collect::<String>()),
            }
        }
        other => other,
    }
}

fn open_conn(path: &Path) -> Result<PConn> {
    let conn = rusqlite::Connection::open(path).map_err(map_err)?;
    conn.busy_timeout(Duration::from_secs(15)).map_err(map_err)?;
    conn.execute_batch(
        "pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on; \
         pragma trusted_schema = on; pragma recursive_triggers = off;",
    )
    .map_err(map_err)?;
    conn.set_prepared_statement_cache_capacity(256);
    let ctx: Arc<Mutex<CtxState>> = Arc::default();
    let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_INNOCUOUS;
    conn.create_scalar_function("gen_random_uuid", 0, flags, |_| Ok(Uuid::new_v4().to_string()))
        .map_err(map_err)?;
    type Getter = fn(&CtxState) -> Option<String>;
    let getters: [(&str, Getter); 4] = [
        ("core_ctx_user", |c| c.user.clone()),
        ("core_ctx_tenant", |c| c.tenant.clone()),
        ("core_ctx_plugin", |c| c.plugin.clone()),
        ("core_ctx_link", |c| c.link.clone()),
    ];
    for (name, get) in getters {
        let state = ctx.clone();
        conn.create_scalar_function(name, 0, flags, move |_| Ok(get(&state.lock().expect("context"))))
            .map_err(map_err)?;
    }
    let state = ctx.clone();
    conn.create_scalar_function("core_ctx_active", 0, flags, move |_| {
        Ok(state.lock().expect("context").active)
    })
    .map_err(map_err)?;
    Ok(PConn { conn, ctx })
}

fn migrate(c: &PConn) -> Result<()> {
    c.conn
        .execute_batch(
            "create table if not exists core_migrations (version integer primary key, name text not null, \
             applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))",
        )
        .map_err(map_err)?;
    for (v, name, sql) in MIGRATIONS {
        let done: bool = c
            .conn
            .query_row("select exists (select 1 from core_migrations where version = ?1)", [v], |r| r.get(0))
            .map_err(map_err)?;
        if done {
            continue;
        }
        c.conn.execute_batch("begin immediate").map_err(map_err)?;
        let r = c
            .conn
            .execute_batch(sql)
            .and_then(|_| {
                c.conn.execute(
                    "insert into core_migrations (version, name) values (?1, ?2)",
                    rusqlite::params![v, name],
                )
            })
            .and_then(|_| c.conn.execute_batch("commit"));
        if let Err(e) = r {
            let _ = c.conn.execute_batch("rollback");
            return Err(map_err(e));
        }
    }
    Ok(())
}

/// Objects of a plugin, read from the connection (it also sees uncommitted changes).
pub(crate) fn load_scope(c: &PConn, plugin_id: &str) -> Result<Scope> {
    let schema: Option<String> = c
        .conn
        .query_row("select schema_name from core_plugins where id = ?1", [plugin_id], |r| r.get(0))
        .map(Some)
        .or_else(|e| if matches!(e, rusqlite::Error::QueryReturnedNoRows) { Ok(None) } else { Err(e) })
        .map_err(map_err)?;
    let Some(schema) = schema else {
        return Err(DbError::Invalid(format!("plugin not installed: {plugin_id}")));
    };
    load_scope_schema(c, &schema, Some(plugin_id))
}

pub(crate) fn load_scope_schema(c: &PConn, schema: &str, plugin_id: Option<&str>) -> Result<Scope> {
    let mut scope = Scope { schema: schema.to_string(), ..Scope::default() };
    let prefix = scope.prefix();
    let mut st = c
        .conn
        .prepare("select name, type from sqlite_master where type in ('table', 'view') and substr(name, 1, length(?1)) = ?1")
        .map_err(map_err)?;
    let objs: Vec<(String, String)> = st
        .query_map([&prefix], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(map_err)?
        .collect::<std::result::Result<_, _>>()
        .map_err(map_err)?;
    for (name, kind) in objs {
        let logical = name[prefix.len()..].to_string();
        if kind == "view" {
            scope.kpi_views.insert(logical);
        } else {
            let protected: bool = c
                .conn
                .query_row(
                    "select exists (select 1 from pragma_table_info(?1) where name = 'resource_id')",
                    [&name],
                    |r| r.get(0),
                )
                .map_err(map_err)?;
            scope.tables.insert(logical, protected);
        }
    }
    if let Some(id) = plugin_id {
        let mut st = c
            .conn
            .prepare("select name, sql from core_plugin_views where plugin_id = ?1")
            .map_err(map_err)?;
        let views: Vec<(String, String)> = st
            .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(map_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(map_err)?;
        scope.views = views.into_iter().collect();
    }
    Ok(scope)
}

impl Inner {
    async fn acquire(self: &Arc<Self>) -> Result<(PConn, OwnedSemaphorePermit)> {
        let permit =
            self.sem.clone().acquire_owned().await.map_err(|_| DbError::Invalid("database closed".into()))?;
        let pooled = self.pool.lock().expect("pool").pop();
        let c = match pooled {
            Some(c) => c,
            None => {
                let path = self.path.clone();
                tokio::task::spawn_blocking(move || open_conn(&path))
                    .await
                    .map_err(|e| DbError::Invalid(e.to_string()))??
            }
        };
        Ok((c, permit))
    }

    fn release(&self, c: PConn) {
        c.set_ctx(CtxState::default());
        self.pool.lock().expect("pool").push(c);
    }

    /// SQL for SQLite: explicit variant or translation (cached).
    fn sql_for(&self, q: &Query, scope: Option<&Scope>) -> Result<Arc<str>> {
        if let Some(l) = &q.lite {
            return Ok(Arc::from(l.as_str()));
        }
        let key = format!(
            "k|{}|{}|{}",
            scope.map(|s| s.schema.as_str()).unwrap_or(""),
            if scope.is_some() { self.generation.load(Ordering::Relaxed) } else { 0 },
            q.sql
        );
        if let Some(s) = self.cache.lock().expect("cache").get(&key) {
            return Ok(s.clone());
        }
        let s: Arc<str> = Arc::from(tr::translate_one(&q.sql, Mode::Kernel(scope)).map_err(|e| {
            DbError::Invalid(format!("SQL cannot be translated for SQLite: {e} (in: {})", q.sql))
        })?);
        let mut cache = self.cache.lock().expect("cache");
        if cache.len() > 4096 {
            cache.clear();
        }
        cache.insert(key, s.clone());
        Ok(s)
    }

    fn invalidate(&self, plugin_id: &str) {
        self.scopes.write().expect("scope").remove(plugin_id);
        self.generation.fetch_add(1, Ordering::Relaxed);
    }
}

async fn blocking<R: Send + 'static>(
    mut c: PConn,
    f: impl FnOnce(&mut PConn) -> Result<R> + Send + 'static,
) -> (PConn, Result<R>) {
    match tokio::task::spawn_blocking(move || {
        let r = f(&mut c);
        (c, r)
    })
    .await
    {
        Ok(x) => x,
        Err(e) => std::panic::resume_unwind(e.into_panic()),
    }
}

impl LiteDb {
    pub async fn open(path: &Path, max_connections: u32) -> Result<LiteDb> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| DbError::Invalid(format!("{}: {e}", dir.display())))?;
        }
        let p = path.to_path_buf();
        let first = tokio::task::spawn_blocking(move || -> Result<PConn> {
            let c = open_conn(&p)?;
            migrate(&c)?;
            Ok(c)
        })
        .await
        .map_err(|e| DbError::Invalid(e.to_string()))??;
        let inner = Arc::new(Inner {
            path: path.to_path_buf(),
            pool: Mutex::new(vec![first]),
            sem: Arc::new(Semaphore::new(max_connections.max(2) as usize)),
            scopes: RwLock::default(),
            generation: AtomicU64::new(1),
            cache: Mutex::default(),
        });
        Ok(LiteDb { inner })
    }

    pub fn close(&self) {
        self.inner.sem.close();
        self.inner.pool.lock().expect("pool").clear();
    }

    pub fn forget_plugin(&self, plugin_id: &str) {
        self.inner.invalidate(plugin_id);
    }

    pub fn plugin_schema(&self, plugin_id: &str, schema: &str) -> plugin_schema::LitePluginSchema {
        plugin_schema::LitePluginSchema {
            plugin_id: plugin_id.to_string(),
            schema: schema.to_string(),
            db: self.inner.clone(),
        }
    }

    /// Query on the pool (autocommit, no context).
    pub(crate) async fn run(&self, q: Query, fetch: bool) -> Result<(Vec<Row>, u64)> {
        let sql = self.inner.sql_for(&q, None)?;
        let (c, permit) = self.inner.acquire().await?;
        let (c, r) = blocking(c, move |c| exec(c, &sql, &q.params, fetch, true, false)).await;
        self.inner.release(c);
        drop(permit);
        r
    }

    /// Transaction (BEGIN IMMEDIATE: writes are serialized, no deadlocks
    /// from lock promotion).
    pub(crate) async fn begin(&self, ctx: Option<Ctx>, plugin: bool) -> Result<LiteTx> {
        let (c, permit) = self.inner.acquire().await?;
        let state = match &ctx {
            Some(x) => CtxState {
                user: x.user.map(|u| u.to_string()),
                tenant: x.tenant.map(|u| u.to_string()),
                plugin: x.plugin.clone(),
                link: x.link.map(|u| u.to_string()),
                active: plugin,
            },
            None => CtxState::default(),
        };
        c.set_ctx(state);
        let plugin_id = if plugin { ctx.as_ref().and_then(|x| x.plugin.clone()) } else { None };
        let (c, r) = blocking(c, move |c| c.conn.execute_batch("begin immediate").map_err(map_err)).await;
        let mut tx = LiteTx { db: self.inner.clone(), conn: Some(c), _permit: Some(permit), scope: None };
        r?;
        if let Some(id) = plugin_id {
            tx.scope = Some(tx.scope_of(&id).await?);
        }
        Ok(tx)
    }
}

pub struct LiteTx {
    db: Arc<Inner>,
    conn: Option<PConn>,
    _permit: Option<OwnedSemaphorePermit>,
    scope: Option<Arc<Scope>>,
}

impl Drop for LiteTx {
    fn drop(&mut self) {
        if let Some(c) = self.conn.take() {
            // transaction not committed: rolled back
            let _ = c.conn.execute_batch("rollback");
            self.db.release(c);
        }
    }
}

impl LiteTx {
    async fn with<R: Send + 'static>(
        &mut self,
        f: impl FnOnce(&mut PConn) -> Result<R> + Send + 'static,
    ) -> Result<R> {
        let c = self.conn.take().ok_or_else(|| DbError::Invalid("transaction closed".into()))?;
        let (c, r) = blocking(c, f).await;
        self.conn = Some(c);
        r
    }

    async fn scope_of(&mut self, plugin_id: &str) -> Result<Arc<Scope>> {
        if let Some(s) = self.db.scopes.read().expect("scope").get(plugin_id) {
            return Ok(s.clone());
        }
        let id = plugin_id.to_string();
        let s = Arc::new(self.with(move |c| load_scope(c, &id)).await?);
        self.db.scopes.write().expect("scope").insert(plugin_id.to_string(), s.clone());
        Ok(s)
    }

    async fn finish(mut self, sql: &'static str) -> Result<()> {
        let r = self.with(move |c| c.conn.execute_batch(sql).map_err(map_err)).await;
        if let Some(c) = self.conn.take() {
            if r.is_err() {
                let _ = c.conn.execute_batch("rollback");
            }
            self.db.release(c);
        }
        r
    }

    pub async fn commit(self) -> Result<()> {
        self.finish("commit").await
    }

    pub async fn rollback(self) -> Result<()> {
        self.finish("rollback").await
    }

    pub(crate) async fn run(&mut self, q: Query, fetch: bool) -> Result<(Vec<Row>, u64)> {
        let sql = self.db.sql_for(&q, self.scope.as_deref())?;
        self.with(move |c| exec(c, &sql, &q.params, fetch, true, false)).await
    }

    /// Runs SQL already translated (DDL of the migrations, internal checks).
    pub(crate) async fn raw(
        &mut self,
        sql: String,
        params: Vec<Param>,
        fetch: bool,
    ) -> Result<(Vec<Row>, u64)> {
        self.with(move |c| exec(c, &sql, &params, fetch, false, false)).await
    }

    pub(crate) async fn reload_scope(&mut self, plugin_id: &str) -> Result<Scope> {
        let id = plugin_id.to_string();
        self.with(move |c| load_scope(c, &id)).await
    }

    async fn level(&mut self, id: Uuid) -> Result<i64> {
        let sql = format!("select {}", tr::level_of("?1"));
        let (rows, _) = self.raw(sql, vec![Param::Uuid(id)], true).await?;
        rows.first().map(|r| r.try_get::<i64, _>(0)).unwrap_or(Ok(0))
    }

    async fn ctx(&mut self) -> Result<CtxState> {
        self.with(|c| Ok(c.ctx.lock().expect("context").clone())).await
    }

    async fn resource(&mut self, id: Uuid) -> Result<Option<(String, String, Vec<Uuid>)>> {
        let (rows, _) = self
            .raw(
                "select tenant_id, plugin_id, ancestors from core_resources where id = ?1".into(),
                vec![Param::Uuid(id)],
                true,
            )
            .await?;
        Ok(match rows.first() {
            Some(r) => Some((r.try_get(0)?, r.try_get(1)?, r.try_get::<Vec<Uuid>, _>(2)?)),
            None => None,
        })
    }

    pub(crate) async fn create_resource(
        &mut self,
        kind: &str,
        title: &str,
        parent: Option<Uuid>,
        meta: &Value,
    ) -> Result<Uuid> {
        let c = self.ctx().await?;
        let (Some(user), Some(tenant), Some(plugin)) = (c.user.clone(), c.tenant.clone(), c.plugin.clone())
        else {
            return Err(sql_err("42501", "invalid context to create resources"));
        };
        if c.link.is_some() {
            return Err(sql_err("42501", "invalid context to create resources"));
        }
        let member_sql = format!("select {}", tr::is_member("?1", "?2"));
        let (rows, _) =
            self.raw(member_sql, vec![Param::Text(user.clone()), Param::Text(tenant.clone())], true).await?;
        if !rows.first().map(|r| r.try_get::<bool, _>(0)).transpose()?.unwrap_or(false) {
            return Err(sql_err("42501", "invalid context to create resources"));
        }
        let valid = !kind.is_empty()
            && kind.len() <= 48
            && kind.starts_with(|c: char| c.is_ascii_lowercase())
            && kind.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        if !valid {
            return Err(sql_err("22023", "invalid resource kind"));
        }
        let mut anc: Vec<Uuid> = Vec::new();
        if let Some(p) = parent {
            match self.resource(p).await? {
                Some((t, pl, a)) if t == tenant && pl == plugin => {
                    if self.level(p).await? < 2 {
                        return Err(sql_err("42501", "write permission on the parent required"));
                    }
                    anc = a;
                    anc.push(p);
                }
                _ => return Err(sql_err("22023", "invalid parent")),
            }
        }
        let id = Uuid::new_v4();
        self.raw(
            "insert into core_resources (id, tenant_id, plugin_id, kind, parent_id, ancestors, owner_id, title, meta) \
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
                .into(),
            vec![
                Param::Uuid(id),
                Param::Text(tenant),
                Param::Text(plugin),
                Param::Text(kind.to_string()),
                parent.map(Param::Uuid).unwrap_or(Param::Null(crate::Ty::Uuid)),
                Param::Uuids(anc),
                Param::Text(user),
                Param::Text(title.to_string()),
                Param::Json(if meta.is_null() { serde_json::json!({}) } else { meta.clone() }),
            ],
            false,
        )
        .await?;
        Ok(id)
    }

    pub(crate) async fn update_resource(
        &mut self,
        id: Uuid,
        title: Option<&str>,
        meta: Option<&Value>,
        size: Option<i64>,
    ) -> Result<()> {
        if self.level(id).await? < 2 {
            return Err(sql_err("42501", "write permission required"));
        }
        let merged = match meta {
            None => None,
            Some(patch) => {
                let (rows, _) = self
                    .raw("select meta from core_resources where id = ?1".into(), vec![Param::Uuid(id)], true)
                    .await?;
                let mut cur: Value =
                    rows.first().map(|r| r.try_get(0)).transpose()?.unwrap_or_else(|| serde_json::json!({}));
                // like `meta || p_meta` of PostgreSQL: union of the first-level keys
                if let (Some(o), Some(p)) = (cur.as_object_mut(), patch.as_object()) {
                    for (k, v) in p {
                        o.insert(k.clone(), v.clone());
                    }
                }
                Some(cur)
            }
        };
        self.raw(
            format!(
                "update core_resources set title = coalesce(?2, title), meta = coalesce(?3, meta), \
                 size_bytes = coalesce(?4, size_bytes), updated_at = {} where id = ?1",
                tr::NOW
            ),
            vec![
                Param::Uuid(id),
                title.map(|t| Param::Text(t.into())).unwrap_or(Param::Null(crate::Ty::Text)),
                merged.map(Param::Json).unwrap_or(Param::Null(crate::Ty::Json)),
                size.map(Param::I64).unwrap_or(Param::Null(crate::Ty::I64)),
            ],
            false,
        )
        .await?;
        Ok(())
    }

    pub(crate) async fn move_resource(&mut self, id: Uuid, parent: Option<Uuid>) -> Result<()> {
        if self.level(id).await? < 3 {
            return Err(sql_err("42501", "manage permission required"));
        }
        let Some((tenant, plugin, _)) = self.resource(id).await? else {
            return Err(sql_err("42501", "manage permission required"));
        };
        let mut anc: Vec<Uuid> = Vec::new();
        if let Some(p) = parent {
            let Some((pt, pp, pa)) = self.resource(p).await? else {
                return Err(sql_err("22023", "invalid destination"));
            };
            if pt != tenant || pp != plugin {
                return Err(sql_err("22023", "invalid destination"));
            }
            if p == id || pa.contains(&id) {
                return Err(sql_err("22023", "a folder cannot be moved into itself"));
            }
            if self.level(p).await? < 2 {
                return Err(sql_err("42501", "write permission on the destination required"));
            }
            anc = pa;
            anc.push(p);
        }
        self.raw(
            format!(
                "update core_resources set parent_id = ?2, ancestors = ?3, updated_at = {} where id = ?1",
                tr::NOW
            ),
            vec![
                Param::Uuid(id),
                parent.map(Param::Uuid).unwrap_or(Param::Null(crate::Ty::Uuid)),
                Param::Uuids(anc.clone()),
            ],
            false,
        )
        .await?;
        // descendants: new prefix + the part after the moved resource
        let (rows, _) = self
            .raw(
                "select id, ancestors from core_resources where ?1 in (select value from json_each(ancestors))".into(),
                vec![Param::Uuid(id)],
                true,
            )
            .await?;
        for r in rows {
            let did: Uuid = r.try_get(0)?;
            let old: Vec<Uuid> = r.try_get(1)?;
            let pos = old.iter().position(|x| *x == id).unwrap_or(0);
            let mut new = anc.clone();
            new.push(id);
            new.extend_from_slice(&old[pos + 1..]);
            self.raw(
                "update core_resources set ancestors = ?2 where id = ?1".into(),
                vec![Param::Uuid(did), Param::Uuids(new)],
                false,
            )
            .await?;
        }
        Ok(())
    }

    pub(crate) async fn delete_resource(&mut self, id: Uuid) -> Result<Vec<Uuid>> {
        if self.level(id).await? < 3 {
            return Err(sql_err("42501", "manage permission required"));
        }
        let (rows, _) = self
            .raw(
                "select id from core_resources where id = ?1 or ?1 in (select value from json_each(ancestors))".into(),
                vec![Param::Uuid(id)],
                true,
            )
            .await?;
        let ids: Vec<Uuid> = rows.iter().map(|r| r.try_get(0)).collect::<Result<_>>()?;
        self.raw("delete from core_resources where id = ?1".into(), vec![Param::Uuid(id)], false).await?;
        Ok(ids)
    }

    /// SQL written by the plugin (already through `check_query`): translated, filtered,
    /// run with the SQLite authorizer.
    pub(crate) async fn plugin_sql(&mut self, sql: &str, rows: bool, params: Vec<Param>) -> Result<Value> {
        let scope = self
            .scope
            .clone()
            .ok_or_else(|| DbError::Invalid("SQL of the plugin outside one of its transactions".into()))?;
        let lite = tr::translate_one(sql, Mode::Plugin(&scope))
            .map_err(|e| DbError::Sql { code: Some("42501".into()), message: e.to_string() })?;
        let prefix = scope.prefix();
        self.with(move |c| {
            c.conn.authorizer(Some(move |a: AuthContext<'_>| authorize(&prefix, &a)));
            let r = exec(c, &lite, &params, rows, false, true);
            c.conn.authorizer(None::<fn(AuthContext<'_>) -> Authorization>);
            let (out, n) = r?;
            Ok(if rows {
                Value::Array(out.iter().map(Row::to_json).collect())
            } else {
                serde_json::json!({ "rows": n })
            })
        })
        .await
    }
}

/// Defence in depth on the SQL of the plugins (after the translation that already limits it).
fn authorize(prefix: &str, a: &AuthContext<'_>) -> Authorization {
    match a.action {
        AuthAction::Read { table_name, column_name } => {
            let secret_table = matches!(
                table_name,
                "core_secrets" | "core_sessions" | "core_tickets" | "core_migrations" | "core_service_keys"
            );
            let secret_col = matches!(
                column_name,
                "password_hash" | "role_password" | "token_hash" | "csrf" | "totp_secret" | "totp_recovery"
            );
            if secret_table || secret_col || table_name.starts_with("sqlite_") {
                Authorization::Deny
            } else {
                Authorization::Allow
            }
        }
        AuthAction::Insert { table_name }
        | AuthAction::Delete { table_name }
        | AuthAction::Update { table_name, .. } => {
            if table_name.starts_with(prefix) {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        AuthAction::Select | AuthAction::Recursive => Authorization::Allow,
        AuthAction::Function { function_name } => {
            let f = function_name.to_ascii_lowercase();
            if f == "load_extension" || f.starts_with("sqlite_") || f == "readfile" || f == "writefile" {
                Authorization::Deny
            } else {
                Authorization::Allow
            }
        }
        _ => Authorization::Deny,
    }
}
