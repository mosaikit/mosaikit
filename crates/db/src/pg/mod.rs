//! PostgreSQL backend.
//!
//! - pool of the application (app role, owner of the `core` schema);
//! - one pool per plugin, authenticated with the role of the plugin (RLS on);
//! - security context per transaction (`core.set_ctx`);
//! - provisioning and "freezing" of the schemas of the plugins after the migrations.

pub mod plugin_schema;

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use sqlx::postgres::{PgArguments, PgConnectOptions, PgPoolOptions, PgRow};
use sqlx::{Column, PgPool, Postgres, Row as _, TypeInfo};
use uuid::Uuid;

use crate::value::{Param, Row, Ty, Val};
use crate::{qi, Ctx, DbError, Result};

pub type PgTx = sqlx::Transaction<'static, Postgres>;

pub struct PgDb {
    pub app: PgPool,
    base: PgConnectOptions,
    secret: Vec<u8>,
    /// prefix of the roles created by this installation (depends on the database)
    pub role_prefix: String,
    plugin_pools: RwLock<HashMap<String, PgPool>>,
}

const MIN_SERVER_VERSION: i32 = 150000;

impl PgDb {
    /// Connects, checks the version of the server, applies the core migrations.
    pub async fn connect(url: &str, max_connections: u32) -> Result<PgDb> {
        let base = PgConnectOptions::from_str(url)?.application_name("mosaikit");
        let app = PgPoolOptions::new()
            .max_connections(max_connections)
            .acquire_timeout(Duration::from_secs(15))
            .connect_with(base.clone())
            .await?;
        let version: i32 =
            sqlx::query_scalar("select current_setting('server_version_num')::int").fetch_one(&app).await?;
        if version < MIN_SERVER_VERSION {
            return Err(DbError::Invalid(format!(
                "PostgreSQL {version} not supported: version 15 or later is required"
            )));
        }
        sqlx::migrate!("./migrations").run(&app).await?;

        let dbname: String = sqlx::query_scalar("select current_database()").fetch_one(&app).await?;
        let role_prefix = role_prefix(&dbname);

        // secret of the context: generated once per database
        let secret: Vec<u8> = rand::random::<[u8; 32]>().to_vec();
        sqlx::query("insert into core.secrets (name, value) values ('ctx', $1) on conflict do nothing")
            .bind(&secret)
            .execute(&app)
            .await?;
        let secret: Vec<u8> =
            sqlx::query_scalar("select value from core.secrets where name = 'ctx'").fetch_one(&app).await?;

        let db = PgDb { app, base, secret, role_prefix, plugin_pools: RwLock::new(HashMap::new()) };
        db.ensure_reporting_role().await?;
        Ok(db)
    }

    /// Read-only role of the KPI views (NOLOGIN: enabled by hand for BI tools).
    pub fn reporting_role(&self) -> String {
        format!("{}_reporting", self.role_prefix)
    }

    async fn ensure_reporting_role(&self) -> Result<()> {
        let role = self.reporting_role();
        let exists: bool = sqlx::query_scalar("select exists (select 1 from pg_roles where rolname = $1)")
            .bind(&role)
            .fetch_one(&self.app)
            .await?;
        if !exists {
            sqlx::query(&format!("create role {} nologin", qi(&role)))
                .persistent(false)
                .execute(&self.app)
                .await?;
        }
        Ok(())
    }

    pub async fn begin_app(&self) -> Result<PgTx> {
        Ok(self.app.begin().await?)
    }

    /// Transaction on the pool of the application with the context set.
    pub async fn begin(&self, ctx: &Ctx) -> Result<PgTx> {
        let mut tx = self.app.begin().await?;
        self.set_ctx(&mut tx, ctx).await?;
        Ok(tx)
    }

    /// Transaction on the pool of the plugin (role of the plugin, RLS on).
    pub async fn begin_plugin(&self, plugin_id: &str, ctx: &Ctx) -> Result<PgTx> {
        let pool = self.plugin_pool(plugin_id).await?;
        let mut tx = pool.begin().await?;
        let ctx = Ctx { plugin: Some(plugin_id.to_string()), ..ctx.clone() };
        self.set_ctx(&mut tx, &ctx).await?;
        Ok(tx)
    }

