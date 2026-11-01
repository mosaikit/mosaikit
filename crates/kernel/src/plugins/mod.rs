//! Plugins: in-memory registry, installation, activation, development, catalog.

pub mod config;
pub mod dev;
pub mod extensions;
mod install;
mod memory;
pub mod registry;
pub mod tenants;

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
    /// for a layout plugin: its arrangement, stylesheet (scoped) and images, checked
    pub layout: Option<Arc<mosaikit_mskp::layout::Layout>>,
    /// for a language plugin: the texts of the host and of the manifests of other plugins, checked
    pub language: Option<Arc<mosaikit_mskp::language::LanguagePack>>,
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
        sync_language(&p);
        p
    }

    pub(crate) fn remove(&self, id: &str) {
        let old = self.0.write().expect("lock plugin").remove(id);
        if let Some(l) = old.and_then(|p| p.language.clone()) {
            mosaikit_mskp::language::clear_texts(&l.code);
        }
    }

    /// The languages the active language plugins bring (code, name), by code.
    pub fn languages(&self) -> Vec<Arc<mosaikit_mskp::language::LanguagePack>> {
        let mut v: Vec<_> = self
            .0
            .read()
            .expect("lock plugin")
            .values()
            .filter(|p| p.is_active())
            .filter_map(|p| p.language.clone())
            .collect();
        v.sort_by(|a, b| a.code.cmp(&b.code));
        v
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
                layout: p.layout.clone(),
                language: p.language.clone(),
            };
            let p = Arc::new(p);
            map.insert(id.to_string(), p.clone());
            sync_language(&p);
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
                let layout = if manifest.effective_kind() == mosaikit_mskp::PluginKind::Layout {
                    load_layout_dir(&dir, &manifest.id)
                } else {
                    None
                };
                let language = (manifest.effective_kind() == mosaikit_mskp::PluginKind::Language)
                    .then(|| load_language_dir(&dir, &manifest))
                    .flatten();
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
                    layout,
                    language,
                });
            }
            Err(e) => tracing::error!("plugin {id} {version} cannot be loaded from {}: {e}", dir.display()),
        }
    }
    Ok(())
}

/// A language plugin on or off: its texts for the manifests of other plugins are in use only while it is
/// active.
fn sync_language(p: &LoadedPlugin) {
    if let Some(l) = &p.language {
        if p.is_active() {
            mosaikit_mskp::language::set_texts(&l.code, l.plugins.clone());
        } else {
            mosaikit_mskp::language::clear_texts(&l.code);
        }
    }
}

/// The language of a language plugin from its folder (`lang/`), checked; errors are logged.
pub(crate) fn load_language_dir(
    dir: &Path,
    m: &Manifest,
) -> Option<Arc<mosaikit_mskp::language::LanguagePack>> {
    fn walk(
        base: &Path,
        d: &Path,
        out: &mut std::collections::BTreeMap<String, Vec<u8>>,
    ) -> std::io::Result<()> {
        for e in std::fs::read_dir(d)? {
            let p = e?.path();
            if p.is_dir() {
                walk(base, &p, out)?;
            } else if let Ok(rel) = p.strip_prefix(base) {
                out.insert(rel.to_string_lossy().replace('\\', "/"), std::fs::read(&p)?);
            }
        }
        Ok(())
    }
    let decl = m.language.as_ref()?;
    let base = dir.join("lang");
    let mut files = std::collections::BTreeMap::new();
    if base.is_dir() {
        if let Err(e) = walk(&base, &base, &mut files) {
            tracing::error!("language {}: {e}", m.id);
            return None;
        }
    }
    match mosaikit_mskp::language::load_language(&decl.code, &decl.name, &files) {
        Ok(l) => Some(Arc::new(l)),
        Err(e) => {
            tracing::error!("language {}: {e}", m.id);
            None
        }
    }
}

