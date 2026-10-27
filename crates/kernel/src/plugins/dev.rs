//! Plugins in development: read from the source folder, reloaded at every change.
//!
//! - `plugin.toml`, `migrations/`: manifest and schema applied again (new migrations);
//! - `<target>/wasm32-unknown-unknown/debug/<crate>.wasm`: recompiled module;
//! - `ui/dist/`: the host UI reloads the iframe of the plugin.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use mosaikit_mskp::Manifest;
use notify::{RecursiveMode, Watcher};

use super::{install::upsert_row, LoadedPlugin, Status};
use crate::{DevEvent, Error, Kernel, Result};

/// Name of the crate (from Cargo.toml) -> .wasm file produced by cargo, in the `target`
/// of the workspace of the plugin (ancestor folder with `[workspace]`), otherwise in `dev.target_dir`.
fn wasm_path(k: &Kernel, dir: &Path) -> Option<PathBuf> {
    let cargo = std::fs::read_to_string(dir.join("Cargo.toml")).ok()?;
    let value: toml::Value = toml::from_str(&cargo).ok()?;
    let name = value.get("package")?.get("name")?.as_str()?.replace('-', "_");
    let file = format!("{name}.wasm");
    let workspace_target = dir.ancestors().skip(1).find_map(|a| {
        let manifest = std::fs::read_to_string(a.join("Cargo.toml")).ok()?;
        manifest.contains("[workspace]").then(|| a.join("target"))
    });
    let target = workspace_target.unwrap_or_else(|| k.cfg.dev.target_dir.clone());
    Some(target.join("wasm32-unknown-unknown").join("debug").join(file))
}

fn migrations(dir: &Path) -> Result<Vec<(u32, String, String)>> {
    let mut out = Vec::new();
    let mdir = dir.join("migrations");
    if mdir.is_dir() {
        for e in std::fs::read_dir(&mdir)?.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if let Some(n) = mosaikit_mskp::parse_migration_name(&name) {
                out.push((n, name, std::fs::read_to_string(e.path())?));
            }
        }
    }
    out.sort_by_key(|m| m.0);
    Ok(out)
}

/// Loads (or reloads) a plugin from its source folder.
pub async fn load_one(k: &Kernel, dir: &Path) -> Result<String> {
    let manifest = Manifest::from_toml(&std::fs::read_to_string(dir.join("plugin.toml"))?)?;
    let installed_as_package: bool =
        mosaikit_db::query_scalar("select exists (select 1 from core.plugins where id = $1 and not dev)")
            .bind(&manifest.id)
            .fetch_one(&k.db)
            .await?;
    if installed_as_package {
        return Err(Error::conflict(format!(
            "{} is installed as a package: uninstall it to develop it from the folder",
            manifest.id
        )));
    }
    let module = match wasm_path(k, dir) {
        Some(w) if w.is_file() => Some(k.engine.compile(&std::fs::read(&w)?)?),
        Some(w) => {
            tracing::warn!("{}: {} not compiled yet", manifest.id, w.display());
            None
        }
        None => None,
    };
    let mut tx = k.db.begin_app().await?;
    upsert_row(&mut tx, k, &manifest, "dev", None, true, Status::Active).await?;
    mosaikit_db::query("update core.plugins set status = 'active' where id = $1")
        .bind(&manifest.id)
        .execute(&mut *tx)
        .await?;
    super::apply_schema(k, &mut tx, &manifest, &migrations(dir)?, true).await?;
    tx.commit().await?;
    let ui = dir.join("ui").join("dist");
    let id = manifest.id.clone();
    let layout = (manifest.effective_kind() == mosaikit_mskp::PluginKind::Layout)
        .then(|| super::load_layout_dir(dir, &id))
        .flatten();
    let language = (manifest.effective_kind() == mosaikit_mskp::PluginKind::Language)
        .then(|| super::load_language_dir(dir, &manifest))
        .flatten();
    k.plugins.put(LoadedPlugin {
        id: id.clone(),
        manifest,
        status: Status::Active,
        dev: true,
        ui_dir: Some(ui),
        module,
        sha256: "dev".into(),
        signed_by: None,
        installed_at: chrono::Utc::now(),
        layout,
        language,
    });
    Ok(id)
}

