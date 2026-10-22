//! Backups of the installation (System › Backup; docs/architecture.md, "Backup and restore").
//!
//! A backup is a zip in `<data_dir>/backups`:
//!
//! ```text
//! manifest.json        format, backend, kernel version, tenants, whether the database dump is inside
//! README.txt           how to restore it
//! database/            the whole database: `mosaikit.pgdump` (pg_dump, custom format) or `mosaikit.db`
//!                      (copy of the SQLite file, VACUUM INTO)
//! blobs/               the contents of every tenant and the logos
//! plugins/             the installed packages of the plugins
//! tenants/<slug>/      the export of each tenant without contents (to restore one tenant alone)
//! ```
//!
//! The key that encrypts the secrets (`secret.key` or `secret_key`) is not in the backup: keep it apart.
//! Restoring everything is an offline step (README.txt); restoring one tenant is done from System ›
//! Backup. Without a usable `pg_dump` (missing, or older than the server) the backup has no database dump
//! but still has every tenant; the reason is in its note.

use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::Ordering;

use chrono::{DateTime, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::notify::{self, NoteKind};
use crate::tenancy::{levels, require_admin};
use crate::transfer::{self, zip_err, ImportOptions, ImportReport, Manifest};
use crate::{events, Error, Kernel, Result, SessionUser};

pub const FORMAT: &str = "mosaikit-backup";

/// Schedule and retention (System settings, `backup`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackupConfig {
    #[serde(default = "yes")]
    pub enabled: bool,
    /// hour of the day (UTC) of the scheduled backup
    #[serde(default = "d_hour")]
    pub hour: u8,
    /// backups kept (the older ones are deleted)
    #[serde(default = "d_keep")]
    pub keep: u16,
}

fn yes() -> bool {
    true
}
fn d_hour() -> u8 {
    2
}
fn d_keep() -> u16 {
    7
}

impl Default for BackupConfig {
    fn default() -> BackupConfig {
        serde_json::from_str("{}").expect("backup")
    }
}

pub async fn config(k: &Kernel) -> Result<BackupConfig> {
    let s = levels::system_settings(k).await?;
    Ok(s.get("backup").cloned().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default())
}

pub async fn set_config(k: &Kernel, admin: &SessionUser, c: &BackupConfig) -> Result<BackupConfig> {
    require_admin(admin)?;
    let mut c = c.clone();
    c.hour = c.hour.min(23);
    c.keep = c.keep.clamp(1, 365);
    let mut s = levels::system_settings(k).await?;
    s["backup"] = serde_json::to_value(&c)?;
    levels::write_system(k, &s).await?;
    events::record(k, None, Some(admin.user_id), None, None, "backup.settings", serde_json::to_value(&c)?)
        .await;
    Ok(c)
}

pub fn dir(k: &Kernel) -> PathBuf {
    k.cfg.data_dir.join("backups")
}

#[derive(Debug, Clone, Serialize)]
pub struct Backup {
    pub id: Uuid,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub status: String,
    pub manual: bool,
    pub file: String,
    pub size_bytes: i64,
    /// the dump of the whole database is inside
    pub whole: bool,
    pub tenants: i32,
    pub error: String,
    pub by: Option<String>,
}

const LIST_SQL: &str =
    "select b.id, b.started_at, b.finished_at, b.status, b.manual, b.file, b.size_bytes, b.whole,
        b.tenants, b.error, coalesce(nullif(u.display_name, ''), u.username)
    from core.backups b left join core.users u on u.id = b.created_by";

fn backup(r: &mosaikit_db::Row) -> Backup {
    Backup {
        id: r.get(0),
        started_at: r.get(1),
        finished_at: r.get(2),
        status: r.get(3),
        manual: r.get(4),
        file: r.get(5),
        size_bytes: r.get(6),
        whole: r.get(7),
        tenants: r.get(8),
        error: r.get(9),
        by: r.get(10),
    }
}

pub async fn list(k: &Kernel, admin: &SessionUser) -> Result<Vec<Backup>> {
    require_admin(admin)?;
    let rows = mosaikit_db::query(format!("{LIST_SQL} order by b.started_at desc limit 200"))
        .fetch_all(&k.db)
        .await?;
    Ok(rows.iter().map(backup).collect())
}