    async fn set_ctx(&self, tx: &mut PgTx, ctx: &Ctx) -> Result<()> {
        sqlx::query("select core.set_ctx($1, $2, $3, $4, $5)")
            .bind(&self.secret)
            .bind(ctx.user)
            .bind(ctx.tenant)
            .bind(ctx.plugin.as_deref())
            .bind(ctx.link)
            .execute(&mut **tx)
            .await?;
        Ok(())
    }

    async fn plugin_pool(&self, plugin_id: &str) -> Result<PgPool> {
        if let Some(p) = self.plugin_pools.read().expect("lock pool").get(plugin_id) {
            return Ok(p.clone());
        }
        let row = sqlx::query("select role_name, role_password from core.plugins where id = $1")
            .bind(plugin_id)
            .fetch_optional(&self.app)
            .await?
            .ok_or_else(|| DbError::Invalid(format!("plugin not installed: {plugin_id}")))?;
        let role: String = row.get(0);
        let password: String = row.get(1);
        let opts = self.base.clone().username(&role).password(&password).application_name("mosaikit-plugin");
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .min_connections(0)
            .idle_timeout(Duration::from_secs(300))
            .acquire_timeout(Duration::from_secs(15))
            .connect_lazy_with(opts);
        self.plugin_pools.write().expect("lock pool").insert(plugin_id.to_string(), pool.clone());
        Ok(pool)
    }

    /// To call after uninstalling or changing the password of the role.
    pub async fn forget_plugin_pool(&self, plugin_id: &str) {
        let pool = self.plugin_pools.write().expect("lock pool").remove(plugin_id);
        if let Some(p) = pool {
            p.close().await;
        }
    }

    /// Name of the PostgreSQL role of a plugin.
    pub fn plugin_role(&self, plugin_id: &str) -> String {
        plugin_role(&self.role_prefix, plugin_id)
    }

    pub fn plugin_schema(&self, plugin_id: &str, schema: &str) -> plugin_schema::PgPluginSchema {
        plugin_schema::PgPluginSchema {
            plugin_id: plugin_id.to_string(),
            schema: schema.to_string(),
            role: self.plugin_role(plugin_id),
            reporting_role: self.reporting_role(),
            extra_path: Vec::new(),
        }
    }
}

/// Name of the PostgreSQL role of a plugin.
pub fn plugin_role(prefix: &str, plugin_id: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = hex::encode(&Sha256::digest(plugin_id.as_bytes())[..4]);
    let last: String = plugin_id
        .rsplit('.')
        .next()
        .unwrap_or("p")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .take(16)
        .collect();
    let mut name = format!("{prefix}_p_{last}_{hash}");
    name.truncate(63);
    name
}

/// `msk_<database name>` (if the database already starts with `msk_` it stays as it is).
pub fn role_prefix(dbname: &str) -> String {
    let clean: String = dbname
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
        .collect();
    let mut p = if clean.starts_with("msk_") { clean } else { format!("msk_{clean}") };
    p.truncate(28);
    p
}

// ------------------------------------------------------------------ execution

type PgQuery<'q> = sqlx::query::Query<'q, Postgres, PgArguments>;

