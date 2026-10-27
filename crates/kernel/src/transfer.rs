//! Export and import of a tenant (docs/architecture.md, "Lifecycle of the tenants").
//!
//! An export is a zip:
//!
//! ```text
//! manifest.json                 format, version, backend, tenant, plugins and their versions
//! core/<table>.json             the rows of the tenant in the tables of the kernel (JSON arrays)
//! plugins/<plugin id>/<table>.json  the rows of the tenant in the tables of each plugin
//! blobs/...                     contents of its files and sites (<data_dir>/blobs/<tenant>/...)
//! identity/...                  its logos (<data_dir>/blobs/identity/<tenant>/...)
//! ```
//!
//! A backup of the installation holds one export per tenant under `tenants/<slug>/`, without the
//! contents, which are in the `blobs/` folder of the backup once for everybody (`"blobs": "shared"`).
//!
//! The import recreates the tenant with the same ids (contents and links keep working): the tenant must
//! not exist, unless it is replaced. Guests of other tenants come back only if they still exist; an item
//! owned by someone who no longer exists goes to the first Tenant Manager. An export is imported on the
//! same kind of database (PostgreSQL or SQLite) it comes from.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};

use chrono::Utc;
use mosaikit_db::{Param, Tx};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::tenancy::require_admin;
use crate::{events, Error, Kernel, Result, SessionUser};

pub const FORMAT: &str = "mosaikit-tenant-export";
pub const VERSION: u32 = 1;

/// Tables of the kernel with the rows of a tenant, in the order of the import (foreign keys).
/// `(table, condition on $1 = the tenant)`.
const CORE: &[(&str, &str)] = &[
    ("tenants", "id = $1"),
    ("users", "home_tenant_id = $1"),
    ("notification_prefs", "user_id in (select id from core.users where home_tenant_id = $1)"),
    // high contrast and guided tours seen (the themes made for the tenant are in `tenants.settings`)
    ("person_prefs", "user_id in (select id from core.users where home_tenant_id = $1)"),
    ("permission_profiles", "tenant_id = $1"),
    ("memberships", "tenant_id = $1"),
    ("user_identities", "tenant_id = $1"),
    ("tenant_oidc", "tenant_id = $1"),
    ("groups", "tenant_id = $1"),
    ("group_members", "group_id in (select id from core.groups where tenant_id = $1)"),
    ("plugin_grants", "tenant_id = $1"),
    ("tenant_plugins", "tenant_id = $1"),
    ("user_prefs", "tenant_id = $1"),
    ("invitations", "tenant_id = $1"),
    ("resources", "tenant_id = $1"),
    ("grants", "resource_id in (select id from core.resources where tenant_id = $1)"),
    ("public_links", "resource_id in (select id from core.resources where tenant_id = $1)"),
    ("extension_values", "tenant_id = $1"),
    ("access_requests", "tenant_id = $1"),
    ("service_keys", "tenant_id = $1"),
    ("quota_usage", "tenant_id = $1"),
    ("quota_alerts", "tenant_id = $1"),
    ("events", "tenant_id = $1"),
];