async fn get(k: &Kernel, id: Uuid) -> Result<Backup> {
    let r = mosaikit_db::query(format!("{LIST_SQL} where b.id = $1"))
        .bind(id)
        .fetch_optional(&k.db)
        .await?
        .ok_or_else(|| Error::not_found("backup does not exist"))?;
    Ok(backup(&r))
}

/// The file of a completed backup.
pub async fn file(k: &Kernel, admin: &SessionUser, id: Uuid) -> Result<PathBuf> {
    require_admin(admin)?;
    let b = get(k, id).await?;
    let p = dir(k).join(&b.file);
    if b.status != "ok" || b.file.is_empty() || !p.is_file() {
        return Err(Error::not_found("the file of the backup is not available"));
    }
    Ok(p)
}

/// The tenants inside a backup.
pub async fn tenants(k: &Kernel, admin: &SessionUser, id: Uuid) -> Result<Vec<Manifest>> {
    let p = file(k, admin, id).await?;
    let mut zip =
        zip::ZipArchive::new(File::open(p)?).map_err(|e| Error::bad(format!("invalid backup: {e}")))?;
    transfer::tenants_in(&mut zip)
}

/// Restores one tenant from a backup.
pub async fn restore_tenant(
    k: &Kernel,
    admin: &SessionUser,
    id: Uuid,
    slug: &str,
    opts: &ImportOptions,
) -> Result<ImportReport> {
    let p = file(k, admin, id).await?;
    let mut zip =
        zip::ZipArchive::new(File::open(&p)?).map_err(|e| Error::bad(format!("invalid backup: {e}")))?;
    let prefix = format!("tenants/{slug}/");
    transfer::read_manifest(&mut zip, &prefix)
        .map_err(|_| Error::not_found(format!("the tenant '{slug}' is not in this backup")))?;
    drop(zip);
    let r = transfer::import_tenant(k, admin, &p, &prefix, opts).await?;
    events::record(
        k,
        Some(r.tenant_id),
        Some(admin.user_id),
        None,
        None,
        "backup.restore_tenant",
        json!({ "slug": slug, "backup": id }),
    )
    .await;
    Ok(r)
}

