//! Data access of Mosaikit: PostgreSQL or SQLite, with the same rules.
//!
//! - `query`/`query_scalar`: SQL written for PostgreSQL; on SQLite it is translated
//!   (see `mosaikit_sql_guard::sqlite`) or replaced with `.sqlite(...)`;
//! - transactions with a security context (user, tenant, plugin, public link);
//! - transactions of the plugins: on PostgreSQL role of the plugin + RLS, on SQLite
//!   rows filtered by rewriting the queries and check triggers;
//! - schemas of the plugins: migrations, checks, freezing.
//!
//! See `docs/architecture.md` §7.

mod lite;
mod pg;
pub mod testing;
pub mod value;

use std::ops::{Deref, DerefMut};
use std::path::Path;

use serde_json::Value;
use uuid::Uuid;

pub use pg::{plugin_role, role_prefix};
pub use value::{ColIndex, FromVal, IntoParam, Param, ParamTy, Row, Ty, Val};

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Migrate(#[from] sqlx::migrate::MigrateError),
    /// SQL error with an SQLSTATE code (SQLite too, translated)
    #[error("{message}")]
    Sql { code: Option<String>, message: String },
    #[error("no row")]
    RowNotFound,
    #[error("{0}")]
    Decode(String),
    #[error("{0}")]
    Invalid(String),
}

pub type Result<T> = std::result::Result<T, DbError>;

/// SQLSTATE code of an error, if any.
pub fn sqlstate(e: &DbError) -> Option<String> {
    match e {
        DbError::Sqlx(sqlx::Error::Database(d)) => d.code().map(|c| c.to_string()),
        DbError::Sql { code, .. } => code.clone(),
        _ => None,
    }
}

/// Security context of a transaction.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Ctx {
    pub user: Option<Uuid>,
    pub tenant: Option<Uuid>,
    pub plugin: Option<String>,
    /// resource reached through a public link (read only)
    pub link: Option<Uuid>,
}

impl Ctx {
    pub fn user(user: Uuid, tenant: Uuid) -> Ctx {
        Ctx { user: Some(user), tenant: Some(tenant), ..Ctx::default() }
    }
    pub fn with_plugin(mut self, plugin: &str) -> Ctx {
        self.plugin = Some(plugin.to_string());
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Postgres,
    Sqlite,
}

pub struct Db {
    inner: Inner,
}

enum Inner {
    Pg(Box<pg::PgDb>),
    Lite(lite::LiteDb),
}

impl Db {
    /// PostgreSQL: connects, checks the version, applies the core migrations.
    pub async fn connect(url: &str, max_connections: u32) -> Result<Db> {
        Ok(Db { inner: Inner::Pg(Box::new(pg::PgDb::connect(url, max_connections).await?)) })
    }

    /// SQLite: opens (or creates) the file and applies the core migrations.
    pub async fn open_sqlite(path: &Path, max_connections: u32) -> Result<Db> {
        Ok(Db { inner: Inner::Lite(lite::LiteDb::open(path, max_connections).await?) })
    }

    pub fn backend(&self) -> Backend {
        match self.inner {
            Inner::Pg(_) => Backend::Postgres,
            Inner::Lite(_) => Backend::Sqlite,
        }
    }

    pub fn is_sqlite(&self) -> bool {
        self.backend() == Backend::Sqlite
    }

    /// PostgreSQL pool of the application (PostgreSQL-specific tools and tests).
    pub fn pg_pool(&self) -> Option<&sqlx::PgPool> {
        match &self.inner {
            Inner::Pg(p) => Some(&p.app),
            Inner::Lite(_) => None,
        }
    }

    /// Prefix of the PostgreSQL roles (empty on SQLite).
    pub fn role_prefix(&self) -> &str {
        match &self.inner {
            Inner::Pg(p) => &p.role_prefix,
            Inner::Lite(_) => "",
        }
    }

