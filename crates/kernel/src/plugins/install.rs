//! Installation and update: check of the package, schema, migrations.

use std::collections::BTreeMap;

use mosaikit_mskp::{FieldKind, Manifest, Package, Version};
use serde_json::json;
use sha2::{Digest, Sha256};

use super::{install_dir, registry, LoadedPlugin, Status};
use crate::util::random_token;
use crate::{events, Error, Kernel, Result, SessionUser};

/// Where the package comes from (for the event log).
#[derive(Debug, Clone, Copy)]
pub enum InstallSource {
    Upload,
    Registry,
    Preinstall,
}

/// Installs or updates a plugin from a `.mskp` package. The state (on or off)
/// of a plugin already installed is kept.
pub async fn install_package(
    k: &Kernel,
    admin: Option<&SessionUser>,
    bytes: &[u8],
    source: InstallSource,
) -> Result<std::sync::Arc<LoadedPlugin>> {
    if let Some(a) = admin {
        crate::tenancy::require_admin(a)?;
    }
    let pkg = Package::read(bytes)?;
    let signed_by = pkg.verify(&k.trusted, k.cfg.allow_unsigned)?;
    let m = &pkg.manifest;
    if registry::is_blocked(k, &m.id, &m.version, &pkg.sha256) {
        return Err(Error::forbidden(format!("{} {} is in the blocklist of the registry", m.id, m.version)));
    }
    let min = Version::parse(&m.min_kernel).unwrap_or(Version(0, 0, 0));
    let kernel = Version::parse(crate::KERNEL_VERSION).unwrap_or(Version(0, 0, 0));
    if min > kernel {
        return Err(Error::bad(format!("the plugin requires kernel {min} (this one is {kernel})")));
    }
    let module = match pkg.wasm() {
        Some(w) => Some(k.engine.compile(w)?),
        None => None,
    };

    let existing = mosaikit_db::query("select version, sha256, dev, status from core.plugins where id = $1")
        .bind(&m.id)
        .fetch_optional(&k.db)
        .await?;
    let mut status = Status::Installed;
    if let Some(r) = &existing {
        let version: String = r.get(0);
        let sha: String = r.get(1);
        let dev: bool = r.get(2);
        status = Status::parse(r.get::<&str, _>(3));
        if dev {
            return Err(Error::conflict(format!("{} is loaded in development mode", m.id)));
        }
        let old = Version::parse(&version).unwrap_or(Version(0, 0, 0));
        if m.version() < old {
            return Err(Error::bad(format!("downgrade not allowed ({old} -> {})", m.version)));
        }
        if m.version() == old && sha == pkg.sha256 {
            return k.plugins.get(&m.id).ok_or_else(|| Error::internal("plugin installed but not loaded"));
        }
        if m.version() == old {
            return Err(Error::conflict(format!(
                "{} {} is already installed with a different content: raise the version",
                m.id, m.version
            )));
        }
    }

    // files of the package: first in a temporary folder, then in their place
    let dir = install_dir(k, &m.id, &m.version);
    let tmp =
        dir.parent().expect("folder of the plugin").join(format!(".tmp-{}-{}", m.version, random_token(4)));
    for (name, data) in &pkg.files {
        let path = tmp.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, data)?;
    }

    // installed again after an uninstall: its state of then comes back (super::memory)
    let memory = if existing.is_none() { super::memory::recall(k, &m.id).await? } else { None };
    if let Some(mem) = &memory {
        status = mem.status;
    }
    let result = async {
        let mut tx = k.db.begin_app().await?;
        upsert_row(&mut tx, k, m, &pkg.sha256, signed_by.as_deref(), false, status).await?;
        apply_schema(k, &mut tx, m, &pkg.migrations()?, false).await?;
        if let Some(mem) = &memory {
            super::memory::restore(&mut tx, &m.id, mem).await?;
        }
        tx.commit().await?;
        Ok::<_, Error>(())
    }
    .await;
    if let Err(e) = result {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }
    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    std::fs::rename(&tmp, &dir)?;
    // previous versions
    if let Ok(rd) = std::fs::read_dir(dir.parent().expect("folder of the plugin")) {
        for e in rd.flatten() {
            if e.path() != dir {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
    k.db.forget_plugin_pool(&m.id).await;
    let ui = dir.join("ui");
    let loaded = k.plugins.put(LoadedPlugin {
        id: m.id.clone(),
        manifest: m.clone(),
        status,
        dev: false,
        ui_dir: ui.is_dir().then_some(ui),
        module,
        sha256: pkg.sha256.clone(),
        signed_by: signed_by.clone(),
        installed_at: chrono::Utc::now(),
        layout: (m.effective_kind() == mosaikit_mskp::PluginKind::Layout)
            .then(|| pkg.layout().ok().map(std::sync::Arc::new))
            .flatten(),
    });
    events::record(
        k,
        None,
        admin.map(|a| a.user_id),
        Some(&m.id),
        None,
        if existing.is_some() { "plugin.upgrade" } else { "plugin.install" },
        json!({ "version": m.version, "sha256": pkg.sha256, "signed_by": signed_by, "source": format!("{source:?}") }),
    )
    .await;
    Ok(loaded)
}

pub(crate) async fn upsert_row(
    tx: &mut mosaikit_db::Tx,
    k: &Kernel,
    m: &Manifest,
    sha: &str,
    signed_by: Option<&str>,
    dev: bool,
    status: Status,
) -> Result<()> {
    let role = k.db.plugin_role(&m.id);
    mosaikit_db::query(
        "insert into core.plugins (id, version, manifest, sha256, signed_by, status, dev, schema_name, role_name, role_password)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (id) do update set version = excluded.version, manifest = excluded.manifest,
             sha256 = excluded.sha256, signed_by = excluded.signed_by, dev = excluded.dev, updated_at = now()",
    )
    .bind(&m.id)
    .bind(&m.version)
    .bind(serde_json::to_value(m)?)
    .bind(sha)
    .bind(signed_by)
    .bind(status.as_str())
    .bind(dev)
    .bind(m.schema_name())
    .bind(role)
    .bind(random_token(24))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn checksum(sql: &str) -> String {
    hex::encode(Sha256::digest(sql.replace("\r\n", "\n").as_bytes()))
}

/// Schema of the plugin: role, tables of the `[[resources]]`, migrations, freezing.
pub async fn apply_schema(
    k: &Kernel,
    tx: &mut mosaikit_db::Tx,
    m: &Manifest,
    migrations: &[(u32, String, String)],
    dev: bool,
) -> Result<()> {
    let schema = m.schema_name();
    let extra = check_requirements(k, tx, m).await?;
    let ps = k.db.plugin_schema(&m.id, &schema).with_search_path(extra);
    let password: String = mosaikit_db::query_scalar("select role_password from core.plugins where id = $1")
        .bind(&m.id)
        .fetch_one(&mut **tx)
        .await?;
    ps.provision(tx, &password).await?;
    ps.thaw(tx).await?;

    // tables generated from the manifest (generic CRUD)
    let mut auto = Vec::new();
    for r in &m.resources {
        let cols: BTreeMap<String, String> = ps.columns(tx, &r.name).await?.into_iter().collect();
        if cols.is_empty() {
            let fields: Vec<String> =
                r.fields.iter().map(|f| format!(", \"{}\" {}", f.key, f.kind.sql_type())).collect();
            auto.push(format!(
                "create table \"{}\" (resource_id uuid primary key, tenant_id uuid not null default core.ctx_tenant(){})",
                r.name,
                fields.concat()
            ));
        } else {
            for f in &r.fields {
                match cols.get(&f.key) {
                    None => auto.push(format!(
                        "alter table \"{}\" add column \"{}\" {}",
                        r.name,
                        f.key,
                        f.kind.sql_type()
                    )),
                    Some(t) if !same_type(t, f.kind) => {
                        return Err(Error::bad(format!(
                            "field {}.{} is already of type {t}: it cannot change to {:?}",
                            r.name, f.key, f.kind
                        )))
                    }
                    _ => {}
                }
            }
        }
    }
    if !auto.is_empty() {
        let stmts = mosaikit_sql_guard::check_migration(&auto.join(";\n"), &schema)?;
        ps.run_as_plugin(tx, &stmts).await?;
    }

    // migrations of the plugin
    let applied: BTreeMap<i32, String> =
        mosaikit_db::query("select version, checksum from core.plugin_migrations where plugin_id = $1")
            .bind(&m.id)
            .fetch_all(&mut **tx)
            .await?
            .iter()
            .map(|r| (r.get(0), r.get(1)))
            .collect();
    for (n, name, sql) in migrations {
        let sum = checksum(sql);
        match applied.get(&(*n as i32)) {
            Some(prev) if *prev == sum => continue,
            Some(_) => {
                return Err(Error::bad(if dev {
                    format!(
                        "migration {name} was already applied and then changed: create a new migration \
                         or reset the data of the plugin with `cargo xtask plugin db-reset {}`",
                        m.id
                    )
                } else {
                    format!("migration {name} differs from the one already applied")
                }))
            }
            None => {}
        }
        let stmts = mosaikit_sql_guard::check_migration(sql, &schema)
            .map_err(|e| Error::bad(format!("migration {name}: {e}")))?;
        ps.run_as_plugin(tx, &stmts).await.map_err(|e| Error::bad(format!("migration {name}: {e}")))?;
        mosaikit_db::query(
            "insert into core.plugin_migrations (plugin_id, version, name, checksum) values ($1, $2, $3, $4)",
        )
        .bind(&m.id)
        .bind(*n as i32)
        .bind(name)
        .bind(sum)
        .execute(&mut **tx)
        .await?;
    }

    let report = ps.freeze(tx).await?;
    for kpi in &m.kpi {
        if !report.kpi_views.contains(&kpi.view) {
            return Err(Error::bad(format!(
                "the KPI view {} declared in the manifest does not exist",
                kpi.view
            )));
        }
    }
    Ok(())
}

/// Requirements of the manifest (`[requires]`): database and extensions. Returns the schemas
/// of the extensions to add to the search_path of the plugin (e.g. `public` for PostGIS).
async fn check_requirements(k: &Kernel, tx: &mut mosaikit_db::Tx, m: &Manifest) -> Result<Vec<String>> {
    let r = &m.requires;
    if r.database.as_deref() == Some("postgres") && k.db.is_sqlite() {
        return Err(Error::bad(format!(
            "{} requires PostgreSQL: this installation uses SQLite (database.backend)",
            m.name
        )));
    }
    let mut schemas = Vec::new();
    for ext in &r.extensions {
        let installed: Option<String> = mosaikit_db::query_scalar(
            "select n.nspname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = $1",
        )
        .bind(ext)
        .fetch_optional(&mut **tx)
        .await?;
        let schema = match installed {
            Some(s) => s,
            None => {
                // if the app role can (a "trusted" extension or superuser) it creates it, otherwise a clear error
                tx.savepoint().await?;
                let created =
                    mosaikit_db::query(format!("create extension if not exists {}", mosaikit_db::qi(ext)))
                        .persistent(false)
                        .execute(&mut **tx)
                        .await;
                if created.is_err() {
                    tx.rollback_savepoint().await?;
                    return Err(Error::bad(format!(
                        "{} requires the PostgreSQL extension {ext}: install it in the database with \
                         CREATE EXTENSION {ext}; (a superuser is required)",
                        m.name
                    )));
                }
                tx.release_savepoint().await?;
                mosaikit_db::query_scalar(
                    "select n.nspname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = $1",
                )
                .bind(ext)
                .fetch_one(&mut **tx)
                .await?
            }
        };
        if !schemas.contains(&schema) {
            schemas.push(schema);
        }
    }
    Ok(schemas)
}

fn same_type(pg: &str, kind: FieldKind) -> bool {
    matches!(
        (pg, kind),
        ("text", FieldKind::Text | FieldKind::Choice)
            | ("double precision", FieldKind::Number)
            | ("boolean", FieldKind::Bool)
            | ("date", FieldKind::Date)
    )
}