/// `pg_dump`: configured `database.pg_bin`, next to the executable (`pgsql/bin`), MOSAIKIT_PG_BIN,
/// PGBIN or the PATH.
fn pg_dump(k: &Kernel) -> Option<PathBuf> {
    let exe = if cfg!(windows) { "pg_dump.exe" } else { "pg_dump" };
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(b) = &k.cfg.database.pg_bin {
        dirs.push(b.clone());
    }
    if let Ok(me) = std::env::current_exe() {
        if let Some(d) = me.parent() {
            dirs.push(d.join("pgsql").join("bin"));
        }
    }
    for v in ["MOSAIKIT_PG_BIN", "PGBIN"] {
        if let Some(p) = std::env::var_os(v) {
            dirs.push(PathBuf::from(p));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs.into_iter().map(|d| d.join(exe)).find(|p| p.is_file())
}

/// Dump of the whole database into `tmp`; `false` if it cannot be made here (no pg_dump).
async fn dump_database(k: &Kernel, tmp: &Path) -> Result<Option<&'static str>> {
    if k.db.is_sqlite() {
        let target = tmp.to_string_lossy().to_string();
        mosaikit_db::query("select 1").sqlite("vacuum into ?1").bind(target).execute(&k.db).await?;
        return Ok(Some("database/mosaikit.db"));
    }
    let Some(bin) = pg_dump(k) else { return Ok(None) };
    let Some(url) = k.database_url().await else { return Ok(None) };
    let tmp = tmp.to_path_buf();
    let out = tokio::task::spawn_blocking(move || {
        Command::new(bin)
            .args(["--format=custom", "--no-owner", "--file"])
            .arg(&tmp)
            .arg("--dbname")
            .arg(url)
            .output()
    })
    .await
    .map_err(|e| Error::internal(e.to_string()))??;
    if !out.status.success() {
        return Err(Error::internal(format!("pg_dump: {}", String::from_utf8_lossy(&out.stderr).trim())));
    }
    Ok(Some("database/mosaikit.pgdump"))
}

const README: &str = "Backup of a Mosaikit installation.\n\n\
Restore everything (offline):\n\
1. stop the server;\n\
2. PostgreSQL: pg_restore --clean --if-exists --no-owner --dbname <url> database/mosaikit.pgdump\n\
   SQLite: replace <data_dir>/mosaikit.db with database/mosaikit.db (remove mosaikit.db-wal and -shm);\n\
3. replace <data_dir>/blobs with blobs/ and <data_dir>/plugins with plugins/;\n\
4. keep the same secret key (<data_dir>/secret.key or secret_key in the configuration): it is not here;\n\
5. start the server.\n\n\
Restore one tenant: System > Backup > Restore a tenant, in the running installation.\n";

/// Runs a backup now (`manual`) or on schedule. Only one at a time.
pub async fn run(k: &Kernel, by: Option<&SessionUser>) -> Result<Backup> {
    if let Some(a) = by {
        require_admin(a)?;
    }
    if k.ops.backup_running.swap(true, Ordering::SeqCst) {
        return Err(Error::conflict("a backup is already running").with_code("backup_running"));
    }
    let res = run_inner(k, by).await;
    k.ops.backup_running.store(false, Ordering::SeqCst);
    res
}

async fn run_inner(k: &Kernel, by: Option<&SessionUser>) -> Result<Backup> {
    let id: Uuid = mosaikit_db::query_scalar(
        "insert into core.backups (manual, created_by) values ($1, $2) returning id",
    )
    .bind(by.is_some())
    .bind(by.map(|u| u.user_id))
    .fetch_one(&k.db)
    .await?;
    let d = dir(k);
    std::fs::create_dir_all(&d)?;
    let name = format!("mosaikit-{}.zip", Utc::now().format("%Y%m%d-%H%M%S"));
    let part = d.join(format!("{name}.part"));
    let result = write_backup(k, &part).await;
    match result {
        Ok((whole, tenants, note)) => {
            std::fs::rename(&part, d.join(&name))?;
            let size = std::fs::metadata(d.join(&name)).map(|m| m.len()).unwrap_or(0) as i64;
            mosaikit_db::query(
                "update core.backups set status = 'ok', finished_at = $2, file = $3, size_bytes = $4, whole = $5, tenants = $6,
                        error = $7
                 where id = $1",
            )
            .bind(id)
            .bind(Utc::now())
            .bind(&name)
            .bind(size)
            .bind(whole)
            .bind(tenants as i32)
            .bind(note)
            .execute(&k.db)
            .await?;
            events::record(
                k,
                None,
                by.map(|u| u.user_id),
                None,
                None,
                "backup.done",
                json!({ "file": name, "size": size, "whole": whole }),
            )
            .await;
            prune(k).await?;
        }
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            mosaikit_db::query(
                "update core.backups set status = 'failed', finished_at = $2, error = $3 where id = $1",
            )
            .bind(id)
            .bind(Utc::now())
            .bind(e.message.chars().take(500).collect::<String>())
            .execute(&k.db)
            .await?;
            events::record_failure(
                k,
                None,
                by.map(|u| u.user_id),
                "backup.failed",
                json!({ "error": e.message }),
            )
            .await;
            for a in crate::tenancy::lifecycle::administrators(k).await? {
                notify::emit(
                    k,
                    notify::New {
                        user: a,
                        tenant: None,
                        kind: NoteKind::System,
                        title: "The backup failed".into(),
                        body: e.message.chars().take(300).collect(),
                        link: "#/admin/system/backup".into(),
                        source: "kernel".into(),
                        resource: None,
                        data: json!({ "code": "backup.failed", "error": e.message }),
                    },
                )
                .await;
            }
        }
    }
    get(k, id).await
}