pub(crate) fn bind_all<'q>(mut q: PgQuery<'q>, params: &'q [Param]) -> PgQuery<'q> {
    for p in params {
        q = match p {
            Param::Null(ty) => match ty {
                Ty::Bool => q.bind(None::<bool>),
                Ty::I16 => q.bind(None::<i16>),
                Ty::I32 => q.bind(None::<i32>),
                Ty::I64 => q.bind(None::<i64>),
                Ty::F64 => q.bind(None::<f64>),
                Ty::Text => q.bind(None::<String>),
                Ty::Bytes => q.bind(None::<Vec<u8>>),
                Ty::Uuid => q.bind(None::<Uuid>),
                Ty::Ts => q.bind(None::<chrono::DateTime<chrono::Utc>>),
                Ty::Date => q.bind(None::<chrono::NaiveDate>),
                Ty::Json => q.bind(None::<sqlx::types::Json<serde_json::Value>>),
                Ty::Uuids => q.bind(None::<Vec<Uuid>>),
                Ty::Texts => q.bind(None::<Vec<String>>),
            },
            Param::Bool(v) => q.bind(*v),
            Param::I16(v) => q.bind(*v),
            Param::I32(v) => q.bind(*v),
            Param::I64(v) => q.bind(*v),
            Param::F64(v) => q.bind(*v),
            Param::Text(v) => q.bind(v.as_str()),
            Param::Bytes(v) => q.bind(v.as_slice()),
            Param::Uuid(v) => q.bind(*v),
            Param::Ts(v) => q.bind(*v),
            Param::Date(v) => q.bind(*v),
            Param::Json(v) => q.bind(sqlx::types::Json(v)),
            Param::Uuids(v) => q.bind(v.as_slice()),
            Param::Texts(v) => q.bind(v.as_slice()),
        };
    }
    q
}

fn decode_col(r: &PgRow, i: usize) -> Result<Val> {
    let name = r.columns()[i].type_info().name().to_string();
    macro_rules! get {
        ($t:ty, $f:expr) => {
            r.try_get::<Option<$t>, _>(i)?.map($f).unwrap_or(Val::Null)
        };
    }
    Ok(match name.as_str() {
        "BOOL" => get!(bool, Val::Bool),
        "INT2" => get!(i16, |v| Val::Int(v as i64)),
        "INT4" => get!(i32, |v| Val::Int(v as i64)),
        "INT8" => get!(i64, Val::Int),
        "OID" => get!(sqlx::postgres::types::Oid, |v| Val::Int(v.0 as i64)),
        "FLOAT4" => get!(f32, |v| Val::Float(v as f64)),
        "FLOAT8" => get!(f64, Val::Float),
        "UUID" => get!(Uuid, Val::Uuid),
        "TIMESTAMPTZ" => get!(chrono::DateTime<chrono::Utc>, Val::Ts),
        "TIMESTAMP" => get!(chrono::NaiveDateTime, |v| Val::Ts(v.and_utc())),
        "DATE" => get!(chrono::NaiveDate, Val::Date),
        "JSON" | "JSONB" => get!(sqlx::types::Json<serde_json::Value>, |v| Val::Json(v.0)),
        "BYTEA" => get!(Vec<u8>, Val::Bytes),
        "UUID[]" => get!(Vec<Uuid>, Val::Uuids),
        "TEXT[]" | "VARCHAR[]" | "NAME[]" => get!(Vec<String>, Val::Texts),
        "VOID" => Val::Null,
        _ => match r.try_get::<Option<String>, _>(i) {
            Ok(v) => v.map(Val::Text).unwrap_or(Val::Null),
            Err(_) => return Err(DbError::Decode(format!("PostgreSQL type not handled: {name}"))),
        },
    })
}

pub(crate) fn decode(rows: Vec<PgRow>) -> Result<Vec<Row>> {
    let Some(first) = rows.first() else { return Ok(Vec::new()) };
    let cols: Arc<Vec<String>> = Arc::new(first.columns().iter().map(|c| c.name().to_string()).collect());
    rows.iter()
        .map(|r| {
            Ok(Row::new(cols.clone(), (0..cols.len()).map(|i| decode_col(r, i)).collect::<Result<_>>()?))
        })
        .collect()
}

/// Runs on an sqlx executor (pool or connection). `fetch`: rows, otherwise rows affected.
pub(crate) async fn run<'e, E>(
    e: E,
    sql: &str,
    params: &[Param],
    fetch: bool,
    raw: bool,
) -> Result<(Vec<Row>, u64)>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    let q = bind_all(sqlx::query(sql), params).persistent(!raw);
    if fetch {
        Ok((decode(q.fetch_all(e).await?)?, 0))
    } else {
        Ok((Vec::new(), q.execute(e).await?.rows_affected()))
    }
}
