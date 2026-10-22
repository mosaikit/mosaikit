//! Plugins: in-memory registry, installation, activation, development, catalog.

pub mod dev;
mod install;
pub mod registry;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use chrono::{DateTime, Utc};
use mosaikit_mskp::Manifest;
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::{events, Error, Kernel, Result, SessionUser};

pub use install::{apply_schema, install_package, InstallSource};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Installed,
    Active,
    Blocked,
}

impl Status {
    pub fn parse(s: &str) -> Status {
        match s {
            "active" => Status::Active,
            "blocked" => Status::Blocked,
            _ => Status::Installed,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Active => "active",
            Status::Blocked => "blocked",
            Status::Installed => "installed",
        }
    }
}

pub struct LoadedPlugin {
    pub id: String,
    pub manifest: Manifest,
    pub status: Status,
    pub dev: bool,
    /// folder of the UI (installed `ui/` or `ui/dist` in development)
    pub ui_dir: Option<PathBuf>,
    pub module: Option<mosaikit_runtime::Module>,
    pub sha256: String,
    pub signed_by: Option<String>,
    pub installed_at: DateTime<Utc>,
}

impl LoadedPlugin {
    pub fn schema(&self) -> String {
        self.manifest.schema_name()
    }
    pub fn is_active(&self) -> bool {
        self.status == Status::Active
    }
}

#[derive(Default)]
pub struct Plugins(RwLock<HashMap<String, Arc<LoadedPlugin>>>);

impl Plugins {
    pub fn get(&self, id: &str) -> Option<Arc<LoadedPlugin>> {
        self.0.read().expect("lock plugin").get(id).cloned()
    }

    /// Active plugin, otherwise NotFound.
    pub fn active(&self, id: &str) -> Result<Arc<LoadedPlugin>> {
        self.get(id)
            .filter(|p| p.is_active())
            .ok_or_else(|| Error::not_found(format!("plugin not active: {id}")))
    }

    pub fn list(&self) -> Vec<Arc<LoadedPlugin>> {
        let mut v: Vec<_> = self.0.read().expect("lock plugin").values().cloned().collect();
        v.sort_by(|a, b| a.manifest.contribution.label.cmp(&b.manifest.contribution.label));
        v
    }

    pub(crate) fn put(&self, p: LoadedPlugin) -> Arc<LoadedPlugin> {
        let p = Arc::new(p);
        self.0.write().expect("lock plugin").insert(p.id.clone(), p.clone());
        p
    }

    pub(crate) fn remove(&self, id: &str) {
        self.0.write().expect("lock plugin").remove(id);
    }

    pub(crate) fn set_status(&self, id: &str, status: Status) {
        let mut map = self.0.write().expect("lock plugin");
        if let Some(p) = map.get(id) {
            let p = LoadedPlugin {
                id: p.id.clone(),
                manifest: p.manifest.clone(),
                status,
                dev: p.dev,
                ui_dir: p.ui_dir.clone(),
                module: p.module.clone(),
                sha256: p.sha256.clone(),
                signed_by: p.signed_by.clone(),
                installed_at: p.installed_at,
            };
            map.insert(id.to_string(), Arc::new(p));
        }
    }
}

/// Installation folder of a version.
pub fn install_dir(k: &Kernel, id: &str, version: &str) -> PathBuf {
    k.cfg.data_dir.join("plugins").join(id).join(version)
}

/// Loads into memory the installed plugins (not the development ones) recorded in the database.
pub async fn load_installed(k: &Kernel) -> Result<()> {
    let rows = mosaikit_db::query(
        "select id, version, status, sha256, signed_by, installed_at from core.plugins where not dev",
    )
    .fetch_all(&k.db)
    .await?;
    for r in rows {
        let id: String = r.get(0);
        let version: String = r.get(1);
        let dir = install_dir(k, &id, &version);
        match load_from_dir(k, &dir) {
            Ok((manifest, module)) => {
                let mut status = Status::parse(r.get::<&str, _>(2));
                let sha: String = r.get(3);
                if registry::is_blocked(k, &id, &version, &sha) {
                    status = Status::Blocked;
                    let _ = mosaikit_db::query("update core.plugins set status = 'blocked' where id = $1")
                        .bind(&id)
                        .execute(&k.db)
                        .await;
                    tracing::warn!("plugin {id} {version} in the blocklist: blocked");
                }
                let ui = dir.join("ui");
                k.plugins.put(LoadedPlugin {
                    id: id.clone(),
                    manifest,
                    status,
                    dev: false,
                    ui_dir: ui.is_dir().then_some(ui),
                    module,
                    sha256: sha,
                    signed_by: r.get(4),
                    installed_at: r.get(5),
                });
            }
            Err(e) => tracing::error!("plugin {id} {version} cannot be loaded from {}: {e}", dir.display()),
        }
    }
    Ok(())
}