/// Columns not carried over (generated again by the database): the ids of the events and the words of
/// the search (`search_vec`, computed from title and searchable text, which do travel).
fn skipped(table: &str, col: &str) -> bool {
    (table == "events" && col == "id") || (table == "resources" && col == "search_vec")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub format: String,
    pub version: u32,
    pub backend: String,
    pub kernel: String,
    pub exported_at: chrono::DateTime<Utc>,
    pub tenant: ManifestTenant,
    /// installed plugins with rows of the tenant: id → version
    pub plugins: HashMap<String, String>,
    /// "included" (in this export) or "shared" (in `blobs/` at the root of the backup)
    pub blobs: String,
    pub counts: HashMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestTenant {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportReport {
    pub tenant_id: Uuid,
    pub slug: String,
    pub name: String,
    pub rows: usize,
    pub files: usize,
    /// guests and other people not found in this installation (their rows were left out)
    pub people_missing: usize,
    pub replaced: bool,
}

fn backend(k: &Kernel) -> &'static str {
    if k.db.is_sqlite() {
        "sqlite"
    } else {
        "postgres"
    }
}

/// Physical name of a table of the kernel.
pub(crate) fn core_table(k: &Kernel, name: &str) -> String {
    if k.db.is_sqlite() {
        format!("core_{name}")
    } else {
        format!("core.{name}")
    }
}

fn lite_sql(sql: &str) -> String {
    let mut s = sql.replace("core.", "core_");
    for i in (1..10).rev() {
        s = s.replace(&format!("${i}"), &format!("?{i}"));
    }
    s
}

fn qi(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// Columns of a table: (name, type). On PostgreSQL `schema.table`.
pub(crate) async fn columns(k: &Kernel, tx: &mut Tx, physical: &str) -> Result<Vec<(String, String)>> {
    if k.db.is_sqlite() {
        let rows = mosaikit_db::query("select 1")
            .sqlite("select name, lower(type) from pragma_table_info(?1)")
            .bind(physical)
            .fetch_all(&mut *tx)
            .await?;
        return Ok(rows.iter().map(|r| (r.get::<String, _>(0), r.get::<String, _>(1))).collect());
    }
    let (schema, table) = physical.split_once('.').unwrap_or(("public", physical));
    let rows = mosaikit_db::query(
        "select column_name::text, case when data_type = 'USER-DEFINED' then 'user-defined' else data_type::text end
         from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position",
    )
    .bind(schema.trim_matches('"'))
    .bind(table.trim_matches('"'))
    .fetch_all(&mut *tx)
    .await?;
    Ok(rows.iter().map(|r| (r.get::<String, _>(0), r.get::<String, _>(1))).collect())
}

fn pg_physical(physical: &str) -> String {
    match physical.split_once('.') {
        Some((s, t)) => format!("{}.{}", qi(s.trim_matches('"')), qi(t.trim_matches('"'))),
        None => qi(physical),
    }
}

/// Rows of a table that match a condition on `$1` (the tenant), as JSON objects.
async fn dump(k: &Kernel, tx: &mut Tx, physical: &str, cond: &str, tenant: Uuid) -> Result<Vec<Value>> {
    let cols = columns(k, tx, physical).await?;
    if cols.is_empty() {
        return Ok(Vec::new());
    }
    if k.db.is_sqlite() {
        let rows = mosaikit_db::query("select 1")
            .sqlite(format!("select * from {} where {}", qi(physical), lite_sql(cond)))
            .bind(tenant)
            .fetch_all(&mut *tx)
            .await?;
        return Ok(rows.iter().map(|r| r.to_json()).collect());
    }
    // types of extensions (e.g. PostGIS geometry) travel as their text form, which their input accepts
    let pairs: Vec<String> = cols
        .iter()
        .map(|(c, t)| {
            let v = if t == "user-defined" { format!("t.{}::text", qi(c)) } else { format!("t.{}", qi(c)) };
            format!("'{}', {v}", c.replace('\'', "''"))
        })
        .collect();
    let obj = pairs.chunks(40).map(|ch| format!("jsonb_build_object({})", ch.join(", "))).collect::<Vec<_>>();
    let sql = format!(
        "select coalesce(jsonb_agg({}), '[]'::jsonb) from {} t where {}",
        obj.join(" || "),
        pg_physical(physical),
        cond.replace("$1", "$1::uuid")
    );
    let v: Value = mosaikit_db::query_scalar(sql).bind(tenant).fetch_one(&mut *tx).await?;
    Ok(v.as_array().cloned().unwrap_or_default())
}

/// Inserts rows (JSON objects) into a table: only the columns the table still has.
pub(crate) async fn restore(
    k: &Kernel,
    tx: &mut Tx,
    physical: &str,
    table: &str,
    rows: &[Value],
) -> Result<usize> {
    if rows.is_empty() {
        return Ok(0);
    }
    let cols = columns(k, tx, physical).await?;
    let present: HashSet<&str> =
        rows.iter().filter_map(Value::as_object).flat_map(|o| o.keys().map(String::as_str)).collect();
    let cols: Vec<(String, String)> =
        cols.into_iter().filter(|(c, _)| present.contains(c.as_str()) && !skipped(table, c)).collect();
    if cols.is_empty() {
        return Ok(0);
    }
    let names = cols.iter().map(|(c, _)| qi(c)).collect::<Vec<_>>().join(", ");
    if !k.db.is_sqlite() {
        for chunk in rows.chunks(500) {
            let sql = format!(
                "insert into {p} ({names}) select {names} from jsonb_populate_recordset(null::{p}, $1)",
                p = pg_physical(physical)
            );
            mosaikit_db::query(sql).bind(Value::Array(chunk.to_vec())).execute(&mut *tx).await?;
        }
        return Ok(rows.len());
    }
    let marks = (1..=cols.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
    let sql = format!("insert into {} ({names}) values ({marks})", qi(physical));
    for row in rows {
        let mut q = mosaikit_db::query("select 1").sqlite(sql.clone());
        for (c, t) in &cols {
            q = q.bind(lite_param(row.get(c).unwrap_or(&Value::Null), t));
        }
        q.execute(&mut *tx).await?;
    }
    Ok(rows.len())
}

/// A JSON value as the parameter for a SQLite column of the declared type.
fn lite_param(v: &Value, ty: &str) -> Param {
    use mosaikit_db::Ty;
    if v.is_null() {
        return Param::Null(Ty::Text);
    }
    let s = v.as_str();
    if ty.contains("timestamp") {
        if let Some(t) = s.and_then(mosaikit_db::value::parse_ts) {
            return Param::Ts(t);
        }
    }
    if ty.contains("bytea") || ty.contains("blob") {
        if let Some(b) = s.and_then(|s| hex::decode(s.trim_start_matches("\\x")).ok()) {
            return Param::Bytes(b);
        }
    }
    if ty.starts_with("bool") {
        return Param::Bool(v.as_bool().unwrap_or_else(|| v.as_i64().unwrap_or(0) != 0));
    }
    match v {
        Value::Bool(b) => Param::Bool(*b),
        Value::Number(n) if n.is_i64() => Param::I64(n.as_i64().unwrap_or_default()),
        Value::Number(n) => Param::F64(n.as_f64().unwrap_or_default()),
        Value::String(s) => Param::Text(s.clone()),
        other => Param::Text(other.to_string()),
    }
}

/// Tables of an installed plugin: (logical name, physical name).
pub(crate) async fn plugin_tables(k: &Kernel, tx: &mut Tx, schema: &str) -> Result<Vec<(String, String)>> {
    if k.db.is_sqlite() {
        let prefix = format!("{schema}__");
        let rows = mosaikit_db::query("select 1")
            .sqlite("select name from sqlite_master where type = 'table' and substr(name, 1, length(?1)) = ?1 order by name")
            .bind(&prefix)
            .fetch_all(&mut *tx)
            .await?;
        return Ok(rows
            .iter()
            .map(|r| {
                let n: String = r.get(0);
                (n.trim_start_matches(&prefix).to_string(), n)
            })
            .collect());
    }
    let rows = mosaikit_db::query(
        "select table_name::text from information_schema.tables
         where table_schema = $1 and table_type = 'BASE TABLE' order by table_name",
    )
    .bind(schema)
    .fetch_all(&mut *tx)
    .await?;
    Ok(rows
        .iter()
        .map(|r| {
            let n: String = r.get(0);
            (n.clone(), format!("{schema}.{n}"))
        })
        .collect())
}

async fn installed_plugins(tx: &mut Tx) -> Result<Vec<(String, String, String)>> {
    let rows = mosaikit_db::query("select id, version, schema_name from core.plugins order by id")
        .fetch_all(&mut *tx)
        .await?;
    Ok(rows.iter().map(|r| (r.get(0), r.get(1), r.get(2))).collect())
}

fn add_json<W: Write + Seek>(zip: &mut ZipWriter<W>, name: &str, v: &Value) -> Result<()> {
    zip.start_file(name, SimpleFileOptions::default()).map_err(zip_err)?;
    zip.write_all(&serde_json::to_vec(v)?)?;
    Ok(())
}

pub(crate) fn zip_err(e: zip::result::ZipError) -> Error {
    Error::internal(format!("zip: {e}"))
}

/// Adds a folder to the zip under `prefix` (files only, relative paths with `/`).
pub(crate) fn add_dir<W: Write + Seek>(zip: &mut ZipWriter<W>, dir: &Path, prefix: &str) -> Result<usize> {
    let mut n = 0;
    if !dir.is_dir() {
        return Ok(0);
    }
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d)?.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            let rel = p.strip_prefix(dir).map_err(|e| Error::internal(e.to_string()))?;
            let rel = rel.to_string_lossy().replace('\\', "/");
            if rel.contains("/.tmp-") || rel.starts_with(".tmp-") {
                continue;
            }
            zip.start_file(format!("{prefix}{rel}"), SimpleFileOptions::default().large_file(true))
                .map_err(zip_err)?;
            let mut f = File::open(&p)?;
            std::io::copy(&mut f, zip)?;
            n += 1;
        }
    }
    Ok(n)
}