/// Writes the zip of a backup; returns whether the database dump is inside, how many tenants, and a note
/// when the dump could not be made.
async fn write_backup(k: &Kernel, part: &Path) -> Result<(bool, usize, String)> {
    let mut zip = ZipWriter::new(File::create(part)?);
    let dump = part.with_extension("dump");
    let (db_entry, note) = match dump_database(k, &dump).await {
        Ok(Some(e)) => (Some(e), String::new()),
        Ok(None) => (None, "database dump not included: pg_dump not found".to_string()),
        Err(e) if !k.db.is_sqlite() => {
            let _ = std::fs::remove_file(&dump);
            tracing::warn!("backup without the database dump: {e}");
            (None, format!("database dump not included: {}", e.message.chars().take(300).collect::<String>()))
        }
        Err(e) => {
            let _ = std::fs::remove_file(&dump);
            return Err(e);
        }
    };
    if let Some(entry) = db_entry {
        zip.start_file(entry, SimpleFileOptions::default().large_file(true)).map_err(zip_err)?;
        let mut f = File::open(&dump)?;
        std::io::copy(&mut f, &mut zip)?;
        drop(f);
        let _ = std::fs::remove_file(&dump);
    }
    transfer::add_dir(&mut zip, k.blobs.root(), "blobs/")?;
    transfer::add_dir(&mut zip, &k.cfg.data_dir.join("plugins"), "plugins/")?;
    let rows = mosaikit_db::query("select id, slug from core.tenants where not is_system order by slug")
        .fetch_all(&k.db)
        .await?;
    let mut tenants = Vec::new();
    for r in &rows {
        let (id, slug): (Uuid, String) = (r.get(0), r.get(1));
        transfer::export_into(k, id, &mut zip, &format!("tenants/{slug}/"), false).await?;
        tenants.push(json!({ "id": id, "slug": slug }));
    }
    zip.start_file("README.txt", SimpleFileOptions::default()).map_err(zip_err)?;
    zip.write_all(README.as_bytes())?;
    zip.start_file("manifest.json", SimpleFileOptions::default()).map_err(zip_err)?;
    let manifest = json!({
        "format": FORMAT,
        "version": 1,
        "backend": if k.db.is_sqlite() { "sqlite" } else { "postgres" },
        "kernel": crate::KERNEL_VERSION,
        "created_at": Utc::now(),
        "whole": db_entry.is_some(),
        "tenants": tenants,
    });
    zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
    zip.finish().map_err(zip_err)?;
    Ok((db_entry.is_some(), rows.len(), note))
}

/// Keeps the last `keep` backups.
async fn prune(k: &Kernel) -> Result<()> {
    let keep = config(k).await?.keep as usize;
    let rows = mosaikit_db::query(
        "select id, file from core.backups where status <> 'running' order by started_at desc",
    )
    .fetch_all(&k.db)
    .await?;
    for r in rows.iter().skip(keep) {
        let (id, file): (Uuid, String) = (r.get(0), r.get(1));
        if !file.is_empty() {
            let _ = std::fs::remove_file(dir(k).join(&file));
        }
        mosaikit_db::query("delete from core.backups where id = $1").bind(id).execute(&k.db).await?;
    }
    Ok(())
}

/// Deletes a backup and its file (Administrator).
pub async fn delete(k: &Kernel, admin: &SessionUser, id: Uuid) -> Result<()> {
    require_admin(admin)?;
    let b = get(k, id).await?;
    if b.status == "running" {
        return Err(Error::conflict("the backup is still running").with_code("backup_running"));
    }
    if !b.file.is_empty() {
        let _ = std::fs::remove_file(dir(k).join(&b.file));
    }
    mosaikit_db::query("delete from core.backups where id = $1").bind(id).execute(&k.db).await?;
    events::record(k, None, Some(admin.user_id), None, None, "backup.delete", json!({ "file": b.file }))
        .await;
    Ok(())
}

/// The scheduled backup, once a day at the configured hour (background work).
pub async fn scheduled(k: &Kernel) -> Result<()> {
    let c = config(k).await?;
    let now = Utc::now();
    if !c.enabled || now.hour() != c.hour as u32 {
        return Ok(());
    }
    let today = now.date_naive().and_hms_opt(0, 0, 0).expect("midnight").and_utc();
    let done: i64 =
        mosaikit_db::query_scalar("select count(*) from core.backups where not manual and started_at >= $1")
            .bind(today)
            .fetch_one(&k.db)
            .await?;
    if done == 0 {
        // a failure is recorded and notified inside
        let _ = run(k, None).await;
    }
    Ok(())
}

/// Running backups left by a stop of the server are marked failed at the start.
pub async fn recover(k: &Kernel) -> Result<()> {
    mosaikit_db::query("update core.backups set status = 'failed', error = 'interrupted', finished_at = $1 where status = 'running'")
        .bind(Utc::now())
        .execute(&k.db)
        .await?;
    Ok(())
}
