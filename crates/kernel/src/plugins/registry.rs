//! Catalogo dei plugin fidati (`registry/index.json`) e blocklist.
//!
//! ```json
//! { "plugins": [ { "id": "com.mosaikit.notes", "name": "Note", "description": "...",
//!                  "versions": [ { "version": "0.3.0", "file": "plugins/com.mosaikit.notes-0.3.0.mskp",
//!                                  "sha256": "...", "publisher": "<chiave base64>" } ] } ],
//!   "blocklist": [ { "id": "com.x.y", "version": "1.0.0", "sha256": null, "reason": "..." } ] }
//! ```
//! `file` e' relativo alla cartella di `index.json`.

use std::path::PathBuf;

use mosaikit_mskp::Version;
use serde::{Deserialize, Serialize};

use super::{install_package, set_active, InstallSource};
use crate::{Error, Kernel, Result, SessionUser};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Index {
    #[serde(default)]
    pub plugins: Vec<Entry>,
    #[serde(default)]
    pub blocklist: Vec<Blocked>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: String,
    pub versions: Vec<EntryVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryVersion {
    pub version: String,
    pub file: String,
    pub sha256: String,
    #[serde(default)]
    pub publisher: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Blocked {
    pub id: String,
    /// versione bloccata (assente = tutte)
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub reason: String,
}

fn index_path(k: &Kernel) -> Option<PathBuf> {
    k.cfg.registry.clone().filter(|p| p.is_file())
}

pub fn load(k: &Kernel) -> Option<Index> {
    let p = index_path(k)?;
    match std::fs::read_to_string(&p)
        .map_err(|e| e.to_string())
        .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
    {
        Ok(i) => Some(i),
        Err(e) => {
            tracing::error!("registry {}: {e}", p.display());
            None
        }
    }
}

pub fn is_blocked(k: &Kernel, id: &str, version: &str, sha256: &str) -> bool {
    load(k).is_some_and(|i| {
        i.blocklist.iter().any(|b| {
            b.id == id
                && b.version.as_deref().is_none_or(|v| v == version)
                && b.sha256.as_deref().is_none_or(|s| s == sha256)
        })
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct CatalogItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub latest: String,
    pub installed: Option<String>,
    pub update_available: bool,
}

pub fn catalog(k: &Kernel, admin: &SessionUser) -> Result<Vec<CatalogItem>> {
    crate::tenancy::require_admin(admin)?;
    let Some(index) = load(k) else { return Ok(vec![]) };
    Ok(index
        .plugins
        .iter()
        .filter_map(|e| {
            let latest = latest(e)?;
            let installed = k.plugins.get(&e.id).map(|p| p.manifest.version.clone());
            let update_available = installed
                .as_deref()
                .and_then(Version::parse)
                .zip(Version::parse(&latest.version))
                .is_some_and(|(i, l)| l > i);
            Some(CatalogItem {
                id: e.id.clone(),
                name: e.name.clone(),
                description: e.description.clone(),
                icon: e.icon.clone(),
                latest: latest.version.clone(),
                installed,
                update_available,
            })
        })
        .collect())
}

fn latest(e: &Entry) -> Option<&EntryVersion> {
    e.versions
        .iter()
        .filter(|v| Version::parse(&v.version).is_some())
        .max_by_key(|v| Version::parse(&v.version))
}

/// Legge il pacchetto di una voce del catalogo e ne verifica lo sha256.
fn read_package(k: &Kernel, v: &EntryVersion) -> Result<Vec<u8>> {
    let base = index_path(k)
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .ok_or_else(|| Error::not_found("registry non configurato"))?;
    if !mosaikit_mskp::is_safe_path(&v.file) {
        return Err(Error::bad("percorso del pacchetto non valido nel registry"));
    }
    let bytes =
        std::fs::read(base.join(&v.file)).map_err(|e| Error::not_found(format!("{}: {e}", v.file)))?;
    if mosaikit_mskp::package_sha256(&bytes) != v.sha256 {
        return Err(Error::forbidden(format!("{}: sha256 diverso da quello del registry", v.file)));
    }
    Ok(bytes)
}

pub async fn install_from_catalog(k: &Kernel, admin: &SessionUser, id: &str) -> Result<()> {
    crate::tenancy::require_admin(admin)?;
    let index = load(k).ok_or_else(|| Error::not_found("registry non configurato"))?;
    let entry = index
        .plugins
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| Error::not_found("plugin non presente nel catalogo"))?;
    let v = latest(entry).ok_or_else(|| Error::not_found("nessuna versione valida"))?;
    let bytes = read_package(k, v)?;
    install_package(k, Some(admin), &bytes, InstallSource::Registry).await?;
    Ok(())
}

/// Installa e attiva i plugin del catalogo assenti o con versione piu' vecchia.
pub async fn preinstall(k: &Kernel) -> Result<()> {
    let Some(index) = load(k) else { return Ok(()) };
    for e in &index.plugins {
        let Some(v) = latest(e) else { continue };
        let installed = k.plugins.get(&e.id);
        let newer = match &installed {
            None => true,
            Some(p) if p.dev => false,
            Some(p) => Version::parse(&v.version) > Version::parse(&p.manifest.version),
        };
        if !newer {
            continue;
        }
        let was_installed = installed.is_some();
        match read_package(k, v) {
            Ok(bytes) => match install_package(k, None, &bytes, InstallSource::Preinstall).await {
                Ok(_) => {
                    if !was_installed {
                        set_active(k, None, &e.id, true).await?;
                    }
                    tracing::info!("plugin {} {} preinstallato", e.id, v.version);
                }
                Err(err) => tracing::error!("preinstallazione {}: {err}", e.id),
            },
            Err(err) => tracing::error!("preinstallazione {}: {err}", e.id),
        }
    }
    Ok(())
}