/// Writes the export of a tenant into `zip` under `prefix` (`""` or `tenants/<slug>/`); with
/// `include_blobs` its contents too, otherwise they are expected in `blobs/` at the root (backups).
pub(crate) async fn export_into<W: Write + Seek>(
    k: &Kernel,
    tenant: Uuid,
    zip: &mut ZipWriter<W>,
    prefix: &str,
    include_blobs: bool,
) -> Result<Manifest> {
    let mut tx = k.db.begin_app().await?;
    let row = mosaikit_db::query("select slug, name, is_system from core.tenants where id = $1")
        .bind(tenant)
        .fetch_optional(&mut tx)
        .await?
        .ok_or_else(|| Error::not_found("tenant does not exist"))?;
    if row.get::<bool, _>(2) {
        return Err(Error::bad("the system tenant is not exported"));
    }
    let mut counts = HashMap::new();
    for (table, cond) in CORE {
        let rows = dump(k, &mut tx, &core_table(k, table), cond, tenant).await?;
        counts.insert(format!("core/{table}"), rows.len());
        add_json(zip, &format!("{prefix}core/{table}.json"), &Value::Array(rows))?;
    }
    let mut plugins = HashMap::new();
    for (id, version, schema) in installed_plugins(&mut tx).await? {
        let mut any = false;
        for (logical, physical) in plugin_tables(k, &mut tx, &schema).await? {
            let cols = columns(k, &mut tx, &physical).await?;
            if !cols.iter().any(|(c, _)| c == "tenant_id") {
                continue;
            }
            let rows = dump(k, &mut tx, &physical, "tenant_id = $1", tenant).await?;
            any |= !rows.is_empty();
            counts.insert(format!("plugins/{id}/{logical}"), rows.len());
            add_json(zip, &format!("{prefix}plugins/{id}/{logical}.json"), &Value::Array(rows))?;
        }
        if any {
            plugins.insert(id, version);
        }
    }
    tx.rollback().await?;
    if include_blobs {
        let files = add_dir(zip, &k.blobs.root().join(tenant.to_string()), &format!("{prefix}blobs/"))?;
        let logos = add_dir(
            zip,
            &k.blobs.root().join("identity").join(tenant.to_string()),
            &format!("{prefix}identity/"),
        )?;
        counts.insert("files".into(), files + logos);
    }
    let manifest = Manifest {
        format: FORMAT.into(),
        version: VERSION,
        backend: backend(k).into(),
        kernel: crate::KERNEL_VERSION.into(),
        exported_at: Utc::now(),
        tenant: ManifestTenant { id: tenant, slug: row.get(0), name: row.get(1) },
        plugins,
        blobs: if include_blobs { "included".into() } else { "shared".into() },
        counts,
    };
    add_json(zip, &format!("{prefix}manifest.json"), &serde_json::to_value(&manifest)?)?;
    Ok(manifest)
}

