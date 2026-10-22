//! Contents on disk: `<data_dir>/blobs/<tenant>/<resource>/{file | site/...}`.

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use uuid::Uuid;

use crate::util::random_token;
use crate::{Error, Kernel, Result};

const SITE_MAX_FILES: usize = 20_000;
const SITE_MAX_BYTES: u64 = 512 << 20;

pub struct Blobs {
    root: PathBuf,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SiteInfo {
    pub files: usize,
    pub size: u64,
    /// start page (least nested index.html), empty if absent
    pub entry: String,
}

impl Blobs {
    pub fn new(root: PathBuf) -> Blobs {
        Blobs { root }
    }

    fn dir(&self, tenant: Uuid, rid: Uuid) -> PathBuf {
        self.root.join(tenant.to_string()).join(rid.to_string())
    }

    pub fn file_path(&self, tenant: Uuid, rid: Uuid) -> PathBuf {
        self.dir(tenant, rid).join("file")
    }

    pub fn site_dir(&self, tenant: Uuid, rid: Uuid) -> PathBuf {
        self.dir(tenant, rid).join("site")
    }

    pub fn write_file(&self, tenant: Uuid, rid: Uuid, data: &[u8]) -> Result<()> {
        let dir = self.dir(tenant, rid);
        std::fs::create_dir_all(&dir)?;
        let tmp = dir.join(format!(".tmp-{}", random_token(4)));
        std::fs::write(&tmp, data)?;
        std::fs::rename(&tmp, dir.join("file"))?;
        Ok(())
    }

    pub fn read_file(&self, tenant: Uuid, rid: Uuid) -> Result<Vec<u8>> {
        std::fs::read(self.file_path(tenant, rid)).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => Error::not_found("content of the file missing"),
            _ => e.into(),
        })
    }

    pub fn copy_file(&self, tenant: Uuid, from: Uuid, to: Uuid) -> Result<()> {
        let src = self.file_path(tenant, from);
        if src.is_file() {
            std::fs::create_dir_all(self.dir(tenant, to))?;
            std::fs::copy(src, self.file_path(tenant, to))?;
        }
        Ok(())
    }

    pub fn remove(&self, tenant: Uuid, rid: Uuid) {
        let d = self.dir(tenant, rid);
        if d.is_dir() {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    /// Extracts a zip as the folder content of the resource, replacing the previous one.
    pub fn extract_site(&self, tenant: Uuid, rid: Uuid, zip_bytes: &[u8]) -> Result<SiteInfo> {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes))
            .map_err(|e| Error::bad(format!("invalid zip: {e}")))?;
        if zip.len() > SITE_MAX_FILES {
            return Err(Error::bad(format!("the zip contains more than {SITE_MAX_FILES} files")));
        }
        let dir = self.dir(tenant, rid);
        std::fs::create_dir_all(&dir)?;
        let tmp = dir.join(format!(".site-{}", random_token(4)));
        let res = (|| -> Result<SiteInfo> {
            let mut files = 0usize;
            let mut size = 0u64;
            let mut entries: Vec<String> = Vec::new();
            for i in 0..zip.len() {
                let mut f = zip.by_index(i).map_err(|e| Error::bad(format!("zip: {e}")))?;
                if f.is_dir() {
                    continue;
                }
                let name = f.name().replace('\\', "/");
                if !mosaikit_mskp::is_safe_path(&name) || f.enclosed_name().is_none() {
                    return Err(Error::bad(format!("unsafe path in the zip: {name}")));
                }
                size += f.size();
                if size > SITE_MAX_BYTES {
                    return Err(Error::bad("content of the zip over 512 MB"));
                }
                let out = tmp.join(&name);
                if let Some(parent) = out.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let mut buf = Vec::with_capacity(f.size() as usize);
                (&mut f)
                    .take(SITE_MAX_BYTES + 1)
                    .read_to_end(&mut buf)
                    .map_err(|e| Error::bad(format!("zip: {e}")))?;
                std::fs::write(&out, &buf)?;
                files += 1;
                entries.push(name);
            }
            let mut index: Vec<&String> = entries
                .iter()
                .filter(|p| p.rsplit('/').next().is_some_and(|n| n.eq_ignore_ascii_case("index.html")))
                .collect();
            index.sort_by_key(|p| (p.matches('/').count(), p.len()));
            Ok(SiteInfo { files, size, entry: index.first().map(|s| s.to_string()).unwrap_or_default() })
        })();
        match res {
            Ok(info) => {
                let site = dir.join("site");
                if site.exists() {
                    std::fs::remove_dir_all(&site)?;
                }
                std::fs::rename(&tmp, &site)?;
                Ok(info)
            }
            Err(e) => {
                let _ = std::fs::remove_dir_all(&tmp);
                Err(e)
            }
        }
    }

    /// File of a site (safe relative path). A folder becomes its index.html.
    pub fn site_file(&self, tenant: Uuid, rid: Uuid, rel: &str) -> Option<PathBuf> {
        let base = self.site_dir(tenant, rid);
        let rel = rel.trim_matches('/');
        let p = if rel.is_empty() {
            base.clone()
        } else {
            if !mosaikit_mskp::is_safe_path(rel) {
                return None;
            }
            base.join(rel)
        };
        if p.is_dir() {
            let idx = p.join("index.html");
            return idx.is_file().then_some(idx);
        }
        p.is_file().then_some(p)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

/// Removes the contents of resources that no longer exist (older than one hour).
pub async fn gc(k: &Kernel) {
    let Ok(tenants) = std::fs::read_dir(k.blobs.root()) else { return };
    for t in tenants.flatten() {
        let Ok(tenant) = t.file_name().to_string_lossy().parse::<Uuid>() else { continue };
        let Ok(items) = std::fs::read_dir(t.path()) else { continue };
        for it in items.flatten() {
            let Ok(rid) = it.file_name().to_string_lossy().parse::<Uuid>() else { continue };
            let old = it
                .metadata()
                .and_then(|m| m.modified())
                .map(|m| m.elapsed().unwrap_or_default() > std::time::Duration::from_secs(3600))
                .unwrap_or(false);
            if !old {
                continue;
            }
            let exists: bool =
                mosaikit_db::query_scalar("select exists (select 1 from core.resources where id = $1)")
                    .bind(rid)
                    .fetch_one(&k.db)
                    .await
                    .unwrap_or(true);
            if !exists {
                k.blobs.remove(tenant, rid);
            }
        }
    }
}