/// The layout of a layout plugin from its folder (`layout/`), checked; errors are logged.
pub(crate) fn load_layout_dir(dir: &Path, id: &str) -> Option<Arc<mosaikit_mskp::layout::Layout>> {
    fn walk(
        base: &Path,
        d: &Path,
        out: &mut std::collections::BTreeMap<String, Vec<u8>>,
    ) -> std::io::Result<()> {
        for e in std::fs::read_dir(d)? {
            let p = e?.path();
            if p.is_dir() {
                walk(base, &p, out)?;
            } else if let Ok(rel) = p.strip_prefix(base) {
                out.insert(rel.to_string_lossy().replace('\\', "/"), std::fs::read(&p)?);
            }
        }
        Ok(())
    }
    let base = dir.join("layout");
    let mut files = std::collections::BTreeMap::new();
    if let Err(e) = walk(&base, &base, &mut files) {
        tracing::error!("layout {id}: {e}");
        return None;
    }
    match mosaikit_mskp::layout::load_layout(id, &files) {
        Ok(l) => Some(Arc::new(l)),
        Err(e) => {
            tracing::error!("layout {id}: {e}");
            None
        }
    }
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
    /// emoji of the manifest (`contribution.icon`), for older hosts
    pub icon: String,
    /// name of the icon in the set of the shell (Lucide), if the manifest declares it
    pub icon_name: Option<String>,
    /// `app`, `service` or `extension`
    pub kind: &'static str,
    /// for an extension: the plugin it extends
    pub extends: Option<String>,
    pub label: String,
    pub description: String,
    pub has_ui: bool,
    /// where the UI of the plugin is served: `plugin_url`, or its own host with a wildcard
    pub ui_url: String,
    pub dev: bool,
    pub permissions: mosaikit_mskp::Permissions,
    pub resources: Vec<mosaikit_mskp::ResourceDecl>,
    /// the pages of an app in the navigation of the shell (`[[nav]]`)
    pub nav: Vec<mosaikit_mskp::NavDecl>,
}

impl PluginView {
    pub fn of(cfg: &crate::Config, p: &LoadedPlugin) -> PluginView {
        PluginView::with(cfg, p, &p.manifest)
    }

    /// With the texts of the manifest in `lang` (`it`, `it-IT`...), English where it has none.
    pub fn localized(cfg: &crate::Config, p: &LoadedPlugin, lang: &str) -> PluginView {
        PluginView::with(cfg, p, &p.manifest.localized(lang))
    }

