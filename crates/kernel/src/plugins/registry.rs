//! Catalog of the trusted plugins (`registry/index.json`) and blocklist.
//!
//! ```json
//! { "plugins": [ { "id": "com.mosaikit.notes", "name": "Notes", "description": "...",
//!                  "versions": [ { "version": "0.3.0", "file": "plugins/com.mosaikit.notes-0.3.0.mskp",
//!                                  "sha256": "...", "publisher": "<base64 key>" } ] } ],
//!   "blocklist": [ { "id": "com.x.y", "version": "1.0.0", "sha256": null, "reason": "..." } ] }
//! ```
//! `file` is relative to the folder of `index.json`.

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
    /// what changes in this version (release notes, plain text)
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub notes: String,
    /// `app`, `service` or `extension` (for the catalog, before installing)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// for an extension: the plugin it extends
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extends: Option<String>,
    /// range of versions of Mosaikit it works with (`[requires] mosaikit`), to show why it cannot be installed
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mosaikit: Option<String>,
    /// plugin API it was built for (`[requires] api`)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Blocked {
    pub id: String,
    /// blocked version (absent = all)
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
    pub kind: Option<String>,
    pub extends: Option<String>,
    /// the notes of the versions newer than the installed one (or of the latest), newest first
    pub notes: Vec<VersionNotes>,
    /// the latest version does not fit this Mosaikit: why (the interface translates it in Plugins > Updates)
    pub incompatible: Option<Incompat>,
}

/// What stops a version of the catalog from running here; the interface builds one translated text from it.
#[derive(Debug, Clone, Serialize)]
pub struct Incompat {
    /// `mosaikit` (outside the range) or `api` (another plugin API)
    pub reason: &'static str,
    /// the range or API the plugin declares
    pub wanted: String,
    /// the version of Mosaikit, or the API this Mosaikit supports
    pub have: String,
}

fn incompat(v: &EntryVersion) -> Option<Incompat> {
    use mosaikit_mskp::{VersionReq, API_VERSION};
    if let Some(a) = v.api.filter(|a| *a != API_VERSION) {
        return Some(Incompat { reason: "api", wanted: a.to_string(), have: API_VERSION.to_string() });
    }
    let range = v.mosaikit.as_deref()?;
    let kernel = Version::parse_lenient(crate::KERNEL_VERSION)?;
    (!VersionReq::parse(range)?.matches(kernel)).then(|| Incompat {
        reason: "mosaikit",
        wanted: range.to_string(),
        have: kernel.to_string(),
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionNotes {
    pub version: String,
    pub notes: String,
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
            let from = installed.as_deref().and_then(Version::parse);
            let mut notes: Vec<&EntryVersion> = e
                .versions
                .iter()
                .filter(|v| match (Version::parse(&v.version), from) {
                    (Some(x), Some(f)) => x > f,
                    (Some(_), None) => v.version == latest.version,
                    _ => false,
                })
                .filter(|v| !v.notes.is_empty())
                .collect();
            notes.sort_by_key(|v| std::cmp::Reverse(Version::parse(&v.version)));
            Some(CatalogItem {
                id: e.id.clone(),
                name: e.name.clone(),
                description: e.description.clone(),
                icon: e.icon.clone(),
                latest: latest.version.clone(),
                installed,
                update_available,
                incompatible: incompat(latest),
                kind: latest.kind.clone(),
                extends: latest.extends.clone(),
                notes: notes
                    .into_iter()
                    .map(|v| VersionNotes { version: v.version.clone(), notes: v.notes.clone() })
                    .collect(),
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

/// Reads the package of an entry of the catalog and checks its sha256.
fn read_package(k: &Kernel, v: &EntryVersion) -> Result<Vec<u8>> {
    let base = index_path(k)
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .ok_or_else(|| Error::not_found("registry not configured"))?;
    if !mosaikit_mskp::is_safe_path(&v.file) {
        return Err(Error::bad("invalid path of the package in the registry"));
    }
    let bytes =
        std::fs::read(base.join(&v.file)).map_err(|e| Error::not_found(format!("{}: {e}", v.file)))?;
    if mosaikit_mskp::package_sha256(&bytes) != v.sha256 {
        return Err(Error::forbidden(format!("{}: sha256 different from the one of the registry", v.file)));
    }
    Ok(bytes)
}

pub async fn install_from_catalog(k: &Kernel, admin: &SessionUser, id: &str) -> Result<()> {
    crate::tenancy::require_admin(admin)?;
    let index = load(k).ok_or_else(|| Error::not_found("registry not configured"))?;
    let entry = index
        .plugins
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| Error::not_found("plugin not in the catalog"))?;
    let v = latest(entry).ok_or_else(|| Error::not_found("no valid version"))?;
    let bytes = read_package(k, v)?;
    install_package(k, Some(admin), &bytes, InstallSource::Registry).await?;
    Ok(())
}

/// Installs and turns on the plugins of the catalog that are missing or have an older version.
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
                    tracing::info!("plugin {} {} preinstalled", e.id, v.version);
                }
                Err(err) => tracing::error!("preinstall {}: {err}", e.id),
            },
            Err(err) => tracing::error!("preinstall {}: {err}", e.id),
        }
    }
    Ok(())
}