    /// Transaction of the application without context (administrative operations).
    pub async fn begin_app(&self) -> Result<Tx> {
        Ok(Tx(match &self.inner {
            Inner::Pg(p) => TxConn::Pg(p.begin_app().await?),
            Inner::Lite(l) => TxConn::Lite(l.begin(None, false).await?),
        }))
    }

    /// Transaction of the application with the context set.
    pub async fn begin(&self, ctx: &Ctx) -> Result<Tx> {
        Ok(Tx(match &self.inner {
            Inner::Pg(p) => TxConn::Pg(p.begin(ctx).await?),
            Inner::Lite(l) => TxConn::Lite(l.begin(Some(ctx.clone()), false).await?),
        }))
    }

    /// Transaction of the plugin: it sees only the rows the context allows.
    pub async fn begin_plugin(&self, plugin_id: &str, ctx: &Ctx) -> Result<Tx> {
        let ctx = Ctx { plugin: Some(plugin_id.to_string()), ..ctx.clone() };
        Ok(Tx(match &self.inner {
            Inner::Pg(p) => TxConn::Pg(p.begin_plugin(plugin_id, &ctx).await?),
            Inner::Lite(l) => TxConn::Lite(l.begin(Some(ctx), true).await?),
        }))
    }

    /// To call after installing, updating or uninstalling a plugin.
    pub async fn forget_plugin_pool(&self, plugin_id: &str) {
        match &self.inner {
            Inner::Pg(p) => p.forget_plugin_pool(plugin_id).await,
            Inner::Lite(l) => l.forget_plugin(plugin_id),
        }
    }

    /// Name of the PostgreSQL role of a plugin (SQLite has no roles: informative).
    pub fn plugin_role(&self, plugin_id: &str) -> String {
        match &self.inner {
            Inner::Pg(p) => p.plugin_role(plugin_id),
            Inner::Lite(_) => plugin_role("sqlite", plugin_id),
        }
    }

    /// Schema of the plugin for migrations and checks.
    pub fn plugin_schema(&self, plugin_id: &str, schema: &str) -> PluginSchema {
        PluginSchema(match &self.inner {
            Inner::Pg(p) => SchemaInner::Pg(p.plugin_schema(plugin_id, schema)),
            Inner::Lite(l) => SchemaInner::Lite(l.plugin_schema(plugin_id, schema)),
        })
    }

    pub async fn close(&self) {
        match &self.inner {
            Inner::Pg(p) => p.app.close().await,
            Inner::Lite(l) => l.close(),
        }
    }
}

// ------------------------------------------------------------------ transactions

pub struct Tx(TxConn);

pub enum TxConn {
    Pg(pg::PgTx),
    Lite(lite::LiteTx),
}

impl Deref for Tx {
    type Target = TxConn;
    fn deref(&self) -> &TxConn {
        &self.0
    }
}

impl DerefMut for Tx {
    fn deref_mut(&mut self) -> &mut TxConn {
        &mut self.0
    }
}

impl Tx {
    pub async fn commit(self) -> Result<()> {
        match self.0 {
            TxConn::Pg(t) => Ok(t.commit().await?),
            TxConn::Lite(t) => t.commit().await,
        }
    }

    pub async fn rollback(self) -> Result<()> {
        match self.0 {
            TxConn::Pg(t) => Ok(t.rollback().await?),
            TxConn::Lite(t) => t.rollback().await,
        }
    }
}

impl TxConn {
    async fn sql(&mut self, sql: &'static str) -> Result<()> {
        query(sql).execute(&mut *self).await.map(|_| ())
    }

    pub async fn savepoint(&mut self) -> Result<()> {
        self.sql("savepoint msk_sp").await
    }

    pub async fn release_savepoint(&mut self) -> Result<()> {
        self.sql("release savepoint msk_sp").await
    }

    pub async fn rollback_savepoint(&mut self) -> Result<()> {
        self.sql("rollback to savepoint msk_sp").await
    }