pub async fn load_all(k: &Kernel) {
    for dir in k.cfg.dev.plugins.clone() {
        match load_one(k, &dir).await {
            Ok(id) => tracing::info!("development plugin {id} loaded from {}", dir.display()),
            Err(e) => tracing::error!("development plugin {}: {e}", dir.display()),
        }
    }
}

/// Watches the folders of the plugins and the compiled .wasm files; reloads and notifies the UI.
pub fn watch(k: Arc<Kernel>) {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<PathBuf>();
    let dirs = k.cfg.dev.plugins.clone();
    let wasm_dir = k.cfg.dev.target_dir.join("wasm32-unknown-unknown").join("debug");
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            for p in ev.paths {
                let _ = tx.send(p);
            }
        }
    });
    let mut watcher = match watcher {
        Ok(w) => w,
        Err(e) => {
            tracing::error!("hot reload not available: {e}");
            return;
        }
    };
    for d in &dirs {
        if let Err(e) = watcher.watch(d, RecursiveMode::Recursive) {
            tracing::warn!("watch {}: {e}", d.display());
        }
    }
    // folders of the .wasm files: one per workspace of plugins (e.g. mosaikit-plugins and the ones of a distribution)
    let mut wasm_dirs: Vec<PathBuf> =
        dirs.iter().filter_map(|d| wasm_path(&k, d)?.parent().map(Path::to_path_buf)).collect();
    wasm_dirs.push(wasm_dir);
    wasm_dirs.sort();
    wasm_dirs.dedup();
    for w in &wasm_dirs {
        let _ = std::fs::create_dir_all(w);
        if let Err(e) = watcher.watch(w, RecursiveMode::NonRecursive) {
            tracing::warn!("watch {}: {e}", w.display());
        }
    }
    // dedicated thread: reloads use the runtime with block_on, one at a time
    let rt = tokio::runtime::Handle::current();
    std::thread::spawn(move || {
        let _keep = watcher;
        while let Some(first) = rx.blocking_recv() {
            let mut paths = vec![first];
            // merges close changes (builds, several saves)
            std::thread::sleep(Duration::from_millis(400));
            while let Ok(p) = rx.try_recv() {
                paths.push(p);
            }
            for dir in &dirs {
                let wasm = wasm_path(&k, dir);
                let mut what = None;
                for p in &paths {
                    let rel = p.strip_prefix(dir).ok();
                    let relevant = match rel {
                        Some(r) => {
                            let s = r.to_string_lossy().replace('\\', "/");
                            if s == "plugin.toml" || s.starts_with("migrations/") {
                                Some("schema")
                            } else if s.starts_with("ui/dist") {
                                Some("ui")
                            } else {
                                None
                            }
                        }
                        None if wasm.as_deref() == Some(p.as_path()) => Some("logic"),
                        None => None,
                    };
                    if relevant.is_some() {
                        what = what.or(relevant);
                        if relevant == Some("schema") || relevant == Some("logic") {
                            what = relevant;
                        }
                    }
                }
                let Some(what) = what else { continue };
                let id = Manifest::from_toml(
                    &std::fs::read_to_string(dir.join("plugin.toml")).unwrap_or_default(),
                )
                .map(|m| m.id)
                .unwrap_or_else(|_| dir.display().to_string());
                if what == "ui" {
                    k.emit(DevEvent::PluginChanged { id, what: what.into() });
                    continue;
                }
                match rt.block_on(load_one(&k, dir)) {
                    Ok(id) => {
                        tracing::info!("hot reload: {id} ({what})");
                        k.emit(DevEvent::PluginChanged { id, what: what.into() });
                    }
                    Err(e) => {
                        tracing::error!("hot reload {id}: {e}");
                        k.emit(DevEvent::PluginError { id, error: e.to_string() });
                    }
                }
            }
        }
    });
}