pub(crate) fn load_from_dir(k: &Kernel, dir: &Path) -> Result<(Manifest, Option<mosaikit_runtime::Module>)> {
    let text = std::fs::read_to_string(dir.join("plugin.toml"))?;
    let manifest = Manifest::from_toml(&text)?;
    let wasm = dir.join(mosaikit_mskp::WASM_FILE);
    let module = if wasm.is_file() { Some(k.engine.compile(&std::fs::read(wasm)?)?) } else { None };
    Ok((manifest, module))
}

// ------------------------------------------------------------------ information for the APIs

/// Plugin as the host UI sees it (rail).
#[derive(Debug, Clone, Serialize)]
pub struct PluginView {
    pub id: String,
    pub name: String,
    pub version: String,
    pub icon: String,
    pub label: String,
    pub description: String,
    pub has_ui: bool,
    pub dev: bool,
    pub permissions: mosaikit_mskp::Permissions,
    pub resources: Vec<mosaikit_mskp::ResourceDecl>,
}

impl PluginView {
    pub fn of(p: &LoadedPlugin) -> PluginView {
        PluginView {
            id: p.id.clone(),
            name: p.manifest.name.clone(),
            version: p.manifest.version.clone(),
            icon: p.manifest.contribution.icon.clone(),
            label: p.manifest.contribution.label.clone(),
            description: p.manifest.description.clone(),
            has_ui: p.ui_dir.is_some() && p.manifest.ui.is_some(),
            dev: p.dev,
            permissions: p.manifest.permissions.clone(),
            resources: p.manifest.resources.clone(),
        }
    }
}

/// Plugin as the administrator sees it.
#[derive(Debug, Clone, Serialize)]
pub struct PluginAdminView {
    #[serde(flatten)]
    pub view: PluginView,
    pub status: Status,
    pub sha256: String,
    pub signed_by: Option<String>,
    pub installed_at: DateTime<Utc>,
    pub has_logic: bool,
    pub kpi: Vec<mosaikit_mskp::KpiDecl>,
}

pub fn active_views(k: &Kernel) -> Vec<PluginView> {
    k.plugins.list().iter().filter(|p| p.is_active()).map(|p| PluginView::of(p)).collect()
}

pub fn admin_views(k: &Kernel, admin: &SessionUser) -> Result<Vec<PluginAdminView>> {
    crate::tenancy::require_admin(admin)?;
    Ok(k.plugins
        .list()
        .iter()
        .map(|p| PluginAdminView {
            view: PluginView::of(p),
            status: p.status,
            sha256: p.sha256.clone(),
            signed_by: p.signed_by.clone(),
            installed_at: p.installed_at,
            has_logic: p.module.is_some(),
            kpi: p.manifest.kpi.clone(),
        })
        .collect())
}

// ------------------------------------------------------------------ activation and removal

pub async fn set_active(k: &Kernel, admin: Option<&SessionUser>, id: &str, active: bool) -> Result<()> {
    if let Some(a) = admin {
        crate::tenancy::require_admin(a)?;
    }
    let p = k.plugins.get(id).ok_or_else(|| Error::not_found(format!("plugin not installed: {id}")))?;
    if p.status == Status::Blocked && active {
        return Err(Error::forbidden("plugin blocked by the blocklist of the registry"));
    }
    let status = if active { Status::Active } else { Status::Installed };
    mosaikit_db::query("update core.plugins set status = $2, updated_at = now() where id = $1")
        .bind(id)
        .bind(status.as_str())
        .execute(&k.db)
        .await?;
    k.plugins.set_status(id, status);
    events::record(
        k,
        None,
        admin.map(|a| a.user_id),
        Some(id),
        None,
        if active { "plugin.activate" } else { "plugin.deactivate" },
        json!({}),
    )
    .await;
    Ok(())
}

/// Uninstalls: schema, role, resources (in cascade), contents on disk, files of the package.
pub async fn uninstall(k: &Kernel, admin: &SessionUser, id: &str) -> Result<()> {
    crate::tenancy::require_admin(admin)?;
    let p = k.plugins.get(id).ok_or_else(|| Error::not_found(format!("plugin not installed: {id}")))?;
    let resources: Vec<(Uuid, Uuid)> =
        mosaikit_db::query("select tenant_id, id from core.resources where plugin_id = $1")
            .bind(id)
            .fetch_all(&k.db)
            .await?
            .iter()
            .map(|r| (r.get(0), r.get(1)))
            .collect();
    k.db.forget_plugin_pool(id).await;
    let ps = k.db.plugin_schema(id, &p.schema());
    let mut tx = k.db.begin_app().await?;
    ps.drop(&mut tx).await?;
    mosaikit_db::query("delete from core.plugins where id = $1").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    k.plugins.remove(id);
    for (tenant, rid) in resources {
        k.blobs.remove(tenant, rid);
    }
    let dir = k.cfg.data_dir.join("plugins").join(id);
    if dir.is_dir() && !p.dev {
        let _ = std::fs::remove_dir_all(dir);
    }
    events::record(k, None, Some(admin.user_id), Some(id), None, "plugin.uninstall", json!({})).await;
    Ok(())
}