    /// New resource of the context (user, tenant and plugin of the transaction).
    pub async fn create_resource(
        &mut self,
        kind: &str,
        title: &str,
        parent: Option<Uuid>,
        meta: &Value,
    ) -> Result<Uuid> {
        match self {
            TxConn::Pg(_) => {
                query_scalar("select core.create_resource($1, $2, $3, $4)")
                    .bind(kind)
                    .bind(title)
                    .bind(parent)
                    .bind(meta)
                    .fetch_one(self)
                    .await
            }
            TxConn::Lite(t) => t.create_resource(kind, title, parent, meta).await,
        }
    }

    /// Updates title, meta (merge) and size; requires write.
    pub async fn update_resource(
        &mut self,
        id: Uuid,
        title: Option<&str>,
        meta: Option<&Value>,
        size: Option<i64>,
    ) -> Result<()> {
        match self {
            TxConn::Pg(_) => query("select core.update_resource($1, $2, $3, $4)")
                .bind(id)
                .bind(title)
                .bind(meta.cloned())
                .bind(size)
                .execute(self)
                .await
                .map(|_| ()),
            TxConn::Lite(t) => t.update_resource(id, title, meta, size).await,
        }
    }

    /// Moves a resource (manage on the resource, write on the destination).
    pub async fn move_resource(&mut self, id: Uuid, parent: Option<Uuid>) -> Result<()> {
        match self {
            TxConn::Pg(_) => query("select core.move_resource($1, $2)")
                .bind(id)
                .bind(parent)
                .execute(self)
                .await
                .map(|_| ()),
            TxConn::Lite(t) => t.move_resource(id, parent).await,
        }
    }

    /// Deletes a resource and its descendants (manage required). Returns the deleted ids.
    pub async fn delete_resource(&mut self, id: Uuid) -> Result<Vec<Uuid>> {
        match self {
            TxConn::Pg(_) => {
                query_scalar("select * from core.delete_resource($1)").bind(id).fetch_all(self).await
            }
            TxConn::Lite(t) => t.delete_resource(id).await,
        }
    }