    fn with(cfg: &crate::Config, p: &LoadedPlugin, m: &mosaikit_mskp::Manifest) -> PluginView {
        PluginView {
            id: p.id.clone(),
            name: m.name.clone(),
            version: m.version.clone(),
            icon: m.contribution.icon.clone(),
            icon_name: m.icon.clone(),
            kind: m.effective_kind().as_str(),
            extends: m.extends.as_ref().map(|e| e.plugin.clone()),
            label: m.contribution.label.clone(),
            description: m.description.clone(),
            has_ui: p.ui_dir.is_some() && m.ui.is_some(),
            ui_url: cfg.plugin_url_for(&p.id),
            dev: p.dev,
            permissions: m.permissions.clone(),
            resources: m.resources.clone(),
            nav: m.nav.clone(),
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
    /// what it asks of the platform (besides `permissions`)
    pub requires: mosaikit_mskp::Requires,
    pub user_permissions: Vec<mosaikit_mskp::UserPermission>,
    /// range of versions of Mosaikit the plugin works with (`>=1.2, <2`; `*` = any)
    pub requires_mosaikit: String,
    /// version of the plugin API the plugin was built for
    pub api: u32,
    /// for an extension: the version of the plugin it extends it needs
    pub extends_min: Option<String>,
    /// what an extension adds (fields and actions)
    pub extension: mosaikit_mskp::ExtensionDecl,
    /// it has settings (`[[config]]`)
    pub has_config: bool,
    /// brochure (optional in the manifest): author, licence, address, longer text and pictures
    pub author: Option<String>,
    pub license: Option<String>,
    pub homepage: Option<String>,
    pub details: Option<String>,
    pub screenshots: Vec<String>,
    /// for a layout: what the package contains (arrangement, stylesheet, images)
    pub layout: Option<LayoutContents>,
}

/// What a layout plugin contains, for the page "What it contains" of the Administrator.
#[derive(Debug, Clone, Serialize)]
pub struct LayoutContents {
    pub decl: mosaikit_mskp::layout::LayoutDecl,
    /// bytes of the checked stylesheet (0: none)
    pub css_bytes: usize,
    /// images by name, with their type
    pub images: Vec<(String, &'static str)>,
    /// the class that scopes the stylesheet
    pub class: String,
}

pub fn active_views(k: &Kernel) -> Vec<PluginView> {
    active_views_in(k, "en")
}

/// The active plugins, with their texts in `lang`.
pub fn active_views_in(k: &Kernel, lang: &str) -> Vec<PluginView> {
    k.plugins
        .list()
        .iter()
        .filter(|p| p.is_active())
        .map(|p| PluginView::localized(&k.cfg, p, lang))
        .collect()
}

pub fn admin_views(k: &Kernel, admin: &SessionUser) -> Result<Vec<PluginAdminView>> {
    admin_views_in(k, admin, "en")
}

/// Every plugin for the administrator, with its texts in `lang`.
pub fn admin_views_in(k: &Kernel, admin: &SessionUser, lang: &str) -> Result<Vec<PluginAdminView>> {
    crate::tenancy::require_admin(admin)?;
    Ok(k.plugins
        .list()
        .iter()
        .map(|p| PluginAdminView {
            view: PluginView::localized(&k.cfg, p, lang),
            status: p.status,
            sha256: p.sha256.clone(),
            signed_by: p.signed_by.clone(),
            installed_at: p.installed_at,
            has_logic: p.module.is_some(),
            kpi: p.manifest.localized(lang).kpi,
            requires: p.manifest.requires.clone(),
            user_permissions: p.manifest.localized(lang).user_permissions,
            requires_mosaikit: p.manifest.mosaikit_range().to_string(),
            api: p.manifest.api(),
            extends_min: p.manifest.extends.as_ref().map(|e| e.min_version.clone()),
            extension: p.manifest.localized(lang).extension,
            has_config: !p.manifest.config.is_empty(),
            author: p.manifest.author.clone(),
            license: p.manifest.license.clone(),
            homepage: p.manifest.homepage.clone(),
            details: p.manifest.localized(lang).details,
            screenshots: p.manifest.screenshots.clone(),
            layout: p.layout.as_ref().map(|l| LayoutContents {
                decl: l.decl.clone(),
                css_bytes: l.css.len(),
                images: l.images.iter().map(|(n, (_, t))| (n.clone(), *t)).collect(),
                class: mosaikit_mskp::layout::layout_class(&p.id),
            }),
        })
        .collect())
}

/// What uninstalling a plugin takes away, to say it before.
#[derive(Debug, Clone, Serialize)]
pub struct UninstallImpact {
    /// items of the plugin, in every tenant
    pub items: i64,
    /// tenants with items of the plugin
    pub tenants: i64,
    /// installed extensions of the plugin (they stop working)
    pub extensions: Vec<String>,
}

pub async fn uninstall_impact(k: &Kernel, admin: &SessionUser, id: &str) -> Result<UninstallImpact> {
    crate::tenancy::require_admin(admin)?;
    let p = k.plugins.get(id).ok_or_else(|| Error::not_found(format!("plugin not installed: {id}")))?;
    // an extension has no items of its own: what goes away are its values on the items of the plugin it
    // extends, in the tenants where it is on or holds values
    let (items, tenants): (i64, i64) = if p.manifest.extends.is_some() {
        let r = mosaikit_db::query(
            "select count(*), count(distinct tenant_id) from core.extension_values where extension_id = $1",
        )
        .bind(id)
        .fetch_one(&k.db)
        .await?;
        let with_values: std::collections::HashSet<Uuid> = mosaikit_db::query_scalar(
            "select distinct tenant_id from core.extension_values where extension_id = $1",
        )
        .bind(id)
        .fetch_all(&k.db)
        .await?
        .into_iter()
        .collect();
        let mut on = with_values.clone();
        let all: Vec<Uuid> = mosaikit_db::query_scalar("select id from core.tenants where not is_system")
            .fetch_all(&k.db)
            .await?;
        for t in all {
            if tenants::is_on(k, t, id).await? {
                on.insert(t);
            }
        }
        (r.get(0), on.len() as i64)
    } else {
        let r = mosaikit_db::query(
            "select count(*), count(distinct tenant_id) from core.resources where plugin_id = $1",
        )
        .bind(id)
        .fetch_one(&k.db)
        .await?;
        (r.get(0), r.get(1))
    };
    Ok(UninstallImpact {
        items,
        tenants,
        extensions: k
            .plugins
            .list()
            .iter()
            .filter(|p| p.manifest.extends.as_ref().is_some_and(|e| e.plugin == id))
            .map(|p| p.manifest.contribution.label.clone())
            .collect(),
    })
}

/// The fields of a resource of a plugin with their labels in `lang` (for the CRUD of the UIs).
pub fn localized_fields(
    k: &Kernel,
    plugin: &str,
    resource: &str,
    lang: &str,
) -> Option<Vec<mosaikit_mskp::FieldDecl>> {
    let p = k.plugins.get(plugin)?;
    let m = p.manifest.localized(lang);
    m.resource(resource).map(|r| r.fields.clone())
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
    let p = remove(k, id, true).await?;
    let dir = k.cfg.data_dir.join("plugins").join(id);
    if dir.is_dir() && !p.dev {
        let _ = std::fs::remove_dir_all(dir);
    }
    events::record(k, None, Some(admin.user_id), Some(id), None, "plugin.uninstall", json!({})).await;
    Ok(())
}

/// Deletes the data of a plugin (schema, role, resources, contents, settings) and its place in memory, for
/// the reset of the developer profile: the plugin is then loaded again from its folder.
pub(crate) async fn wipe(k: &Kernel, id: &str) -> Result<()> {
    remove(k, id, false).await.map(|_| ())
}

/// The part of the uninstall that deletes: `remember` keeps the state of the plugin for an install again.
async fn remove(k: &Kernel, id: &str, remember: bool) -> Result<Arc<LoadedPlugin>> {
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
    // its state and the choices of the tenants, for an install again (memory.rs)
    if remember {
        memory::remember(&mut tx, id).await?;
    }
    ps.drop(&mut tx).await?;
    mosaikit_db::query("delete from core.plugins where id = $1").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    k.plugins.remove(id);
    config::forget(k, id).await?;
    for (tenant, rid) in resources {
        k.blobs.remove(tenant, rid);
    }
    Ok(p)
}

/// A picture of the brochure of an installed plugin (`media/<name>` of its package) and its type.
pub fn media(k: &Kernel, id: &str, name: &str) -> Option<(Vec<u8>, &'static str)> {
    let p = k.plugins.get(id)?;
    if !p.manifest.screenshots.iter().any(|s| s == name) || !mosaikit_mskp::is_media_name(name) {
        return None;
    }
    // a plugin loaded from a folder (development) has its pictures in `media/` of the folder
    let dir = if p.dev {
        p.ui_dir.as_ref()?.parent()?.parent()?.join("media")
    } else {
        install_dir(k, id, &p.manifest.version).join("media")
    };
    let data = std::fs::read(dir.join(name)).ok()?;
    let mime = match name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return None,
    };
    Some((data, mime))
}
