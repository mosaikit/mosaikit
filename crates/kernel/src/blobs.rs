//! Contents on disk: `<data_dir>/blobs/<tenant>/<resource>/{file | site/...}`.

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use uuid::Uuid;

use crate::util::random_token;
use crate::{Error, Kernel, Result};

const SITE_MAX_FILES: usize = 20_000;
pub(crate) const SITE_MAX_BYTES: u64 = 512 << 20;

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
        self.extract_site_within(tenant, rid, zip_bytes, SITE_MAX_BYTES)
    }

    /// [`Self::extract_site`] with the limit on the unpacked size as a parameter (tests).
    pub(crate) fn extract_site_within(
        &self,
        tenant: Uuid,
        rid: Uuid,
        zip_bytes: &[u8],
        max: u64,
    ) -> Result<SiteInfo> {
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
                let name = f.name().map_err(|e| Error::bad(format!("zip: {e}")))?.replace('\\', "/");
                if !mosaikit_mskp::is_safe_path(&name) || f.enclosed_name().is_none() {
                    return Err(Error::bad(format!("unsafe path in the zip: {name}")));
                }
                if size.saturating_add(f.size()) > max {
                    return Err(Error::bad(format!("content of the zip over {} MB", max >> 20))
                        .with_code("content_too_large"));
                }
                let out = tmp.join(&name);
                if let Some(parent) = out.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                // the sizes in the headers of a zip are written by whoever made it: what counts is what
                // the entry really inflates to, read at most up to what is left of the limit
                let left = max - size;
                let mut buf = Vec::with_capacity(f.size().min(left).min(16 << 20) as usize);
                (&mut f).take(left + 1).read_to_end(&mut buf).map_err(|e| Error::bad(format!("zip: {e}")))?;
                size += buf.len() as u64;
                if size > max {
                    return Err(Error::bad(format!("content of the zip over {} MB", max >> 20))
                        .with_code("content_too_large"));
                }
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

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    /// A zip with one deflated entry of `size` zero bytes whose headers declare 10 bytes.
    fn zip_of_size(size: usize) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        w.start_file("index.html", zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(&vec![0u8; size]).unwrap();
        w.finish().unwrap().into_inner()
    }

    fn lying_zip(size: usize) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        w.start_file("index.html", zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(&vec![0u8; size]).unwrap();
        let mut b = w.finish().unwrap().into_inner();
        assert_eq!(&b[0..4], b"PK");
        b[22..26].copy_from_slice(&10u32.to_le_bytes());
        let cd = b.windows(4).position(|x| x == b"PK").unwrap();
        b[cd + 24..cd + 28].copy_from_slice(&10u32.to_le_bytes());
        b
    }

    #[test]
    fn the_sizes_declared_in_a_zip_are_not_trusted() {
        let dir = tempfile::tempdir().unwrap();
        let blobs = Blobs::new(dir.path().to_path_buf());
        let (t, r) = (Uuid::new_v4(), Uuid::new_v4());
        // a site within the limit
        let zip = zip_of_size(3 << 20);
        let info = blobs.extract_site_within(t, r, &zip, 8 << 20).unwrap();
        assert_eq!(info.size, 3 << 20);
        // an entry that inflates to more than it declares is refused (zip >= 9 checks it while
        // reading, and the bytes are counted anyway): nothing changes on disk
        let err = blobs.extract_site_within(t, r, &lying_zip(4 << 20), 8 << 20).unwrap_err();
        assert!(err.message.contains("larger than its declared"), "{}", err.message);
        // a site over the limit is refused: the previous one stays
        let err = blobs.extract_site_within(t, r, &zip_of_size(9 << 20), 8 << 20).unwrap_err();
        assert!(err.message.contains("over 8 MB"), "{}", err.message);
        let site = blobs.dir(t, r).join("site");
        assert_eq!(std::fs::read(site.join("index.html")).unwrap().len(), 3 << 20, "the previous site stays");
    }
}