    /// SQL of a plugin, already checked by sql-guard, in a savepoint (an error does not
    /// invalidate the transaction). `rows`: returns the rows as a JSON array, otherwise
    /// `{"rows": <rows affected>}`.
    pub async fn plugin_sql(
        &mut self,
        sql: &str,
        select: bool,
        rows: bool,
        params: &[Value],
    ) -> Result<Value> {
        let params: Vec<Param> = params.iter().map(Param::from_json).collect();
        self.savepoint().await?;
        let out = match self {
            TxConn::Pg(tx) => {
                if rows {
                    let wrapped = if select {
                        format!("select coalesce(json_agg(t), '[]'::json) from ({sql}) t")
                    } else {
                        format!("with t as ({sql}) select coalesce(json_agg(t), '[]'::json) from t")
                    };
                    pg::run(&mut **tx, &wrapped, &params, true, false).await.and_then(|(r, _)| {
                        r.first().map(|r| r.try_get::<Value, _>(0)).unwrap_or(Ok(Value::Null))
                    })
                } else {
                    pg::run(&mut **tx, sql, &params, false, false)
                        .await
                        .map(|(_, n)| serde_json::json!({ "rows": n }))
                }
            }
            TxConn::Lite(t) => t.plugin_sql(sql, rows, params).await,
        };
        match out {
            Ok(v) => {
                self.release_savepoint().await?;
                Ok(v)
            }
            Err(e) => {
                let _ = self.rollback_savepoint().await;
                let _ = self.release_savepoint().await;
                Err(e)
            }
        }
    }
}

// ------------------------------------------------------------------ queries

/// Where to run a query: the pool of the application or a transaction.
pub enum Target<'a> {
    Db(&'a Db),
    Conn(&'a mut TxConn),
}

impl<'a> From<&'a Db> for Target<'a> {
    fn from(d: &'a Db) -> Target<'a> {
        Target::Db(d)
    }
}

impl<'a> From<&'a mut TxConn> for Target<'a> {
    fn from(c: &'a mut TxConn) -> Target<'a> {
        Target::Conn(c)
    }
}

impl<'a> From<&'a mut Tx> for Target<'a> {
    fn from(t: &'a mut Tx) -> Target<'a> {
        Target::Conn(&mut t.0)
    }
}

/// Query with parameters `$1, $2, ...` (PostgreSQL syntax).
#[derive(Debug, Clone)]
pub struct Query {
    pub(crate) sql: String,
    pub(crate) lite: Option<String>,
    pub(crate) params: Vec<Param>,
    /// DDL or dynamic SQL: no cached prepared statement (PostgreSQL)
    pub(crate) raw: bool,
}

pub fn query(sql: impl Into<String>) -> Query {
    Query { sql: sql.into(), lite: None, params: Vec::new(), raw: false }
}

/// Result of `execute`.
#[derive(Debug, Clone, Copy)]
pub struct Done(u64);

impl Done {
    pub fn rows_affected(&self) -> u64 {
        self.0
    }
}

impl Query {
    pub fn bind(mut self, v: impl IntoParam) -> Query {
        self.params.push(v.into_param());
        self
    }

    /// Variant for SQLite, when the automatic translation is not enough.
    pub fn sqlite(mut self, sql: impl Into<String>) -> Query {
        self.lite = Some(sql.into());
        self
    }

    pub fn persistent(mut self, yes: bool) -> Query {
        self.raw = !yes;
        self
    }

    async fn run(self, t: Target<'_>, fetch: bool) -> Result<(Vec<Row>, u64)> {
        match t {
            Target::Db(db) => match &db.inner {
                Inner::Pg(p) => pg::run(&p.app, &self.sql, &self.params, fetch, self.raw).await,
                Inner::Lite(l) => l.run(self, fetch).await,
            },
            Target::Conn(c) => match c {
                TxConn::Pg(tx) => pg::run(&mut **tx, &self.sql, &self.params, fetch, self.raw).await,
                TxConn::Lite(t) => t.run(self, fetch).await,
            },
        }
    }

    pub async fn execute<'a>(self, t: impl Into<Target<'a>>) -> Result<Done> {
        Ok(Done(self.run(t.into(), false).await?.1))
    }

    pub async fn fetch_all<'a>(self, t: impl Into<Target<'a>>) -> Result<Vec<Row>> {
        Ok(self.run(t.into(), true).await?.0)
    }

    pub async fn fetch_optional<'a>(self, t: impl Into<Target<'a>>) -> Result<Option<Row>> {
        Ok(self.run(t.into(), true).await?.0.into_iter().next())
    }

    pub async fn fetch_one<'a>(self, t: impl Into<Target<'a>>) -> Result<Row> {
        self.fetch_optional(t).await?.ok_or(DbError::RowNotFound)
    }
}

/// Query that returns a single column.
pub struct QueryScalar<O> {
    q: Query,
    _o: std::marker::PhantomData<fn() -> O>,
}

pub fn query_scalar<O>(sql: impl Into<String>) -> QueryScalar<O> {
    QueryScalar { q: query(sql), _o: std::marker::PhantomData }
}

impl<O> QueryScalar<O>
where
    O: for<'r> FromVal<'r>,
{
    pub fn bind(mut self, v: impl IntoParam) -> Self {
        self.q = self.q.bind(v);
        self
    }

    pub fn sqlite(mut self, sql: impl Into<String>) -> Self {
        self.q = self.q.sqlite(sql);
        self
    }

    pub async fn fetch_all<'a>(self, t: impl Into<Target<'a>>) -> Result<Vec<O>> {
        self.q.fetch_all(t).await?.iter().map(|r| r.try_get(0)).collect()
    }

    pub async fn fetch_optional<'a>(self, t: impl Into<Target<'a>>) -> Result<Option<O>> {
        self.q.fetch_optional(t).await?.map(|r| r.try_get(0)).transpose()
    }

    pub async fn fetch_one<'a>(self, t: impl Into<Target<'a>>) -> Result<O> {
        self.fetch_optional(t).await?.ok_or(DbError::RowNotFound)
    }
}

// ------------------------------------------------------------------ schemas of the plugins