/// Folder of the exports, in the data folder.
pub fn exports_dir(k: &Kernel) -> PathBuf {
    k.cfg.data_dir.join("exports")
}

/// Exports a tenant to `<data_dir>/exports/<slug>-<time>.zip` (Administrator).
pub async fn export_tenant(k: &Kernel, admin: &SessionUser, tenant: Uuid) -> Result<(PathBuf, Manifest)> {
    require_admin(admin)?;
    let dir = exports_dir(k);
    std::fs::create_dir_all(&dir)?;
    let slug: String = mosaikit_db::query_scalar("select slug from core.tenants where id = $1")
        .bind(tenant)
        .fetch_optional(&k.db)
        .await?
        .ok_or_else(|| Error::not_found("tenant does not exist"))?;
    let path = dir.join(format!("{slug}-{}.zip", Utc::now().format("%Y%m%d-%H%M%S")));
    let tmp = path.with_extension("part");
    let res = async {
        let mut zip = ZipWriter::new(File::create(&tmp)?);
        let m = export_into(k, tenant, &mut zip, "", true).await?;
        zip.finish().map_err(zip_err)?;
        Ok::<_, Error>(m)
    }
    .await;
    match res {
        Ok(m) => {
            std::fs::rename(&tmp, &path)?;
            events::record(
                k,
                Some(tenant),
                Some(admin.user_id),
                None,
                None,
                "tenant.export",
                json!({ "slug": slug }),
            )
            .await;
            prune_exports(k);
            Ok((path, m))
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// Keeps the exports of the last 7 days.
fn prune_exports(k: &Kernel) {
    let Ok(rd) = std::fs::read_dir(exports_dir(k)) else { return };
    for e in rd.flatten() {
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .map(|m| m.elapsed().unwrap_or_default() > std::time::Duration::from_secs(7 * 86400))
            .unwrap_or(false);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// What is left of the limits of an archive while it is read (`[archives]` of the configuration).
/// The sizes a zip declares can lie: the bytes are counted as they are unpacked.
pub struct Budget {
    bytes: u64,
    entries: u64,
    json: u64,
}

impl Budget {
    pub fn new(l: &crate::config::ArchiveLimits) -> Budget {
        Budget {
            bytes: l.max_unpacked_mb.saturating_mul(1 << 20),
            entries: l.max_entries,
            json: l.max_json_mb.saturating_mul(1 << 20),
        }
    }

    /// A small budget for the manifests (a few KB each).
    fn manifest() -> Budget {
        Budget { bytes: 1 << 20, entries: 1, json: 1 << 20 }
    }

    fn too_big() -> Error {
        Error::bad("the archive unpacks to more than the limits of the installation ([archives])")
            .with_code("archive_too_big")
    }

    /// Checks what the archive declares under `prefix` before reading anything.
    pub fn check<R: Read + Seek>(&self, zip: &mut ZipArchive<R>, prefix: &str) -> Result<()> {
        let (mut n, mut bytes) = (0u64, 0u64);
        for i in 0..zip.len() {
            let f = zip.by_index_raw(i).map_err(|e| Error::bad(format!("invalid archive: {e}")))?;
            if f.name().map_err(|e| Error::bad(format!("invalid archive: {e}")))?.starts_with(prefix) {
                n += 1;
                bytes = bytes.saturating_add(f.size());
            }
        }
        if n > self.entries || bytes > self.bytes {
            return Err(Budget::too_big());
        }
        Ok(())
    }

    /// Copies an entry, counting its real bytes against the budget (at most `cap` for this entry).
    fn copy(&mut self, from: &mut impl Read, to: &mut impl std::io::Write, cap: u64) -> Result<u64> {
        if self.entries == 0 {
            return Err(Budget::too_big());
        }
        self.entries -= 1;
        let limit = cap.min(self.bytes);
        let n = std::io::copy(&mut from.take(limit.saturating_add(1)), to)?;
        if n > limit {
            return Err(Budget::too_big());
        }
        self.bytes -= n;
        Ok(n)
    }
}

pub(crate) fn read_json<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    name: &str,
    budget: &mut Budget,
) -> Result<Option<Value>> {
    let mut f = match zip.by_name(name) {
        Ok(f) => f,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(Error::bad(format!("invalid archive: {e}"))),
    };
    let mut buf = Vec::new();
    let cap = budget.json;
    budget.copy(&mut f, &mut buf, cap)?;
    Ok(Some(serde_json::from_slice(&buf).map_err(|e| Error::bad(format!("invalid archive: {e}")))?))
}

/// The manifest of an export inside an archive.
pub fn read_manifest<R: Read + Seek>(zip: &mut ZipArchive<R>, prefix: &str) -> Result<Manifest> {
    let v = read_json(zip, &format!("{prefix}manifest.json"), &mut Budget::manifest())?.ok_or_else(|| {
        Error::bad("not an export of a tenant: manifest.json missing").with_code("export_invalid")
    })?;
    let m: Manifest = serde_json::from_value(v)
        .map_err(|e| Error::bad(format!("invalid manifest: {e}")).with_code("export_invalid"))?;
    if m.format != FORMAT || m.version > VERSION {
        return Err(Error::bad("unknown format or newer version of the export").with_code("export_invalid"));
    }
    Ok(m)
}

/// The names of the entries of an archive (an entry whose name cannot be decoded refuses the archive).
pub(crate) fn entry_names<R: Read + Seek>(zip: &ZipArchive<R>) -> Result<Vec<String>> {
    zip.file_names()
        .map(|n| n.map(|n| n.into_owned()).map_err(|e| Error::bad(format!("invalid archive: {e}"))))
        .collect()
}

/// Exports of tenants inside a backup: `tenants/<slug>/manifest.json`.
pub fn tenants_in<R: Read + Seek>(zip: &mut ZipArchive<R>) -> Result<Vec<Manifest>> {
    let names: Vec<String> = entry_names(zip)?
        .into_iter()
        .filter(|n| n.starts_with("tenants/") && n.ends_with("/manifest.json"))
        .collect();
    let mut out = Vec::new();
    for n in names {
        let prefix = n.trim_end_matches("manifest.json").to_string();
        out.push(read_manifest(zip, &prefix)?);
    }
    out.sort_by(|a, b| a.tenant.name.cmp(&b.tenant.name));
    Ok(out)
}

/// Extracts the files of a folder of the archive into `dest` (safe paths only), within the budget.
pub(crate) fn extract<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    prefix: &str,
    dest: &Path,
    budget: &mut Budget,
) -> Result<usize> {
    let names: Vec<String> =
        entry_names(zip)?.into_iter().filter(|n| n.starts_with(prefix) && !n.ends_with('/')).collect();
    let mut n = 0;
    for name in names {
        let rel = &name[prefix.len()..];
        if !mosaikit_mskp::is_safe_path(rel) {
            return Err(Error::bad(format!("unsafe path in the archive: {name}")));
        }
        let out = dest.join(rel);
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p)?;
        }
        let mut f = zip.by_name(&name).map_err(|e| Error::bad(format!("archive: {e}")))?;
        let mut w = File::create(&out)?;
        if let Err(e) = budget.copy(&mut f, &mut w, u64::MAX) {
            drop(w);
            let _ = std::fs::remove_file(&out);
            return Err(e);
        }
        n += 1;
    }
    Ok(n)
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ImportOptions {
    /// a tenant with the same id or address is deleted first
    #[serde(default)]
    pub replace: bool,
}

/// Imports the export under `prefix` of an archive on disk (an export or a backup).
pub async fn import_tenant(
    k: &Kernel,
    admin: &SessionUser,
    archive: &Path,
    prefix: &str,
    opts: &ImportOptions,
) -> Result<ImportReport> {
    require_admin(admin)?;
    let mut zip = ZipArchive::new(File::open(archive)?)
        .map_err(|e| Error::bad(format!("invalid archive: {e}")).with_code("export_invalid"))?;
    let m = read_manifest(&mut zip, prefix)?;
    let mut budget = Budget::new(&k.cfg.archives);
    budget.check(&mut zip, prefix)?;
    if m.backend != backend(k) {
        return Err(Error::bad(format!(
            "the export comes from {} and this installation uses {}",
            m.backend,
            backend(k)
        ))
        .with_code("export_backend"));
    }
    let t = m.tenant.id;
    // the tenant must not exist (by id or address), unless it is replaced
    let existing: Vec<Uuid> =
        mosaikit_db::query_scalar("select id from core.tenants where id = $1 or slug = $2")
            .bind(t)
            .bind(&m.tenant.slug)
            .fetch_all(&k.db)
            .await?;
    let replaced = !existing.is_empty();
    if replaced && !opts.replace {
        return Err(Error::conflict(format!("a tenant '{}' already exists", m.tenant.slug))
            .with_code("tenant_exists"));
    }
    let installed: HashMap<String, String> = mosaikit_db::query("select id, schema_name from core.plugins")
        .fetch_all(&k.db)
        .await?
        .iter()
        .map(|r| (r.get(0), r.get(1)))
        .collect();
    let missing: Vec<&String> = m.plugins.keys().filter(|p| !installed.contains_key(*p)).collect();
    if !missing.is_empty() {
        let list = missing.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ");
        return Err(Error::bad(format!("plugins not installed: {list}")).with_code("export_plugins_missing"));
    }
    for id in &existing {
        if *id != t || opts.replace {
            crate::tenancy::lifecycle::purge_tenant(k, *id).await?;
        }
    }
    let mut core: HashMap<&str, Vec<Value>> = HashMap::new();
    for (table, _) in CORE {
        let v = read_json(&mut zip, &format!("{prefix}core/{table}.json"), &mut budget)?.unwrap_or(json!([]));
        core.insert(table, v.as_array().cloned().unwrap_or_default());
    }
    // people of this installation, so that the rows of missing people are left out
    let mut known: HashSet<String> = mosaikit_db::query_scalar::<Uuid>("select id from core.users")
        .fetch_all(&k.db)
        .await?
        .iter()
        .map(Uuid::to_string)
        .collect();
    known.extend(core["users"].iter().filter_map(|u| u.get("id").and_then(Value::as_str).map(str::to_owned)));
    let first_manager = core["memberships"]
        .iter()
        .filter(|m| m.get("role").and_then(Value::as_str) == Some("tenant_manager"))
        .filter_map(|m| m.get("user_id").and_then(Value::as_str))
        .find(|u| known.contains(*u))
        .map(str::to_owned);
    check_scope(t, &core)?;
    let mut people_missing: HashSet<String> = HashSet::new();
    let mut tx = k.db.begin_app().await?;
    if k.db.is_sqlite() {
        mosaikit_db::query("select 1").sqlite("pragma defer_foreign_keys = on").execute(&mut tx).await?;
    }
    let mut rows_n = 0;
    for (table, _) in CORE {
        let mut rows = core.remove(table).unwrap_or_default();
        rows.retain_mut(|r| keep_row(table, r, &known, first_manager.as_deref(), &mut people_missing));
        if *table == "resources" {
            rows.sort_by_key(|r| r.get("ancestors").map(depth).unwrap_or(0));
        }
        rows_n += restore(k, &mut tx, &core_table(k, table), table, &rows).await?;
    }
    for id in m.plugins.keys() {
        let schema = &installed[id];
        let tables = plugin_tables(k, &mut tx, schema).await?;
        let mut pending: Vec<(String, Vec<Value>)> = Vec::new();
        for (logical, physical) in tables {
            let v = read_json(&mut zip, &format!("{prefix}plugins/{id}/{logical}.json"), &mut budget)?
                .unwrap_or(json!([]));
            let rows = v.as_array().cloned().unwrap_or_default();
            if rows.iter().any(|r| r.get("tenant_id").is_some_and(|v| !same_id(v, t))) {
                return Err(foreign_rows(&format!("{id}/{logical}")));
            }
            if !rows.is_empty() {
                pending.push((physical, rows));
            }
        }
        rows_n += restore_plugin(k, &mut tx, pending).await?;
    }
    tx.commit().await?;
    // contents: in the export, or in the blobs/ folder of the backup
    let (files_prefix, logos_prefix) = if m.blobs == "included" {
        (format!("{prefix}blobs/"), format!("{prefix}identity/"))
    } else {
        (format!("blobs/{t}/"), format!("blobs/identity/{t}/"))
    };
    let mut files = extract(&mut zip, &files_prefix, &k.blobs.root().join(t.to_string()), &mut budget)?;
    files +=
        extract(&mut zip, &logos_prefix, &k.blobs.root().join("identity").join(t.to_string()), &mut budget)?;
    events::record(
        k,
        Some(t),
        Some(admin.user_id),
        None,
        None,
        "tenant.import",
        json!({ "slug": m.tenant.slug, "replaced": replaced, "exported_at": m.exported_at }),
    )
    .await;
    Ok(ImportReport {
        tenant_id: t,
        slug: m.tenant.slug,
        name: m.tenant.name,
        rows: rows_n,
        files,
        people_missing: people_missing.len(),
        replaced,
    })
}

fn same_id(v: &Value, id: Uuid) -> bool {
    v.as_str().and_then(|s| s.parse::<Uuid>().ok()) == Some(id)
}

/// A boolean of a row: `true`, or a non-zero number (SQLite), or a string such as "t".
fn truthy(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64() != Some(0.0),
        Some(Value::String(s)) => matches!(s.as_str(), "t" | "true" | "1"),
        _ => false,
    }
}

fn foreign_rows(table: &str) -> Error {
    Error::bad(format!("the export holds rows that do not belong to its tenant ({table})"))
        .with_code("export_invalid")
}

/// An export is a file from outside: its rows may only describe its own tenant. Without this check a
/// crafted file could add Administrators, members to other tenants, or grants on their items.
fn check_scope(t: Uuid, core: &HashMap<&str, Vec<Value>>) -> Result<()> {
    let ids = |table: &str| -> HashSet<String> {
        core.get(table)
            .into_iter()
            .flatten()
            .filter_map(|r| r.get("id").and_then(Value::as_str).map(str::to_owned))
            .collect()
    };
    let (users, groups, resources) = (ids("users"), ids("groups"), ids("resources"));
    let within =
        |v: Option<&Value>, set: &HashSet<String>| v.and_then(Value::as_str).is_some_and(|s| set.contains(s));
    for (table, rows) in core {
        for r in rows {
            let ok = match *table {
                "tenants" => r.get("id").is_some_and(|v| same_id(v, t)) && !truthy(r.get("is_system")),
                "users" => {
                    r.get("home_tenant_id").is_some_and(|v| same_id(v, t))
                        && !truthy(r.get("is_system_admin"))
                }
                "notification_prefs" | "person_prefs" => within(r.get("user_id"), &users),
                "group_members" => within(r.get("group_id"), &groups),
                "grants" | "public_links" => within(r.get("resource_id"), &resources),
                _ => r.get("tenant_id").is_none_or(|v| same_id(v, t)),
            };
            if !ok {
                return Err(foreign_rows(table));
            }
        }
    }
    Ok(())
}

fn depth(v: &Value) -> usize {
    match v {
        Value::Array(a) => a.len(),
        Value::String(s) => serde_json::from_str::<Vec<Value>>(s).map(|a| a.len()).unwrap_or(0),
        _ => 0,
    }
}

/// Rules for the rows that name people: a missing person drops the row (memberships, requests…), is
/// forgotten where the column allows it (`…_by`, the author of an event), and an item of a missing owner
/// goes to the first Tenant Manager.
fn keep_row(
    table: &str,
    row: &mut Value,
    known: &HashSet<String>,
    manager: Option<&str>,
    missing: &mut HashSet<String>,
) -> bool {
    let Some(o) = row.as_object_mut() else { return false };
    let unknown = |v: &Value| v.as_str().is_some_and(|s| !known.contains(s));
    for col in ["user_id", "requester_id"] {
        if table != "users" && o.get(col).is_some_and(unknown) {
            if table == "events" {
                o.insert(col.into(), Value::Null);
            } else {
                if let Some(s) = o.get(col).and_then(Value::as_str) {
                    missing.insert(s.to_string());
                }
                return false;
            }
        }
    }
    let by: Vec<String> = o.keys().filter(|c| c.ends_with("_by")).cloned().collect();
    for col in by {
        if o.get(&col).is_some_and(unknown) {
            o.insert(col, Value::Null);
        }
    }
    if o.get("owner_id").is_some_and(unknown) {
        match manager {
            Some(m) => {
                o.insert("owner_id".into(), Value::String(m.to_string()));
            }
            None => return false,
        }
    }
    true
}

/// Rows of the tables of a plugin, which may refer to each other: a table that fails because of another
/// one not yet inserted is tried again after the others (on SQLite the foreign keys wait for the commit).
pub(crate) async fn restore_plugin(
    k: &Kernel,
    tx: &mut Tx,
    mut pending: Vec<(String, Vec<Value>)>,
) -> Result<usize> {
    let mut n = 0;
    while !pending.is_empty() {
        let before = pending.len();
        let mut later = Vec::new();
        let mut last_err = None;
        for (physical, rows) in pending {
            tx.savepoint().await?;
            match restore(k, tx, &physical, "", &rows).await {
                Ok(c) => {
                    tx.release_savepoint().await?;
                    n += c;
                }
                Err(e) => {
                    tx.rollback_savepoint().await?;
                    last_err = Some(e);
                    later.push((physical, rows));
                }
            }
        }
        if later.len() == before {
            // no table went in this round: the error is real
            return Err(last_err.unwrap_or_else(|| Error::internal("import of the data of a plugin")));
        }
        pending = later;
    }
    Ok(n)
}