#[derive(Debug, Clone, Default, PartialEq)]
pub struct FinalizeReport {
    pub tables: Vec<String>,
    pub kpi_views: Vec<String>,
    pub views: Vec<String>,
}

pub struct PluginSchema(SchemaInner);

enum SchemaInner {
    Pg(pg::plugin_schema::PgPluginSchema),
    Lite(lite::plugin_schema::LitePluginSchema),
}

fn pg_tx(tx: &mut TxConn) -> Result<&mut pg::PgTx> {
    match tx {
        TxConn::Pg(t) => Ok(t),
        TxConn::Lite(_) => Err(DbError::Invalid("SQLite transaction on a PostgreSQL schema".into())),
    }
}

fn lite_tx(tx: &mut TxConn) -> Result<&mut lite::LiteTx> {
    match tx {
        TxConn::Lite(t) => Ok(t),
        TxConn::Pg(_) => Err(DbError::Invalid("PostgreSQL transaction on an SQLite schema".into())),
    }
}

impl PluginSchema {
    /// Schemas added to the search_path of the plugin after its own (extensions such as PostGIS).
    pub fn with_search_path(mut self, extra: Vec<String>) -> PluginSchema {
        if let SchemaInner::Pg(s) = &mut self.0 {
            s.extra_path = extra;
        }
        self
    }

    /// Creates (or updates) the space of the plugin. Idempotent.
    pub async fn provision(&self, tx: &mut TxConn, password: &str) -> Result<()> {
        match &self.0 {
            SchemaInner::Pg(s) => s.provision(pg_tx(tx)?, password).await,
            SchemaInner::Lite(s) => s.provision(lite_tx(tx)?).await,
        }
    }

    /// Prepares the schema for a migration.
    pub async fn thaw(&self, tx: &mut TxConn) -> Result<()> {
        match &self.0 {
            SchemaInner::Pg(s) => s.thaw(pg_tx(tx)?).await,
            SchemaInner::Lite(_) => Ok(()),
        }
    }

    /// Runs statements already checked by sql-guard in the space of the plugin.
    pub async fn run_as_plugin(&self, tx: &mut TxConn, statements: &[String]) -> Result<()> {
        match &self.0 {
            SchemaInner::Pg(s) => s.run_as_plugin(pg_tx(tx)?, statements).await,
            SchemaInner::Lite(s) => s.run_as_plugin(lite_tx(tx)?, statements).await,
        }
    }

    /// Checks the rules and applies the security (RLS or triggers).
    pub async fn freeze(&self, tx: &mut TxConn) -> Result<FinalizeReport> {
        match &self.0 {
            SchemaInner::Pg(s) => s.freeze(pg_tx(tx)?).await,
            SchemaInner::Lite(s) => s.freeze(lite_tx(tx)?).await,
        }
    }

    /// Columns of a table of the plugin: name -> type (names of the PostgreSQL types).
    pub async fn columns(&self, tx: &mut TxConn, table: &str) -> Result<Vec<(String, String)>> {
        match &self.0 {
            SchemaInner::Pg(s) => s.columns(pg_tx(tx)?, table).await,
            SchemaInner::Lite(s) => s.columns(lite_tx(tx)?, table).await,
        }
    }

    /// Removes the whole space of the plugin (uninstall).
    pub async fn drop(&self, tx: &mut TxConn) -> Result<()> {
        match &self.0 {
            SchemaInner::Pg(s) => s.drop(pg_tx(tx)?).await,
            SchemaInner::Lite(s) => s.drop(lite_tx(tx)?).await,
        }
    }
}

// ------------------------------------------------------------------ utilities

/// Quoted SQL identifier.
pub fn qi(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// Quoted SQL literal.
pub fn ql(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_names() {
        assert_eq!(role_prefix("mosaikit"), "msk_mosaikit");
        assert_eq!(role_prefix("msk_t_abc"), "msk_t_abc");
        assert!(role_prefix(&"x".repeat(80)).len() <= 28);
    }
}
